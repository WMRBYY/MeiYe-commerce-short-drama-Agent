package app

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

type ReferenceClipInput struct {
	ResourceID string `json:"resourceId"`
	StartMs    int64  `json:"startMs"`
	EndMs      int64  `json:"endMs"`
}

func (s *Service) SaveMediaReference(userID, id string, source VideoLinkSource) (string, error) {
	if err := s.requireMediaReferenceAccess(); err != nil {
		return "", err
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return "", err
	}
	if resource.Kind != "video" || resource.Status != model.ResourceStatusReady {
		return "", BadAuthRequest("视频素材不可用")
	}
	source.Width, source.Height, source.DurationMs, source.SizeBytes = resource.Width, resource.Height, resource.DurationMs, resource.Size
	return s.registerVideoLinkAsset(userID, resource, source, resource.ID)
}

func (s *Service) ValidateReferenceUpload(file io.ReadSeeker) error {
	mime, err := detectUploadedMimeType(file)
	if err != nil {
		return err
	}
	if uploadedResourceKind(mime) != "video" {
		return BadAuthRequest("请选择视频文件")
	}
	return nil
}

func (s *Service) storeReferenceFile(userID, name, path string, meta mediaProbe, identity string) (*model.Resource, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	id := newID()
	if err = s.ReserveChunkUploadSessionForPurpose(userID, id, info.Size(), time.Now().Add(time.Hour), 32, UploadPurposeMediaReference); err != nil {
		return nil, err
	}
	return s.UploadReservedResourceFile(userID, id, name, info.Size(), "video", meta.Width, meta.Height, meta.DurationMs, file, identity)
}

var referenceClipSlots = make(chan struct{}, 2)

func (s *Service) ClipMediaReference(ctx context.Context, userID string, input ReferenceClipInput, emit func(VideoLinkEvent)) (*VideoLinkImportResult, error) {
	if err := s.requireMediaReferenceAccess(); err != nil {
		return nil, err
	}
	length := input.EndMs - input.StartMs
	if input.StartMs < 0 || input.EndMs <= input.StartMs || input.EndMs > mediaReferenceMaxSourceMs+50 || length < 3950 || length > mediaReferenceMaxSourceMs+50 {
		return nil, BadAuthRequest("请选择有效的参考视频区间")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	select {
	case referenceClipSlots <- struct{}{}:
		defer func() { <-referenceClipSlots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	limit := mediaReferenceMaxBytes
	var result *VideoLinkImportResult
	err := s.withMediaResourceFileContext(ctx, userID, input.ResourceID, limit, func(resource *model.Resource, path string) error {
		if resource.Kind != "video" || resource.Size > limit {
			return BadAuthRequest("参考视频类型或大小不符合设置")
		}
		source, err := probeReferenceMediaFile(ctx, path)
		if err != nil {
			return err
		}
		if input.EndMs > source.DurationMs+50 {
			return BadAuthRequest("选区超过原视频时长")
		}
		output := filepath.Join(filepath.Dir(path), "reference-clip.mp4")
		err = encodeReferenceClip(ctx, path, output, input.StartMs, length, func(percent int) {
			if emit != nil {
				emit(VideoLinkEvent{Event: "stage", Stage: "clipping", Progress: float64(percent) / 100})
			}
		})
		if err != nil {
			return err
		}
		meta, err := probeReferenceMediaFile(ctx, output)
		if err != nil {
			return err
		}
		if delta := meta.DurationMs - length; delta < -150 || delta > 150 {
			return BadAuthRequest("剪辑文件时长与选区不一致，请重新选择区间")
		}
		stat, err := os.Stat(output)
		if err != nil {
			return err
		}
		if stat.Size() > limit {
			return BadAuthRequest("剪辑文件超过大小上限，请缩短选区")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		saved, err := s.storeReferenceFile(userID, "参考视频片段.mp4", output, meta, fmt.Sprintf("reference-clip:v1:%s:%d:%d", resource.ID, input.StartMs, input.EndMs))
		if err != nil {
			return err
		}
		result = &VideoLinkImportResult{ResourceID: saved.ID, Source: VideoLinkSource{Title: "参考视频片段", DurationMs: meta.DurationMs, Width: meta.Width, Height: meta.Height, FPS: meta.FPS, HasAudio: meta.HasAudio, SizeBytes: saved.Size}}
		return nil
	})
	return result, err
}

func encodeReferenceClip(ctx context.Context, source, output string, start, length int64, progress func(int)) error {
	binary, err := renderFfmpegBinary()
	if err != nil {
		return err
	}
	seconds := func(ms int64) string { return fmt.Sprintf("%.3f", float64(ms)/1000) }
	cmd := exec.CommandContext(ctx, binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", seconds(start), "-i", source, "-t", seconds(length), "-map", "0:v:0", "-map", "0:a:0?", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", output)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err = cmd.Start(); err != nil {
		return err
	}
	scanner := bufio.NewScanner(pipe)
	last := -1
	for scanner.Scan() {
		if raw, ok := strings.CutPrefix(scanner.Text(), "out_time_us="); ok {
			if us, err := strconv.ParseInt(raw, 10, 64); err == nil {
				percent := min(99, int(max(int64(0), us)/(length*10)))
				if percent > last {
					progress(percent)
					last = percent
				}
			}
		}
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return BadAuthRequest("视频编码失败，请检查原片后重试")
	}
	return scanner.Err()
}
