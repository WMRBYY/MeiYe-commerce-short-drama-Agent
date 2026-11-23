package cliprender

import (
	"context"
	"encoding/binary"
	"errors"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testASS = "[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, BorderStyle, Outline, Alignment, MarginL, MarginR, MarginV\nStyle: Default,Arial,48,&H00FFFFFF,&H00111111,-1,1,0,5,0,0,0\n\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:02.00,Default,SALE\n"

func ffmpegForTest(t *testing.T) string {
	t.Helper()
	bin := os.Getenv("CANVAS_FFMPEG_PATH")
	if bin == "" {
		var err error
		bin, err = exec.LookPath("ffmpeg")
		if err != nil {
			t.Skip("FFmpeg not installed")
		}
	}
	if _, err := exec.LookPath(bin); err != nil {
		t.Fatalf("configured FFmpeg unavailable: %v", err)
	}
	return bin
}

func fixture(t *testing.T, ffmpeg, dir string) (string, string, string) {
	t.Helper()
	main, insert, music := filepath.Join(dir, "source.mp4"), filepath.Join(dir, "insert.mp4"), filepath.Join(dir, "music.wav")
	for _, args := range [][]string{
		{"-f", "lavfi", "-i", "color=red:s=320x180:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", main},
		{"-f", "lavfi", "-i", "color=blue:s=320x180:r=30:d=2", "-c:v", "libx264", "-threads", "1", insert},
		{"-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=1", music},
	} {
		if out, err := Run(context.Background(), ffmpeg, append([]string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y"}, args...), dir); err != nil {
			t.Fatalf("fixture: %v %s", err, out)
		}
	}
	return main, insert, music
}

func pixels(t *testing.T, ffmpeg, path, at string) []byte {
	t.Helper()
	out, err := exec.Command(ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", at, "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1").Output()
	if err != nil || len(out) != 320*180*3 {
		t.Fatalf("frame decode: %v bytes=%d", err, len(out))
	}
	return out
}

func TestRenderRealMixPreservesSpeechAndAddsMusic(t *testing.T) {
	ffmpeg := ffmpegForTest(t)
	dir := t.TempDir()
	source, broll, music := fixture(t, ffmpeg, dir)
	in := Input{Source: source, Width: 320, Height: 180, DurationMs: 2000, ASS: testASS, HasAudio: true, Music: music, MusicVolume: 0.3,
		Placements: []Placement{{Path: broll, StartMs: 500, EndMs: 1500, SourceStartMs: 200, SourceDurationMs: 2000}}}
	output, err := Render(context.Background(), ffmpeg, dir, in)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		at   string
		blue bool
	}{{"0.2", false}, {"1.0", true}, {"1.8", false}} {
		p := pixels(t, ffmpeg, output, tc.at)
		r, b := p[(10*320+10)*3], p[(10*320+10)*3+2]
		if (tc.blue && !(b > 180 && r < 50)) || (!tc.blue && !(r > 180 && b < 50)) {
			t.Fatalf("wrong selected source at %s: red=%d blue=%d", tc.at, r, b)
		}
	}
	frame := pixels(t, ffmpeg, output, "1.0")
	white := 0
	for y := 60; y < 120; y++ {
		for x := 70; x < 250; x++ {
			p := (y*320 + x) * 3
			if frame[p] > 190 && frame[p+1] > 190 && frame[p+2] > 190 {
				white++
			}
		}
	}
	if white < 100 {
		t.Fatal("ASS subtitle did not render")
	}
	pcm, err := exec.Command(ffmpeg, "-hide_banner", "-loglevel", "error", "-i", output, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1").Output()
	if err != nil {
		t.Fatal(err)
	}
	if len(pcm) < int(1.95*8000)*4 || len(pcm) > int(2.1*8000)*4 {
		t.Fatalf("audio duration changed: %d samples", len(pcm)/4)
	}
	strength := func(hz float64) float64 {
		var re, im float64
		n := len(pcm) / 4
		for i := 0; i < n; i++ {
			v := float64(math.Float32frombits(binary.LittleEndian.Uint32(pcm[i*4:])))
			angle := 2 * math.Pi * hz * float64(i) / 8000
			re += v * math.Cos(angle)
			im += v * math.Sin(angle)
		}
		return math.Hypot(re, im) / float64(n)
	}
	if strength(440) < 0.02 || strength(880) < 0.0003 {
		t.Fatalf("speech/music missing: %.4f %.4f", strength(440), strength(880))
	}
}

func TestRenderRealForegroundMaskOccludesText(t *testing.T) {
	ffmpeg := ffmpegForTest(t)
	dir := t.TempDir()
	source, _, _ := fixture(t, ffmpeg, dir)
	mask := filepath.Join(dir, "mask.mkv")
	if out, err := Run(context.Background(), ffmpeg, []string{"-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=black:s=320x180:r=30:d=2,drawbox=x=0:y=0:w=160:h=180:color=white:t=fill,format=gray", "-c:v", "ffv1", mask}, dir); err != nil {
		t.Fatalf("mask: %v %s", err, out)
	}
	output, err := Render(context.Background(), ffmpeg, dir, Input{Source: source, Width: 320, Height: 180, DurationMs: 2000, ASS: testASS, Mask: mask})
	if err != nil {
		t.Fatal(err)
	}
	p := pixels(t, ffmpeg, output, "0.5")
	leftWhite, rightWhite := 0, 0
	for y := 60; y < 120; y++ {
		for x := 60; x < 260; x++ {
			i := (y*320 + x) * 3
			if p[i] > 190 && p[i+1] > 190 && p[i+2] > 190 {
				if x < 155 {
					leftWhite++
				} else if x > 165 {
					rightWhite++
				}
			}
		}
	}
	if leftWhite != 0 || rightWhite < 100 {
		t.Fatalf("mask layering wrong: protected white=%d visible white=%d", leftWhite, rightWhite)
	}
}

func TestRenderRealPopAndCancellation(t *testing.T) {
	ffmpeg := ffmpegForTest(t)
	dir := t.TempDir()
	source, _, _ := fixture(t, ffmpeg, dir)
	in := Input{Source: source, Width: 320, Height: 180, DurationMs: 2000, ASS: testASS, Pop: true}
	if _, err := Render(context.Background(), ffmpeg, dir, in); err != nil {
		t.Fatal(err)
	}
	cancelDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Render(ctx, ffmpeg, cancelDir, in); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	entries, _ := os.ReadDir(cancelDir)
	if len(entries) != 0 {
		t.Fatal("cancelled render left files")
	}
	ctx, cancel = context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	_, err := Run(ctx, ffmpeg, []string{"-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc=s=64x64:r=1", "-f", "null", "-"}, cancelDir)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("running cancellation: %v", err)
	}
}

func TestRejectOverlappingOrOutOfRangePlacements(t *testing.T) {
	base := Input{Source: "source", Width: 320, Height: 180, DurationMs: 2000}
	for _, ps := range [][]Placement{
		{{Path: "x", StartMs: 500, EndMs: 2500, SourceDurationMs: 3000}},
		{{Path: "x", StartMs: 0, EndMs: 1000, SourceStartMs: 500, SourceDurationMs: 1200}},
		{{Path: "x", StartMs: 0, EndMs: 1000, SourceStartMs: math.MaxInt64, SourceDurationMs: 2000}},
		{{Path: "x", StartMs: 0, EndMs: 1000, SourceDurationMs: 2000}, {Path: "y", StartMs: 900, EndMs: 1200, SourceDurationMs: 2000}},
	} {
		base.Placements = ps
		if err := Validate(base); err == nil {
			t.Fatal("accepted invalid placement")
		}
	}
	if w, h := Size(3840, 2160); w != 1920 || h != 1080 {
		t.Fatalf("size %d %d", w, h)
	}
	if strings.Contains(testASS, "\\k") {
		t.Fatal("test must not claim word timing")
	}
}
