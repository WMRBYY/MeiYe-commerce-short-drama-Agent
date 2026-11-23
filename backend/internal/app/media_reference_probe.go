package app

import (
	"context"

	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"

	"os"
	"os/exec"
	"path/filepath"

	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

const (
	mediaReferenceMinDurationMs int64 = 4000

	mediaDurationSlackMs int64 = 60
	mediaMaxVideoBytes   int64 = 1024 << 20
	mediaMaxImageBytes   int64 = 30 << 20
	mediaDownloadTimeout       = 3 * time.Minute
)

const mediaBrokenVideoMessage = "参考视频文件已损坏或不完整，无法读取；请重新导出为 MP4 / MOV 后上传"

type mediaProbe struct {
	Width      int
	Height     int
	DurationMs int64
	FPS        float64
	HasAudio   bool
	VideoCodec string
}

func probeReferenceMediaFile(ctx context.Context, path string) (mediaProbe, error) {
	bin, err := exec.LookPath("ffprobe")
	if err != nil {
		return mediaProbe{}, errMediaProbeUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, mediaProbeTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, bin, "-v", "error",
		"-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate:stream_side_data=rotation:format=duration",
		"-of", "json", path).Output()
	if err != nil {
		return mediaProbe{}, fmt.Errorf("视频探测失败：%w", err)
	}
	return parseMediaProbe(output)
}

func parseMediaProbe(raw []byte) (mediaProbe, error) {
	var document struct {
		Streams []struct {
			CodecType    string `json:"codec_type"`
			CodecName    string `json:"codec_name"`
			Width        int    `json:"width"`
			Height       int    `json:"height"`
			AvgFrameRate string `json:"avg_frame_rate"`
			RFrameRate   string `json:"r_frame_rate"`
			SideDataList []struct {
				Rotation *float64 `json:"rotation"`
			} `json:"side_data_list"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return mediaProbe{}, fmt.Errorf("视频探测结果无效：%w", err)
	}
	var probe mediaProbe
	videoFound := false
	for _, stream := range document.Streams {
		switch stream.CodecType {
		case "audio":
			probe.HasAudio = true
		case "video":
			if videoFound {
				continue
			}
			videoFound = true
			probe.VideoCodec = stream.CodecName
			if stream.Width > 0 && stream.Height > 0 && stream.Width <= mediaProbeMaxDimension && stream.Height <= mediaProbeMaxDimension {
				probe.Width, probe.Height = stream.Width, stream.Height
				for _, side := range stream.SideDataList {
					if side.Rotation != nil && int(math.Abs(math.Round(*side.Rotation)))%180 == 90 {
						probe.Width, probe.Height = probe.Height, probe.Width
						break
					}
				}
			}
			probe.FPS = parseFrameRate(stream.AvgFrameRate)
			if probe.FPS <= 0 {
				probe.FPS = parseFrameRate(stream.RFrameRate)
			}
		}
	}
	if !videoFound || probe.Width == 0 || probe.Height == 0 {
		return probe, errors.New("文件不包含可解码的视频画面")
	}
	if seconds, err := strconv.ParseFloat(strings.TrimSpace(document.Format.Duration), 64); err == nil && seconds > 0 && !math.IsNaN(seconds) && !math.IsInf(seconds, 0) {
		probe.DurationMs = int64(math.Round(seconds * 1000))
	}
	if probe.DurationMs <= 0 {
		return probe, errors.New("无法读取视频时长")
	}
	return probe, nil
}

func parseFrameRate(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" || value == "0/0" {
		return 0
	}
	if numerator, denominator, ok := strings.Cut(value, "/"); ok {
		n, errN := strconv.ParseFloat(numerator, 64)
		d, errD := strconv.ParseFloat(denominator, 64)
		if errN != nil || errD != nil || d == 0 {
			return 0
		}
		return math.Round(n/d*100) / 100
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return n
}

func (s *Service) withMediaResourceFile(userID, resourceID string, maxBytes int64, fn func(resource *model.Resource, path string) error) error {
	return s.withMediaResourceFileContext(context.Background(), userID, resourceID, maxBytes, fn)
}

func (s *Service) withMediaResourceFileContext(ctx context.Context, userID, resourceID string, maxBytes int64, fn func(resource *model.Resource, path string) error) error {
	readCtx, cancel := context.WithTimeout(ctx, mediaDownloadTimeout)
	defer cancel()
	resource, body, err := s.openResourceContext(readCtx, userID, resourceID)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}
	defer body.Close()
	stopClose := context.AfterFunc(readCtx, func() { _ = body.Close() })
	defer stopClose()
	dir, err := os.MkdirTemp("", "yingce-replication-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "input"+mediaFileExtension(resource.MimeType))
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(file, io.LimitReader(body, maxBytes+1))
	closeErr := file.Close()
	readErr := readCtx.Err()
	stopClose()
	cancel()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if readErr != nil {
		return errors.New("读取素材文件超时，请稍后重试")
	}
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written > maxBytes {
		return BadAuthRequest(fmt.Sprintf("文件超过 %d MB", maxBytes>>20))
	}
	return fn(resource, path)
}

func mediaFileExtension(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "video/quicktime":
		return ".mov"
	case "video/mp4":
		return ".mp4"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	}
	return ".bin"
}

func extractMediaFrame(ctx context.Context, ffmpegBin, input string, atMs int64, output string) error {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	at := fmt.Sprintf("%.3f", float64(atMs)/1000)
	cmd := exec.CommandContext(ctx, ffmpegBin, "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", at, "-i", input, "-frames:v", "1",
		"-vf", "scale='if(gt(iw,ih),min(768,iw),-2)':'if(gt(iw,ih),-2,min(768,ih))'", "-q:v", "4", "-y", output)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("抽取关键帧失败：%s", clipText(strings.TrimSpace(string(out)), 300))
	}
	return nil
}

func extractMediaAudio(ctx context.Context, ffmpegBin, input, output string) error {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpegBin, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", input, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "96k", "-y", output)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("抽取音轨失败：%s", clipText(strings.TrimSpace(string(out)), 300))
	}
	return nil
}
