package app

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestMediaProbeFrameRate(t *testing.T) {
	for _, tc := range []struct{ avg, nominal, want string }{
		{"24/1", "24/1", "24"}, {"50/2", "25/1", "25"},
		{"24000/1001", "24000/1001", "24000/1001"},
		{"0/0", "30000/1001", "30000/1001"}, {"N/A", "0/0", ""},
		{"1/0", "-24/1", ""}, {"1000000/1", "NaN", ""},
		{"24,scale=1:1", "", ""},
	} {
		raw := fmt.Sprintf(`{"streams":[{"width":320,"height":180,"avg_frame_rate":%q,"r_frame_rate":%q}]}`, tc.avg, tc.nominal)
		info, err := parseMediaProbeOutput([]byte(raw))
		if err != nil || info.FrameRate != tc.want {
			t.Fatalf("probe %s/%s: rate=%q err=%v, want %q", tc.avg, tc.nominal, info.FrameRate, err, tc.want)
		}
	}
}

func TestTimelineRenderFrameRateChoice(t *testing.T) {
	for _, tc := range []struct {
		name  string
		rates []string
		want  string
	}{
		{"native24", []string{"24", "48/2"}, "24"},
		{"native25", []string{"25/1", "25"}, "25"},
		{"native30", []string{"30", "30"}, "30"},
		{"fractional", []string{"24000/1001", "48000/2002"}, "24000/1001"},
		{"unknown does not override known", []string{"", "24"}, "24"},
		{"mixed uses existing CFR default", []string{"24", "25"}, "30"},
		{"unknown uses existing default", []string{"", "0/0"}, "30"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan := renderPlan{Segments: []renderSegment{{Kind: "gap"}, {Kind: "image", Source: &renderSource{FrameRate: "25"}}}, AudioOverlays: []renderSegment{{Kind: "audio", Source: &renderSource{FrameRate: "60"}}}}
			for _, rate := range tc.rates {
				plan.Segments = append(plan.Segments, renderSegment{Kind: "video", Source: &renderSource{FrameRate: rate}})
			}
			if got := plan.frameRate(); got != tc.want {
				t.Fatalf("rate=%q, want %q", got, tc.want)
			}
		})
	}
}

// Exercise the actual resource materialization, probe and worker render, with moving
// video plus audible sine input. Metadata-only assertions would miss repeated frames.
func TestTimelineRenderPreservesNativeFrameRate(t *testing.T) {
	requireFFmpegTools(t)
	for _, tc := range []struct {
		rate   string
		frames int
	}{{"24", 48}, {"25", 50}, {"30000/1001", 60}} {
		t.Run(tc.rate, func(t *testing.T) {
			svc, db := newTimelineTaskTestService(t)
			svc.dataDir = t.TempDir()
			source := &model.Resource{ID: newID(), UserID: "usr-render-test", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", CreatedAt: time.Now()}
			source.ObjectKey = source.UserID + "/" + source.ID + ".mp4"
			input := filepath.Join(svc.dataDir, "resources", filepath.FromSlash(source.ObjectKey))
			if err := os.MkdirAll(filepath.Dir(input), 0700); err != nil {
				t.Fatal(err)
			}
			if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate="+tc.rate,
				"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "2.1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", input).CombinedOutput(); err != nil {
				t.Fatalf("generate source: %v %s", err, out)
			}
			stat, err := os.Stat(input)
			if err != nil {
				t.Fatal(err)
			}
			source.Size = stat.Size()
			if err := svc.repo.CreateResource(source); err != nil {
				t.Fatal(err)
			}
			project := renderProject{Version: 2, Width: 320, Height: 180, DurationMs: 2000, Tracks: []renderTrack{{ID: "video", Kind: "video"}}}
			for i := range 2 {
				clip := renderClipFixture(fmt.Sprintf("clip-%d", i), "video", "video", int64(i*1000), 1000, "resource:"+source.ID)
				clip.SourceStartMs = int64(i * 1000)
				project.Clips = append(project.Clips, clip)
			}
			task := seedRunningRenderTask(t, db, renderInputJSON(t, project))
			if err := newTaskWorkerCoordinator(svc).processTimelineRender(task, context.Background()); err != nil {
				t.Fatal(err)
			}
			var stored model.Task
			if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.TaskStatusSucceeded {
				t.Fatalf("render status=%s error=%s", stored.Status, stored.Error)
			}
			var result timelineRenderOutput
			if err := json.Unmarshal([]byte(stored.ResultJSON), &result); err != nil {
				t.Fatal(err)
			}
			resource, err := svc.repo.ResourceForUser(source.UserID, result.ResourceID)
			if err != nil {
				t.Fatal(err)
			}
			output := filepath.Join(svc.dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
			info, err := probeMediaFile(context.Background(), output)
			if err != nil || info.FrameRate != tc.rate || math.Abs(float64(info.DurationMs-2000)) > 50 {
				t.Fatalf("output probe=%+v err=%v; want rate=%s duration=2000ms", info, err, tc.rate)
			}
			frames, err := exec.Command("ffmpeg", "-v", "error", "-i", output, "-map", "0:v:0", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1").Output()
			if err != nil {
				t.Fatal(err)
			}
			const pixels = 320 * 180
			if count := len(frames) / pixels; count != tc.frames {
				t.Fatalf("decoded frames=%d, want %d", count, tc.frames)
			}
			for f := 1; f < tc.frames; f++ {
				var difference int
				for p := 0; p < pixels; p++ {
					difference += int(math.Abs(float64(int(frames[f*pixels+p]) - int(frames[(f-1)*pixels+p]))))
				}
				if float64(difference)/pixels < 0.1 {
					t.Fatalf("near-duplicate decoded motion frame at %s", strconv.Itoa(f))
				}
			}
			audio, err := exec.Command("ffmpeg", "-v", "error", "-i", output, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1").Output()
			if err != nil {
				t.Fatal(err)
			}
			if duration := float64(len(audio)) / 32000; math.Abs(duration-2) > 0.05 {
				t.Fatalf("audio duration=%.3fs", duration)
			}
			var energy float64
			for i := 0; i+1 < len(audio); i += 2 {
				sample := float64(int16(binary.LittleEndian.Uint16(audio[i : i+2])))
				energy += sample * sample
			}
			if energy/float64(len(audio)/2) < 100 {
				t.Fatal("rendered audio lost the source signal")
			}
			t.Logf("native %s fps preserved: %d moving frames, %dms, audible audio %.3fs", tc.rate, tc.frames, info.DurationMs, float64(len(audio))/32000)
		})
	}
}
