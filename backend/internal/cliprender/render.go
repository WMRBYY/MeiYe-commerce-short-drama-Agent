// Package cliprender renders validated local media without invoking a video model.
package cliprender

import (
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Placement struct {
	Path                                            string
	StartMs, EndMs, SourceStartMs, SourceDurationMs int64
}

type Input struct {
	Source        string
	Width, Height int
	DurationMs    int64
	Placements    []Placement
	ASS           string
	Pop           bool
	HasAudio      bool
	Music         string
	MusicVolume   float64
	Filter        string
	Transition    string
	Layout        string
	// Mask must be a full-length grayscale video, white for foreground pixels.
	Mask string
}

func Size(width, height int) (int, int) {
	if width <= 0 || height <= 0 {
		return 0, 0
	}
	scale := math.Min(1, math.Min(1920/float64(max(width, height)), math.Sqrt(1920*1080/float64(width*height))))
	return max(2, int(float64(width)*scale)/2*2), max(2, int(float64(height)*scale)/2*2)
}

func Validate(in Input) error {
	if in.Source == "" || in.Width < 2 || in.Height < 2 || in.Width > 1920 || in.Height > 1920 || in.Width%2 != 0 || in.Height%2 != 0 || in.Width*in.Height > 1920*1080 || in.DurationMs <= 0 || in.DurationMs > 300000 {
		return fmt.Errorf("剪辑视频尺寸或时长无效（最长 5 分钟）")
	}
	if len(in.Placements) > 200 {
		return fmt.Errorf("替换片段过多")
	}
	var previous int64
	for _, p := range in.Placements {
		if p.Path == "" || p.StartMs < previous || p.EndMs <= p.StartMs || p.EndMs > in.DurationMs || p.SourceStartMs < 0 || p.SourceStartMs > p.SourceDurationMs || p.EndMs-p.StartMs > p.SourceDurationMs-p.SourceStartMs {
			return fmt.Errorf("混剪片段重叠、越界或缺少素材")
		}
		previous = p.EndMs
	}
	if in.Mask != "" && len(in.Placements) > 0 {
		return fmt.Errorf("人物遮罩不能与替换片段混用")
	}
	if math.IsNaN(in.MusicVolume) || math.IsInf(in.MusicVolume, 0) || in.MusicVolume < 0 || in.MusicVolume > 0.5 {
		return fmt.Errorf("背景音乐音量需在 0–50%% 之间")
	}
	for _, field := range []struct{ value, allowed string }{
		{in.Filter, "|original|warm|cool|soft|crisp|mono|"},
		{in.Transition, "|cut|dissolve|slide|"},
		{in.Layout, "|full|pip|"},
	} {
		if field.value != "" && (strings.ContainsAny(field.value, "|") || !strings.Contains(field.allowed, "|"+field.value+"|")) {
			return fmt.Errorf("剪辑视觉参数无效")
		}
	}
	return nil
}

func seconds(ms int64) string { return strconv.FormatFloat(float64(ms)/1000, 'f', 3, 64) }

func normalize(width, height int) string {
	return fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p", width, height, width, height)
}

// Render writes to a partial file and renames only after successful completion.
// All filter paths are fixed names under a private working directory; media paths
// are argv values and user text is only written to an ASS file.
func Render(ctx context.Context, ffmpeg, workDir string, in Input) (string, error) {
	if err := Validate(in); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(workDir, "captions.ass"), []byte(in.ASS), 0600); err != nil {
		return "", err
	}
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", in.Source}
	filters := []string{fmt.Sprintf("[0:v:0]setpts=PTS-STARTPTS,%s[base0]", normalize(in.Width, in.Height))}
	last := "base0"
	if in.Pop {
		filters = append(filters, fmt.Sprintf("[base0]scale=w='trunc(%d*(1+0.025*(1-cos(2*PI*t/4))/2)/2)*2':h='trunc(%d*(1+0.025*(1-cos(2*PI*t/4))/2)/2)*2':eval=frame,crop=%d:%d,setsar=1[pulse]", in.Width, in.Height, in.Width, in.Height))
		last = "pulse"
	}
	for i, p := range in.Placements {
		args = append(args, "-ss", seconds(p.SourceStartMs), "-t", seconds(p.EndMs-p.StartMs), "-i", p.Path)
		insertWidth, insertHeight, x, y := in.Width, in.Height, 0, 0
		if in.Layout == "pip" {
			insertWidth = max(2, int(float64(in.Width)*0.40)/2*2)
			insertHeight = max(2, int(float64(in.Height)*0.28)/2*2)
			x, y = int(float64(in.Width)*0.54), int(float64(in.Height)*0.32)
		}
		insertFilter := normalize(insertWidth, insertHeight)
		if in.Layout == "pip" {
			insertFilter += fmt.Sprintf(",drawbox=x=0:y=0:w=iw:h=ih:color=white@0.85:t=%d", max(1, min(in.Width, in.Height)/180))
		}
		// Alpha transitions keep the source timeline and its continuous speech.
		// Short shots use shorter ramps rather than disappearing into a fade.
		rampMs := min(int64(220), (p.EndMs-p.StartMs)/4)
		if in.Transition == "dissolve" && rampMs > 0 {
			insertFilter += fmt.Sprintf(",format=yuva420p,fade=t=in:st=0:d=%s:alpha=1,fade=t=out:st=%s:d=%s:alpha=1", seconds(rampMs), seconds(p.EndMs-p.StartMs-rampMs), seconds(rampMs))
		}
		filters = append(filters, fmt.Sprintf("[%d:v:0]setpts=PTS-STARTPTS,%s,setpts=PTS-STARTPTS+%s/TB[insert%d]", i+1, insertFilter, seconds(p.StartMs), i))
		next := fmt.Sprintf("base%d", i+1)
		xExpression := strconv.Itoa(x)
		if in.Transition == "slide" && rampMs > 0 {
			xExpression = fmt.Sprintf("%d+%d*max(0,max(1-(t-%s)/%s,1-(%s-t)/%s))", x, in.Width-x, seconds(p.StartMs), seconds(rampMs), seconds(p.EndMs), seconds(rampMs))
		}
		filters = append(filters, fmt.Sprintf("[%s][insert%d]overlay=x='%s':y=%d:eof_action=pass:repeatlast=0:enable='gte(t,%s)*lt(t,%s)'[%s]", last, i, xExpression, y, seconds(p.StartMs), seconds(p.EndMs), next))
		last = next
	}
	if filter := colorFilter(in.Filter); filter != "" {
		filters = append(filters, fmt.Sprintf("[%s]%s[graded]", last, filter))
		last = "graded"
	}
	if in.Mask != "" {
		args = append(args, "-i", in.Mask)
		filters = append(filters, fmt.Sprintf("[%s]split=2[background][foreground]", last))
		filters = append(filters, "[background]ass=captions.ass[text]")
		filters = append(filters, fmt.Sprintf("[1:v:0]setpts=PTS-STARTPTS,scale=%d:%d,setsar=1,fps=30,format=gray[mask]", in.Width, in.Height))
		filters = append(filters, "[text][foreground][mask]maskedmerge[outv]")
	} else if in.ASS != "" {
		filters = append(filters, fmt.Sprintf("[%s]ass=captions.ass[outv]", last))
	} else {
		filters = append(filters, fmt.Sprintf("[%s]null[outv]", last))
	}
	partial := filepath.Join(workDir, "output.partial.mp4")
	defer os.Remove(partial)
	audioArgs := []string{"-map", "0:a:0?", "-af", "asetpts=PTS-STARTPTS,apad,atrim=duration=" + seconds(in.DurationMs)}
	if in.Music != "" {
		index := 1 + len(in.Placements)
		if in.Mask != "" {
			index++
		}
		args = append(args, "-stream_loop", "-1", "-i", in.Music)
		filters = append(filters, fmt.Sprintf("[%d:a:0]asetpts=PTS-STARTPTS,volume=%.4f,atrim=duration=%s[music]", index, in.MusicVolume, seconds(in.DurationMs)))
		if in.HasAudio {
			filters = append(filters, fmt.Sprintf("[0:a:0]asetpts=PTS-STARTPTS,apad,atrim=duration=%s,asplit=2[voice][side]", seconds(in.DurationMs)))
			filters = append(filters, "[music][side]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[duck]")
			filters = append(filters, "[voice][duck]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=0[outa]")
		} else {
			filters = append(filters, "[music]anull[outa]")
		}
		audioArgs = []string{"-map", "[outa]"}
	}
	args = append(args, "-filter_complex_threads", "2", "-filter_complex", strings.Join(filters, ";"), "-map", "[outv]")
	args = append(args, audioArgs...)
	args = append(args, "-t", seconds(in.DurationMs), "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", partial)
	if _, err := Run(ctx, ffmpeg, args, workDir); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	info, err := os.Stat(partial)
	if err != nil || info.Size() == 0 {
		return "", fmt.Errorf("剪辑输出为空")
	}
	output := filepath.Join(workDir, "output.mp4")
	if err := os.Rename(partial, output); err != nil {
		return "", err
	}
	return output, nil
}

func colorFilter(name string) string {
	switch name {
	case "warm":
		return "colorbalance=rs=0.035:gs=0.008:bs=-0.025:rm=0.025:bm=-0.015,eq=saturation=1.04"
	case "cool":
		return "colorbalance=rs=-0.025:bs=0.035:rm=-0.015:bm=0.025,eq=saturation=0.97"
	case "soft":
		return "eq=contrast=0.96:brightness=0.018:saturation=0.94"
	case "crisp":
		return "eq=contrast=1.06:saturation=1.04,unsharp=5:5:0.35:5:5:0"
	case "mono":
		return "hue=s=0"
	default:
		return ""
	}
}

// Trim resets both clocks before ASR and visual planning, so all subsequent
// timestamps describe the selected output interval, never the original source.
func Trim(ctx context.Context, ffmpeg, workDir, source string, startMs, endMs int64) (string, error) {
	if source == "" || startMs < 0 || endMs <= startMs || endMs > 300000 {
		return "", fmt.Errorf("请选择有效的视频起止时间")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(workDir, "selected-*.mp4")
	if err != nil {
		return "", err
	}
	output := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(output)
		return "", err
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.Remove(output)
		}
	}()
	_, err = Run(ctx, ffmpeg, []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", seconds(startMs), "-i", source,
		"-map", "0:v:0", "-map", "0:a:0?", "-vf", "setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1", "-af", "asetpts=PTS-STARTPTS",
		"-t", seconds(endMs - startMs), "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output}, workDir)
	if err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	info, err := os.Stat(output)
	if err != nil || info.Size() == 0 {
		return "", fmt.Errorf("所选视频片段为空")
	}
	complete = true
	return output, nil
}

// Normalize creates the exact frame clock shared by SAM and the compositing pass.
func Normalize(ctx context.Context, ffmpeg, workDir string, in Input) (string, error) {
	if err := Validate(in); err != nil {
		return "", err
	}
	output := filepath.Join(workDir, "normalized.mp4")
	_, err := Run(ctx, ffmpeg, []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", in.Source, "-vf", normalize(in.Width, in.Height), "-map", "0:v:0", "-map", "0:a:0?", "-t", seconds(in.DurationMs), "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-threads", "2", "-c:a", "aac", output}, workDir)
	return output, err
}

type tailBuffer struct {
	data  []byte
	limit int
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	n := len(p)
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = append([]byte(nil), b.data[len(b.data)-b.limit:]...)
	}
	return n, nil
}

// Run bounds diagnostics and terminates the whole process tree on cancellation.
func Run(ctx context.Context, binary string, args []string, dir string) (string, error) {
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = dir
	cmd.WaitDelay = 3 * time.Second
	configureProcess(cmd)
	output := &tailBuffer{limit: 64 * 1024}
	cmd.Stdout, cmd.Stderr = output, output
	err := cmd.Run()
	if ctx.Err() != nil {
		return string(output.data), ctx.Err()
	}
	if err != nil {
		return string(output.data), fmt.Errorf("媒体处理失败: %w", err)
	}
	return string(output.data), nil
}
