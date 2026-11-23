package app

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/cliprender"
)

func TestShopClipCaptionsUseActualCueTimes(t *testing.T) {
	if _, _, err := renderTextFace("sans-bold"); err != nil {
		t.Skip("CJK font not installed")
	}
	plan := ShopClipPlan{TemplateID: "clean", DurationMs: 2000, Title: "新品上市", Transcript: []ShopClipCue{{StartMs: 250, EndMs: 1750, Text: "产品字幕"}}}
	clean, err := shopClipASS("subtitle", plan, 720, 1280)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(clean, "0:00:00.25,0:00:01.75") || strings.Contains(clean, `\k`) {
		t.Fatal("must use actual segment timing, not invented karaoke timings")
	}
	plan.TemplateID = "bold"
	bold, err := shopClipASS("koubo", plan, 720, 1280)
	if err != nil {
		t.Fatal(err)
	}
	if bold == clean || !strings.Contains(bold, "新品上市") {
		t.Fatal("bold title/subtitle template not applied")
	}
	plan.Transcript[0].EndMs = 2100
	if _, err := shopClipASS("subtitle", plan, 720, 1280); err == nil {
		t.Fatal("accepted subtitle beyond source duration")
	}
}

func TestShopClipRenderStoresRealVideoAndRejectsForeignResource(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg not installed")
	}
	if err := shopClipRenderCapability("subtitle"); err != nil {
		t.Fatal(err)
	}
	ffmpeg, err := renderFfmpegBinary()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	if out, err := cliprender.Run(context.Background(), ffmpeg, []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=red:s=320x180:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", source}, dir); err != nil {
		t.Fatalf("fixture %v %s", err, out)
	}
	payload, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	s := newResourceTestService(t)
	resource, _, err := s.storeResource("clip-user", "media", "input.mp4", "video/mp4", int64(len(payload)), 320, 180, 1000, bytes.NewReader(payload), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	plan := ShopClipPlan{SourceResourceID: resource.ID, DurationMs: 1000, TemplateID: "clean", Transcript: []ShopClipCue{{StartMs: 0, EndMs: 1000, Text: "真实字幕"}}}
	id, err := s.renderShopClip(context.Background(), "clip-user", "subtitle", plan)
	if err != nil {
		t.Fatal(err)
	}
	got, body, err := s.OpenResource("clip-user", id)
	if err != nil {
		t.Fatal(err)
	}
	body.Close()
	if got.MimeType != "video/mp4" || got.Width != 320 || got.Height != 180 || got.Size <= 0 {
		t.Fatalf("bad stored output: %#v", got)
	}
	if _, err := s.renderShopClip(context.Background(), "foreign-user", "subtitle", plan); err == nil {
		t.Fatal("foreign resource was rendered")
	}
	prepared, cleanup, err := s.inspectShopClipAssets(context.Background(), "clip-user", plan)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if _, err := s.renderShopClip(context.Background(), "foreign-user", "subtitle", plan, prepared); err == nil {
		t.Fatal("prepared files bypassed resource ownership")
	}
	if _, err := s.renderShopClip(context.Background(), "clip-user", "subtitle", plan, prepared); err != nil {
		t.Fatalf("reuse validated media: %v", err)
	}
	if _, err := s.materializeShopClipMedia(context.Background(), "clip-user", "missing", dir, 99); err == nil {
		t.Fatal("missing resource was materialized")
	}
}

func TestShopClipBehindRequiresExplicitSubjectAndModel(t *testing.T) {
	if err := shopClipSubjectBox(nil); err == nil {
		t.Fatal("accepted implicit subject")
	}
	if err := shopClipSubjectBox([]float64{0.8, 0.2, 0.4, 0.5}); err == nil {
		t.Fatal("accepted out-of-frame subject")
	}
	if err := shopClipSubjectBox([]float64{0.1, 0.1, 0.7, 0.8}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_SHOP_CLIP_PYTHON", filepath.Join(t.TempDir(), "missing-python"))
	if _, _, _, err := shopClipMaskCommand(); err == nil {
		t.Fatal("missing worker presented as available")
	}
}
