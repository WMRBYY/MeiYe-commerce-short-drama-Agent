package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"yingce/backend/internal/cliprender"
	"yingce/backend/internal/model"
)

const shopClipMaxMediaBytes int64 = 512 << 20

func shopClipRenderCapability(mode string) error {
	switch mode {
	case "koubo", "mix", "subtitle", "behind":
	default:
		return fmt.Errorf("剪辑模式无效")
	}
	ffmpeg, err := renderFfmpegBinary()
	if err != nil {
		return err
	}
	if !mediaProbeAvailable() {
		return fmt.Errorf("剪辑环境缺少 ffprobe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	filters, err := cliprender.Run(ctx, ffmpeg, []string{"-hide_banner", "-filters"}, "")
	if err != nil {
		return fmt.Errorf("剪辑环境无法运行 FFmpeg")
	}
	required := []string{" ass "}
	if mode == "mix" {
		required = append(required, " overlay ")
	}
	if mode == "behind" {
		required = append(required, " maskedmerge ")
	}
	for _, filter := range required {
		if !strings.Contains(filters, filter) {
			return fmt.Errorf("剪辑环境缺少 %s 支持", strings.TrimSpace(filter))
		}
	}
	if _, _, err := renderTextFace("sans-bold"); err != nil {
		return fmt.Errorf("剪辑环境缺少中文字体")
	}
	if mode == "behind" {
		python, script, args, err := shopClipMaskCommand()
		if err != nil {
			return err
		}
		if _, err = cliprender.Run(ctx, python, append([]string{script, "--check"}, args...), ""); err != nil {
			return fmt.Errorf("人物遮罩服务未就绪，请检查 SAM 2 权重、依赖和 GPU")
		}
	}
	return nil
}

func shopClipMaskCommand() (string, string, []string, error) {
	python := strings.TrimSpace(os.Getenv("CANVAS_SHOP_CLIP_PYTHON"))
	if python == "" {
		python = "python3"
	}
	resolved, err := exec.LookPath(python)
	if err != nil {
		return "", "", nil, fmt.Errorf("人物遮罩服务未配置 Python")
	}
	script := strings.TrimSpace(os.Getenv("CANVAS_SHOP_CLIP_MASK_SCRIPT"))
	if script == "" {
		script = filepath.Join("clip-worker", "sam2_mask.py")
	}
	script, err = filepath.Abs(script)
	if err != nil {
		return "", "", nil, err
	}
	if info, err := os.Stat(script); err != nil || info.IsDir() {
		return "", "", nil, fmt.Errorf("人物遮罩脚本未安装")
	}
	checkpoint := strings.TrimSpace(os.Getenv("CANVAS_SHOP_CLIP_SAM2_CHECKPOINT"))
	if checkpoint == "" {
		return "", "", nil, fmt.Errorf("人物遮罩服务尚未安装 SAM 2 权重")
	}
	checkpoint, err = filepath.Abs(checkpoint)
	if err != nil {
		return "", "", nil, err
	}
	if info, err := os.Stat(checkpoint); err != nil || info.IsDir() || info.Size() < 1024 {
		return "", "", nil, fmt.Errorf("人物遮罩权重文件不可读")
	}
	config := firstNonEmpty(strings.TrimSpace(os.Getenv("CANVAS_SHOP_CLIP_SAM2_CONFIG")), "configs/sam2.1/sam2.1_hiera_s.yaml")
	return resolved, script, []string{"--checkpoint", checkpoint, "--config", config}, nil
}

type shopClipLocalMedia struct {
	path string
	info mediaProbeInfo
}

func (s *Service) materializeShopClipMedia(ctx context.Context, userID, id, dir string, index int) (shopClipLocalMedia, error) {
	return s.materializeShopClipResource(ctx, userID, id, dir, index, false)
}

func (s *Service) materializeShopClipResource(ctx context.Context, userID, id, dir string, index int, audio bool) (shopClipLocalMedia, error) {
	resource, reader, err := s.OpenResource(userID, id)
	if err != nil {
		return shopClipLocalMedia{}, fmt.Errorf("素材 %s 无法读取: %w", id, err)
	}
	if reader == nil {
		return shopClipLocalMedia{}, fmt.Errorf("素材 %s 数据缺失", id)
	}
	defer reader.Close()
	stop := context.AfterFunc(ctx, func() { _ = reader.Close() })
	defer stop()
	prefix := "video/"
	if audio {
		prefix = "audio/"
	}
	if resource == nil || !strings.HasPrefix(resource.MimeType, prefix) {
		return shopClipLocalMedia{}, fmt.Errorf("素材 %s 的媒体类型不匹配", id)
	}
	path := filepath.Join(dir, fmt.Sprintf("source-%d.media", index))
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return shopClipLocalMedia{}, err
	}
	n, copyErr := io.Copy(file, io.LimitReader(reader, shopClipMaxMediaBytes+1))
	closeErr := file.Close()
	if err := ctx.Err(); err != nil {
		return shopClipLocalMedia{}, err
	}
	if copyErr != nil || closeErr != nil || n == 0 || n > shopClipMaxMediaBytes {
		return shopClipLocalMedia{}, fmt.Errorf("素材 %s 未完整读取或超过 512 MB", id)
	}
	info, err := probeMediaFile(ctx, path)
	if err != nil || (!audio && (info.Width <= 0 || info.Height <= 0)) || info.DurationMs <= 0 || info.DurationMs > 300000 {
		return shopClipLocalMedia{}, fmt.Errorf("素材 %s 无法解码或超过 5 分钟", id)
	}
	if audio {
		has, err := shopClipAudioStream(ctx, path)
		if err != nil || !has {
			return shopClipLocalMedia{}, fmt.Errorf("音乐素材缺少有效音轨")
		}
	}
	return shopClipLocalMedia{path: path, info: info}, nil
}

func (s *Service) renderShopClip(ctx context.Context, userID, mode string, plan ShopClipPlan, prepared ...map[string]shopClipAsset) (string, error) {
	if userID == "" || plan.SourceResourceID == "" {
		return "", fmt.Errorf("缺少用户或口播视频")
	}
	if err := shopClipRenderCapability(mode); err != nil {
		return "", err
	}
	if len(plan.Materials) > 8 {
		return "", fmt.Errorf("最多使用 8 段空镜素材")
	}
	if err := validateShopClipVisual(plan.TemplateID, plan.Visual, mode); err != nil {
		return "", err
	}
	if len(prepared) == 0 {
		assets, cleanup, err := s.inspectShopClipAssets(ctx, userID, plan)
		if err != nil {
			return "", err
		}
		defer cleanup()
		prepared = []map[string]shopClipAsset{assets}
	}
	workDir, err := os.MkdirTemp("", "yingce-shop-clip-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(workDir)
	media := map[string]shopClipLocalMedia{}
	load := func(id string, index int, audio bool) (shopClipLocalMedia, error) {
		asset, ok := prepared[0][id]
		if !ok {
			return shopClipLocalMedia{}, fmt.Errorf("预检素材 %s 缺失", id)
		}
		// Retain the per-user ownership gate even when the worker supplies its
		// already-probed local copy. The caller owns that directory's lifetime.
		resource, err := s.Resource(userID, id)
		if err != nil {
			return shopClipLocalMedia{}, err
		}
		prefix := "video/"
		if audio {
			prefix = "audio/"
		}
		if resource == nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, prefix) {
			return shopClipLocalMedia{}, fmt.Errorf("预检素材类型或状态失效")
		}
		info, err := os.Stat(asset.path)
		if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > shopClipMaxMediaBytes {
			return shopClipLocalMedia{}, fmt.Errorf("预检素材文件不可读取")
		}
		if audio && !asset.audio {
			return shopClipLocalMedia{}, fmt.Errorf("背景音乐缺少音轨")
		}
		return shopClipLocalMedia{path: asset.path, info: mediaProbeInfo{Width: asset.width, Height: asset.height, DurationMs: asset.duration}}, nil
	}
	ids := append([]string{plan.SourceResourceID}, plan.Materials...)
	for _, id := range ids {
		if id == "" {
			return "", fmt.Errorf("素材引用为空")
		}
		if _, exists := media[id]; exists {
			continue
		}
		local, err := load(id, len(media), false)
		if err != nil {
			return "", err
		}
		media[id] = local
	}
	source := media[plan.SourceResourceID]
	if plan.DurationMs <= 0 || math.Abs(float64(plan.DurationMs-source.info.DurationMs)) > 100 {
		return "", fmt.Errorf("剪辑时长与原视频不一致，请重新分析")
	}
	width, height := cliprender.Size(source.info.Width, source.info.Height)
	_, visual, err := resolveShopClipVisual(plan.TemplateID, plan.Visual)
	if err != nil {
		return "", err
	}
	if mode == "behind" {
		visual = ShopClipVisual{}
	}
	in := cliprender.Input{Source: source.path, Width: width, Height: height, DurationMs: source.info.DurationMs, Pop: mode == "koubo" && plan.TemplateID == "pop", MusicVolume: plan.MusicVolume,
		Filter: visual.Filter, Transition: visual.Transition, Layout: visual.Layout}
	in.HasAudio, err = shopClipAudioStream(ctx, source.path)
	if err != nil {
		return "", err
	}
	if plan.MusicResourceID != "" {
		music, err := load(plan.MusicResourceID, len(media), true)
		if err != nil {
			return "", err
		}
		in.Music = music.path
	}
	if mode != "mix" && len(plan.Placements) > 0 {
		return "", fmt.Errorf("当前模式不接受混剪片段")
	}
	for _, p := range plan.Placements {
		local, ok := media[p.ResourceID]
		if !ok || p.ResourceID == plan.SourceResourceID {
			return "", fmt.Errorf("混剪片段引用未提交的空镜素材")
		}
		in.Placements = append(in.Placements, cliprender.Placement{Path: local.path, StartMs: p.StartMs, EndMs: p.EndMs, SourceStartMs: p.SourceStartMs, SourceDurationMs: local.info.DurationMs})
	}
	if mode == "mix" && len(in.Placements) == 0 {
		return "", fmt.Errorf("没有可用的混剪片段，请先匹配素材")
	}
	if err := cliprender.Validate(in); err != nil {
		return "", err
	}
	in.ASS, err = shopClipASS(mode, plan, width, height)
	if err != nil {
		return "", err
	}
	ffmpeg, err := renderFfmpegBinary()
	if err != nil {
		return "", err
	}
	if mode == "behind" {
		if err := shopClipSubjectBox(plan.SubjectBox); err != nil {
			return "", err
		}
		normalized, err := cliprender.Normalize(ctx, ffmpeg, workDir, in)
		if err != nil {
			return "", err
		}
		in.Source = normalized
		python, script, args, err := shopClipMaskCommand()
		if err != nil {
			return "", err
		}
		box, _ := json.Marshal(plan.SubjectBox)
		mask := filepath.Join(workDir, "foreground.mkv")
		args = append([]string{script}, args...)
		args = append(args, "--input", normalized, "--output", mask, "--box", string(box), "--ffmpeg", ffmpeg)
		if _, err := cliprender.Run(ctx, python, args, workDir); err != nil {
			return "", fmt.Errorf("人物遮罩生成失败，请检查人物框选或服务状态: %w", err)
		}
		maskInfo, err := probeMediaFile(ctx, mask)
		if err != nil || maskInfo.Width != width || maskInfo.Height != height || math.Abs(float64(maskInfo.DurationMs-in.DurationMs)) > 100 {
			return "", fmt.Errorf("人物遮罩尺寸或时长与视频不一致")
		}
		in.Mask = mask
	}
	output, err := cliprender.Render(ctx, ffmpeg, workDir, in)
	if err != nil {
		return "", err
	}
	info, err := probeMediaFile(ctx, output)
	if err != nil || info.Width != width || info.Height != height || math.Abs(float64(info.DurationMs-in.DurationMs)) > 100 {
		return "", fmt.Errorf("成片完整性检查失败")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	file, err := os.Open(output)
	if err != nil {
		return "", err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return "", err
	}
	resource, _, err := s.storeResource(userID, "media", "shop-clip.mp4", "video/mp4", stat.Size(), width, height, info.DurationMs, file, nil, false)
	if err != nil {
		return "", err
	}
	if resource == nil {
		return "", fmt.Errorf("成片资源未保存")
	}
	return resource.ID, nil
}

func shopClipAudioStream(ctx context.Context, path string) (bool, error) {
	probe, err := exec.LookPath("ffprobe")
	if err != nil {
		return false, fmt.Errorf("缺少 ffprobe")
	}
	output, err := cliprender.Run(ctx, probe, []string{"-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", path}, "")
	if err != nil {
		return false, fmt.Errorf("音轨探测失败")
	}
	return strings.TrimSpace(output) != "", nil
}

func shopClipSubjectBox(box []float64) error {
	if len(box) != 4 {
		return fmt.Errorf("请先框选首帧中的人物")
	}
	for _, v := range box {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1 {
			return fmt.Errorf("人物框选范围无效")
		}
	}
	if box[2] <= 0 || box[3] <= 0 || box[0]+box[2] > 1 || box[1]+box[3] > 1 {
		return fmt.Errorf("人物框选超出视频")
	}
	return nil
}

func shopClipASS(mode string, plan ShopClipPlan, width, height int) (string, error) {
	template, visual, err := resolveShopClipVisual(plan.TemplateID, plan.Visual)
	if err != nil {
		return "", err
	}
	if err := validateShopClipVisual(plan.TemplateID, plan.Visual, mode); err != nil {
		return "", err
	}
	style := "clean"
	if visual.SubtitleStyle == "solid" || visual.SubtitleStyle == "highlight" {
		style = "bold"
	}
	captions := &RenderCaptionPlan{Style: style, Font: "sans"}
	var previous int64
	for _, cue := range plan.Transcript {
		if cue.StartMs < previous || cue.EndMs <= cue.StartMs || cue.EndMs > plan.DurationMs || strings.TrimSpace(cue.Text) == "" || len([]rune(cue.Text)) > 80 {
			return "", fmt.Errorf("字幕为空、过长、重叠或超出视频")
		}
		captions.Cues = append(captions.Cues, RenderCaptionCue{StartMs: cue.StartMs, EndMs: cue.EndMs, Text: cue.Text})
		previous = cue.EndMs
	}
	if mode != "behind" && len(captions.Cues) == 0 {
		return "", fmt.Errorf("请先识别或输入字幕")
	}
	if mode != "behind" && strings.TrimSpace(plan.Title) != "" {
		if len([]rune(plan.Title)) > 100 {
			return "", fmt.Errorf("成片标题最多 100 字")
		}
		captions.Design = &RenderTextDesign{Font: "sans-bold", Primary: "#FFFFFF", Accent: "#FFD400"}
		captions.Overlays = []RenderOverlayCue{{StartMs: 0, EndMs: min(3000, plan.DurationMs), Text: plan.Title, Kind: "hook", Position: "top"}}
	}
	if mode != "behind" && visual.Widget == "label" {
		for i, c := range captions.Cues {
			if i%3 == 1 {
				// The opening title owns the top band until it leaves. Labels
				// quote the supplied speech and never invent prices or claims.
				start := max(c.StartMs, min(3000, plan.DurationMs))
				if c.EndMs > start {
					captions.Overlays = append(captions.Overlays, RenderOverlayCue{StartMs: start, EndMs: c.EndMs, Text: string([]rune(c.Text)[:min(10, len([]rune(c.Text)))]), Kind: "point", Position: "top"})
				}
			}
		}
	}
	if mode == "behind" {
		text := strings.TrimSpace(plan.BehindText)
		if text == "" || len([]rune(text)) > 20 {
			return "", fmt.Errorf("人物后方文字需填写 1–20 字")
		}
		family, _, err := renderTextFace("sans-bold")
		if err != nil {
			return "", err
		}
		alignment := 5
		switch plan.BehindPosition {
		case "", "center":
		case "top":
			alignment = 8
		case "bottom":
			alignment = 2
		default:
			return "", fmt.Errorf("文字位置无效")
		}
		size := max(20, min(height/8, int(float64(width)*0.9/float64(max(4, len([]rune(text)))))))
		return fmt.Sprintf("[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, BorderStyle, Outline, Alignment, MarginL, MarginR, MarginV\nStyle: Behind,%s,%d,&H00FFFFFF,&H00111111,-1,1,2,%d,20,20,%d\n\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,%s,Behind,%s\n", width, height, family, size, alignment, max(20, height/8), renderASSTime(plan.DurationMs), escapeRenderASS(text)), nil
	}
	return shopClipStyledCaptionASS(captions, width, height, visual, template.Preview)
}
