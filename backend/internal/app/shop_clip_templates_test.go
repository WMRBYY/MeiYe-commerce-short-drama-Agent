package app

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"yingce/backend/internal/cliprender"
)

func TestShopClipTemplatesHaveRenderableContracts(t *testing.T) {
	templates := shopClipTemplates()
	if len(templates) < 18 {
		t.Fatal("template collection incomplete")
	}
	seen := map[string]bool{}
	for _, template := range templates {
		if seen[template.ID] || template.ID == "" || template.Name == "" || template.Description == "" || template.Group == "" || len(template.Tags) == 0 {
			t.Fatalf("invalid template metadata: %#v", template)
		}
		seen[template.ID] = true
		if !renderHexColor.MatchString(template.Preview.Foreground) || !renderHexColor.MatchString(template.Preview.Background) || !renderHexColor.MatchString(template.Preview.Accent) {
			t.Fatalf("invalid preview color in %s", template.ID)
		}
		for _, mode := range template.Modes {
			if err := validateShopClipVisual(template.ID, ShopClipVisual{}, mode); err != nil {
				t.Fatalf("%s/%s: %v", template.ID, mode, err)
			}
		}
	}
	for _, legacy := range []string{"clean", "bold", "pop"} {
		if !seen[legacy] {
			t.Fatalf("missing existing template %s", legacy)
		}
	}
	for _, request := range []struct {
		id, mode string
		visual   ShopClipVisual
	}{
		{"missing", "koubo", ShopClipVisual{}},
		{"clean", "koubo", ShopClipVisual{Filter: "movie=/etc/passwd"}},
		{"clean", "koubo", ShopClipVisual{SubtitleStyle: `\pos(0,0)`}},
		{"clean", "koubo", ShopClipVisual{Transition: "dissolve"}},
		{"clean", "subtitle", ShopClipVisual{Layout: "pip"}},
		{"pip-review", "koubo", ShopClipVisual{}},
		{"clean", "behind", ShopClipVisual{Filter: "warm"}},
	} {
		if err := validateShopClipVisual(request.id, request.visual, request.mode); err == nil {
			t.Fatalf("accepted unsupported visual: %#v", request)
		}
	}
}

// Uses the actual renderer and decoded pixels. CSS previews or merely distinct
// metadata do not prove that templates produce distinct finished videos.
func TestShopClipTemplatesRenderDistinctFrames(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("FFmpeg not installed")
	}
	for _, font := range []string{"sans-bold", "serif-bold"} {
		if _, _, err := renderTextFace(font); err != nil {
			t.Skip("CJK font not installed")
		}
	}
	dir := t.TempDir()
	source, insert := filepath.Join(dir, "source.mp4"), filepath.Join(dir, "insert.mp4")
	for _, fixture := range []struct{ path, color string }{{source, "0x667788"}, {insert, "0x995533"}} {
		if logs, err := cliprender.Run(context.Background(), ffmpeg, []string{"-v", "error", "-y", "-f", "lavfi", "-i", "color=c=" + fixture.color + ":s=360x640:r=30:d=1", "-c:v", "libx264", "-threads", "1", fixture.path}, dir); err != nil {
			t.Fatalf("fixture: %v %s", err, logs)
		}
	}
	frames := map[[32]byte]string{}
	for _, template := range shopClipTemplates() {
		t.Run(template.ID, func(t *testing.T) {
			mode := template.Modes[0]
			plan := ShopClipPlan{TemplateID: template.ID, Title: "每个细节都值得认真看", DurationMs: 1000,
				Transcript: []ShopClipCue{{StartMs: 0, EndMs: 1000, Text: "这一处细节，镜头拉近就能看清。"}}}
			ass, err := shopClipASS(mode, plan, 360, 640)
			if err != nil {
				t.Fatal(err)
			}
			in := cliprender.Input{Source: source, Width: 360, Height: 640, DurationMs: 1000, ASS: ass, Pop: template.ID == "pop",
				Filter: template.Visual.Filter, Transition: template.Visual.Transition, Layout: template.Visual.Layout}
			if mode == "mix" {
				in.Placements = []cliprender.Placement{{Path: insert, StartMs: 0, EndMs: 1000, SourceDurationMs: 1000}}
			}
			output, err := cliprender.Render(context.Background(), ffmpeg, t.TempDir(), in)
			if err != nil {
				t.Fatal(err)
			}
			frame, err := exec.Command(ffmpeg, "-v", "error", "-ss", "0.5", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1").Output()
			if err != nil || len(frame) != 360*640*3 {
				t.Fatalf("decode template frame: %v bytes=%d", err, len(frame))
			}
			key := sha256.Sum256(frame)
			if previous, duplicate := frames[key]; duplicate {
				t.Fatalf("%s and %s rendered identical frames", previous, template.ID)
			}
			frames[key] = template.ID
			// Panels and bubbles must actually paint an area behind the text,
			// rather than exist only in template labels or preview metadata.
			if template.Visual.SubtitleStyle == "bubble" {
				changed := 0
				for y := 550; y < 602; y++ {
					for x := 40; x < 320; x++ {
						i := (y*360 + x) * 3
						if frame[i] > 160 && frame[i+1] > 160 && frame[i+2] > 160 {
							changed++
						}
					}
				}
				if changed < 1500 {
					t.Fatalf("bubble panel missing or outside subtitle band: %d bright pixels", changed)
				}
			}
			if artifacts := os.Getenv("SHOP_CLIP_LAYOUT_OUTPUT_DIR"); artifacts != "" {
				if err := os.MkdirAll(artifacts, 0755); err != nil {
					t.Fatal(err)
				}
				if logs, err := cliprender.Run(context.Background(), ffmpeg, []string{"-v", "error", "-y", "-ss", "0.5", "-i", output, "-frames:v", "1", filepath.Join(artifacts, fmt.Sprintf("template-%s.png", template.ID))}, dir); err != nil {
					t.Fatalf("write evidence: %v %s", err, logs)
				}
			}
		})
	}
}
