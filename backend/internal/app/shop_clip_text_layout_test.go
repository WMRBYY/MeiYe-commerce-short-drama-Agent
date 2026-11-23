package app

import (
	"bytes"
	"context"
	"fmt"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/cliprender"
)

func TestShopClipFitTextPreservesLongCaptions(t *testing.T) {
	for _, text := range []string{strings.Repeat("商品细节", 20), "This longer English sentence must remain readable without clipping the frame.", strings.Repeat("W", 80), "新品上市 👩🏻‍💻 一起看看商品细节"} {
		wrapped, size := shopClipFitText(text, 12, 260)
		if strings.Join(strings.Fields(wrapped), "") != strings.Join(strings.Fields(text), "") {
			t.Fatalf("text lost: %q => %q", text, wrapped)
		}
		if strings.Count(wrapped, "\n") > 1 || size <= 0 || size > 12 {
			t.Fatalf("invalid fitted caption %q at %f", wrapped, size)
		}
	}
}

func TestShopClipOpeningTitleDoesNotOverlapEmphasis(t *testing.T) {
	if _, _, err := renderTextFace("sans-bold"); err != nil {
		t.Skip("CJK font not installed")
	}
	plan := ShopClipPlan{TemplateID: "pop", Title: "新品上市", DurationMs: 4000, Transcript: []ShopClipCue{{StartMs: 0, EndMs: 1000, Text: "第一句"}, {StartMs: 1000, EndMs: 4000, Text: "第二句"}}}
	ass, err := shopClipASS("koubo", plan, 320, 180)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ass, "Dialogue: 1,0:00:03.00,0:00:04.00,Point") || strings.Contains(ass, "Dialogue: 1,0:00:01.00,0:00:04.00,Point") {
		t.Fatal("emphasis must wait for the opening title")
	}
}

func TestShopClipASSPreservesEscapedCaptionTail(t *testing.T) {
	if _, _, err := renderTextFace("sans-bold"); err != nil {
		t.Skip("CJK font not installed")
	}
	for _, text := range []string{strings.Repeat("字", 79) + "末", strings.Repeat("{\\}", 25) + "末尾"} {
		plan := ShopClipPlan{TemplateID: "clean", DurationMs: 1000, Transcript: []ShopClipCue{{StartMs: 0, EndMs: 1000, Text: text}}}
		ass, err := shopClipASS("subtitle", plan, 180, 320)
		if err != nil {
			t.Fatal(err)
		}
		wrapped, _ := shopClipFitCaption(text, 180*0.055, 180, 320)
		if !strings.Contains(ass, escapeShopClipASS(wrapped)+"\n") || !strings.Contains(ass, "末") {
			t.Fatal("ASS escaping truncated the caption")
		}
	}
}

func TestShopClipTextBandsRenderWithoutCollision(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("FFmpeg not installed")
	}
	if _, _, err := renderTextFace("sans-bold"); err != nil {
		t.Skip("CJK font not installed")
	}
	for _, size := range [][2]int{{320, 180}, {180, 320}, {1280, 720}, {720, 1280}} {
		for _, latin := range []bool{false, true} {
			t.Run(fmt.Sprintf("%dx%d/latin-%t", size[0], size[1], latin), func(t *testing.T) {
				dir := t.TempDir()
				source := filepath.Join(dir, "source.mp4")
				if _, err := cliprender.Run(context.Background(), ffmpeg, []string{"-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", fmt.Sprintf("color=c=0x204060:s=%dx%d:r=25:d=1", size[0], size[1]), "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", source}, dir); err != nil {
					t.Fatal(err)
				}
				plan := ShopClipPlan{TemplateID: "pop", Title: strings.Repeat("新品上市", 7), DurationMs: 1000, Transcript: []ShopClipCue{{StartMs: 0, EndMs: 1000, Text: strings.Repeat("真实字幕校对", 13)}}}
				if latin {
					plan.Title = strings.Repeat("W", 30)
					plan.Transcript[0].Text = strings.Repeat("W", 80)
				}
				ass, err := shopClipASS("koubo", plan, size[0], size[1])
				if err != nil {
					t.Fatal(err)
				}
				output, err := cliprender.Render(context.Background(), ffmpeg, dir, cliprender.Input{Source: source, Width: size[0], Height: size[1], DurationMs: 1000, ASS: ass, Pop: true})
				if err != nil {
					t.Fatal(err)
				}
				frame := filepath.Join(dir, "frame.png")
				if _, err := cliprender.Run(context.Background(), ffmpeg, []string{"-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", output, "-frames:v", "1", frame}, dir); err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(frame)
				if err != nil {
					t.Fatal(err)
				}
				img, err := png.Decode(bytes.NewReader(data))
				if err != nil {
					t.Fatal(err)
				}
				upper, lower, middle, edge := 0, 0, 0, 0
				for y := 0; y < size[1]; y++ {
					for x := 0; x < size[0]; x++ {
						r, g, b, _ := img.At(x, y).RGBA()
						if r < 45000 || g < 45000 || b < 45000 {
							continue
						}
						if y < size[1]*4/10 {
							upper++
						} else if y >= size[1]*6/10 {
							lower++
						} else {
							middle++
						}
						if x < size[0]/25 || x >= size[0]*24/25 || y < size[1]/25 || y >= size[1]*24/25 {
							edge++
						}
					}
				}
				if upper == 0 || lower == 0 || middle != 0 || edge != 0 {
					t.Fatalf("text left its bands: upper=%d lower=%d middle=%d edge=%d", upper, lower, middle, edge)
				}
				if artifacts := os.Getenv("SHOP_CLIP_LAYOUT_OUTPUT_DIR"); artifacts != "" {
					if err := os.MkdirAll(artifacts, 0755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(artifacts, fmt.Sprintf("%dx%d-latin-%t.png", size[0], size[1], latin)), data, 0644); err != nil {
						t.Fatal(err)
					}
				}
			})
		}
	}
}
