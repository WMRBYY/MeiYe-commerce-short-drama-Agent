package cliprender

import (
	"context"
	"crypto/sha256"
	"errors"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestEffectEnumsRejectFilterExpressions(t *testing.T) {
	for _, in := range []Input{
		{Filter: "movie=/etc/passwd"}, {Filter: "warm|cool"}, {Transition: "fade;null"}, {Layout: "pip:eval=frame"},
	} {
		in.Source, in.Width, in.Height, in.DurationMs = "source", 320, 180, 1000
		if err := Validate(in); err == nil {
			t.Fatalf("accepted unsafe effect: %#v", in)
		}
	}
}

func TestRealTransitionsAndPictureInPicture(t *testing.T) {
	ffmpeg := ffmpegForTest(t)
	sourceDir := t.TempDir()
	source, insert, _ := fixture(t, ffmpeg, sourceDir)
	for _, transition := range []string{"cut", "dissolve", "slide"} {
		for _, layout := range []string{"full", "pip"} {
			t.Run(transition+"/"+layout, func(t *testing.T) {
				output, err := Render(context.Background(), ffmpeg, t.TempDir(), Input{Source: source, Width: 320, Height: 180, DurationMs: 2000,
					HasAudio: true, Transition: transition, Layout: layout,
					Placements: []Placement{{Path: insert, StartMs: 500, EndMs: 1500, SourceDurationMs: 2000}}})
				if err != nil {
					t.Fatal(err)
				}
				for _, at := range []string{"0.2", "1.0", "1.8"} {
					p := pixels(t, ffmpeg, output, at)
					center := (80*320 + 220) * 3
					blue := at == "1.0"
					if blue && !(p[center+2] > 180 && p[center] < 60) {
						t.Fatalf("insert absent at %s: %v", at, p[center:center+3])
					}
					if !blue && !(p[center] > 180 && p[center+2] < 60) {
						t.Fatalf("source lost at %s: %v", at, p[center:center+3])
					}
					if layout == "pip" {
						corner := (20*320 + 20) * 3
						if !(p[corner] > 180 && p[corner+2] < 60) {
							t.Fatal("picture-in-picture replaced the main frame")
						}
					}
				}
				if transition == "dissolve" {
					p := pixels(t, ffmpeg, output, "0.6")
					i := (80*320 + 220) * 3
					if p[i] < 50 || p[i+2] < 50 {
						t.Fatalf("dissolve did not blend both images: %v", p[i:i+3])
					}
				}
				if transition == "slide" && layout == "full" {
					p := pixels(t, ffmpeg, output, "0.6")
					left, right := (80*320+20)*3, (80*320+280)*3
					if p[left] < 180 || p[right+2] < 180 {
						t.Fatal("slide did not preserve both sides during entrance")
					}
				}
				audio, err := exec.Command(ffmpeg, "-v", "error", "-i", output, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1").Output()
				if err != nil || math.Abs(float64(len(audio))/16000-2) > 0.1 {
					t.Fatalf("continuous speech duration changed: %v bytes=%d", err, len(audio))
				}
			})
		}
	}
}

func TestRealColorFilters(t *testing.T) {
	ffmpeg := ffmpegForTest(t)
	dir := t.TempDir()
	source := filepath.Join(dir, "neutral.mp4")
	if logs, err := Run(context.Background(), ffmpeg, []string{"-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=1", "-c:v", "libx264", "-threads", "1", source}, dir); err != nil {
		t.Fatalf("source: %v %s", err, logs)
	}
	seen := map[[32]byte]string{}
	for _, name := range []string{"original", "warm", "cool", "soft", "crisp", "mono"} {
		output, err := Render(context.Background(), ffmpeg, t.TempDir(), Input{Source: source, Width: 320, Height: 180, DurationMs: 1000, Filter: name})
		if err != nil {
			t.Fatal(err)
		}
		p := pixels(t, ffmpeg, output, "0.5")
		color := [3]byte{p[0], p[1], p[2]}
		digest := sha256.Sum256(p)
		if prior, ok := seen[digest]; ok {
			t.Fatalf("%s and %s produced identical frames", prior, name)
		}
		seen[digest] = name
		if name == "mono" && (math.Abs(float64(p[0])-float64(p[1])) > 3 || math.Abs(float64(p[1])-float64(p[2])) > 3) {
			t.Fatalf("monochrome still colored: %v", color)
		}
	}
}

func TestRealTrimResetsTimelineAndKeepsAudio(t *testing.T) {
	ffmpeg := ffmpegForTest(t)
	dir := t.TempDir()
	source, insert, _ := fixture(t, ffmpeg, dir)
	// A changing source makes a missing -ss observable in the output pixels.
	composite, err := Render(context.Background(), ffmpeg, t.TempDir(), Input{Source: source, Width: 320, Height: 180, DurationMs: 2000, HasAudio: true,
		Placements: []Placement{{Path: insert, StartMs: 1000, EndMs: 2000, SourceDurationMs: 2000}}})
	if err != nil {
		t.Fatal(err)
	}
	output, err := Trim(context.Background(), ffmpeg, dir, composite, 1250, 1750)
	if err != nil {
		t.Fatal(err)
	}
	p := pixels(t, ffmpeg, output, "0.1")
	if p[0] > 60 || p[2] < 180 {
		t.Fatalf("trim used wrong source interval: %v", p[:3])
	}
	audio, err := exec.Command(ffmpeg, "-v", "error", "-i", output, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1").Output()
	if err != nil || math.Abs(float64(len(audio))/16000-0.5) > 0.08 {
		t.Fatalf("trimmed audio duration: %v bytes=%d", err, len(audio))
	}
	for _, times := range [][2]int64{{-1, 100}, {500, 500}, {math.MaxInt64 - 1, math.MaxInt64}} {
		if _, err := Trim(context.Background(), ffmpeg, dir, source, times[0], times[1]); err == nil {
			t.Fatal("accepted invalid trim")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cancelDir := t.TempDir()
	if _, err := Trim(ctx, ffmpeg, cancelDir, source, 0, 1000); !errors.Is(err, context.Canceled) {
		t.Fatalf("trim ignored cancellation: %v", err)
	}
	entries, _ := os.ReadDir(cancelDir)
	if len(entries) != 0 {
		t.Fatal("cancelled trim left output")
	}
}
