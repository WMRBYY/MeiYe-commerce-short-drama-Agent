package app

import (
	"strings"
	"testing"
)

func TestAPIMartMidjourneyCapabilityDefaults(t *testing.T) {
	image := DefaultImageCapabilityConfig("apimart-midjourney", "midjourney")
	if image.References.MaxImages != 20 || image.References.MaskSupported || image.References.PromptMaxChars != 4000 {
		t.Fatalf("incorrect Midjourney references: %+v", image.References)
	}
	if image.Size.Parameter != "aspect_ratio" || len(image.Size.Values) != 10 || len(image.Size.Presets) != 10 || image.Size.Default != "1:1" {
		t.Fatalf("incorrect Midjourney ratio contract: %+v", image.Size)
	}
	if !image.Quality.Supported || len(image.Quality.Values) != 4 || image.Quality.Values[0] != "0.25" || image.Quality.Default != "1" || image.MaxOutputs != 1 {
		t.Fatalf("incorrect Midjourney quality/output contract: %+v", image)
	}
	if _, err := NormalizeModelCapabilityConfigForModel("image", "apimart-midjourney", "midjourney", &ModelCapabilityConfig{Version: 1, Image: image}); err != nil {
		t.Fatalf("Midjourney default must pass server admission: %v", err)
	}
}

func TestAPIMartSeedanceCapabilityDefaults(t *testing.T) {
	for _, tc := range []struct {
		model       string
		resolutions int
		promptMax   int
	}{
		{"seedance-2.0", 4, 4000},
		{"seedance-2.0-fast", 2, 4000},
		{"seedance-2.0-mini", 2, DefaultVideoPromptMaxChars},
	} {
		t.Run(tc.model, func(t *testing.T) {
			video := DefaultModelCapabilityConfigForModel("apimart-seedance-2", tc.model).Video
			if video.References.PromptMaxChars != tc.promptMax || video.References.MaxVideos != 3 || video.References.MaxAudios != 3 || video.References.MaxVideoDuration != 15 || video.References.MaxAudioDuration != 15 {
				t.Fatalf("incorrect Seedance references: %+v", video.References)
			}
			if video.Duration.Min != 4 || video.Duration.Max != 15 || video.Duration.Default != 5 || len(video.Resolutions) != tc.resolutions || !video.GenerateAudio.Supported || !video.GenerateAudio.Default {
				t.Fatalf("incorrect Seedance options: %+v", video)
			}
			if _, err := NormalizeModelCapabilityConfigForModel("video", "apimart-seedance-2", tc.model, &ModelCapabilityConfig{Version: 1, Video: video}); err != nil {
				t.Fatalf("Seedance default must pass server admission: %v", err)
			}
		})
	}
}

func TestNezhaSeedance30sCapabilityDefaults(t *testing.T) {
	video := DefaultModelCapabilityConfigForModel("nezhagate-seedance-25-30s", "seedance-2.5-30s").Video
	if video.References.PromptMaxChars != 5000 || video.References.MaxImages != 9 || video.References.MaxImageBytes != 16*1024*1024 || video.References.MaxVideos != 0 || video.References.MaxAudios != 0 {
		t.Fatalf("incorrect reference limits: %+v", video.References)
	}
	if video.Duration.Selection != "enum" || len(video.Duration.Values) != 1 || video.Duration.Values[0] != 30 || video.Duration.Default != 30 || len(video.Resolutions) != 1 || video.Resolutions[0] != "720P" || len(video.Ratios) != 5 || video.GenerateAudio.Supported || !video.GenerateAudio.Default {
		t.Fatalf("incorrect fixed video options: %+v", video)
	}
	if _, err := NormalizeModelCapabilityConfigForModel("video", "nezhagate-seedance-25-30s", "seedance-2.5-30s", &ModelCapabilityConfig{Version: 1, Video: video}); err != nil {
		t.Fatalf("NezhaGate default must pass server admission: %v", err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(&ModelCapabilityConfig{Version: 1, Video: video}, "video")
	if err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "video", Operation: "image_to_video", Inputs: map[string]int{"image": 1}, Options: map[string]any{"size": "16:9", "vquality": "720P", "videoSeconds": 30, "videoGenerateAudio": true, "videoWatermark": false}}
	if match := MatchCapability(spec, intent); !match.Matched {
		t.Fatalf("fixed audio default must be accepted for image-to-video: %+v", match.Issues)
	}
	intent.Options["videoGenerateAudio"] = false
	if match := MatchCapability(spec, intent); match.Matched {
		t.Fatal("fixed audio default must reject an unsupported override")
	}
	input := canvasGenerationInput{Mode: "video", Prompt: strings.Repeat("中", 1666) + "ab", Config: providerConfig{InterfaceType: "nezhagate-seedance-25-30s", Model: "seedance-2.5-30s", VideoSeconds: "30", Size: "16:9", VQuality: "720P"}}
	if err := validateVideoTask(video, input); err != nil {
		t.Fatalf("5000-byte prompt should pass: %v", err)
	}
	input.Prompt += "c"
	if err := validateVideoTask(video, input); err == nil || !strings.Contains(err.Error(), "5000 UTF-8 字节") {
		t.Fatalf("5001-byte prompt should fail: %v", err)
	}
}

func TestNezhaSeedance25CapabilityDefaultsAndReferenceAdmission(t *testing.T) {
	video := DefaultModelCapabilityConfigForModel("nezhagate-seedance-25", "seedance-2.5").Video
	if video.References.PromptMaxChars != 11000 || video.References.MaxImages != 30 || video.References.MaxVideos != 10 || video.References.MaxAudios != 10 || video.Duration.Min != 4 || video.Duration.Max != 30 || len(video.Resolutions) != 3 || video.DefaultResolution != "720P" || video.GenerateAudio.Supported || !video.GenerateAudio.Default {
		t.Fatalf("incorrect Seedance 2.5 defaults: %+v", video)
	}
	if _, err := NormalizeModelCapabilityConfigForModel("video", "nezhagate-seedance-25", "seedance-2.5", &ModelCapabilityConfig{Version: 1, Video: video}); err != nil {
		t.Fatalf("default must pass admission: %v", err)
	}
	input := canvasGenerationInput{Mode: "video", Prompt: strings.Repeat("中", 11000), Config: providerConfig{InterfaceType: "nezhagate-seedance-25", Model: "seedance-2.5", VideoSeconds: "17", Size: "9:16", VQuality: "1080P"}, ReferenceVideos: []providerMedia{{URL: "https://example.com/a.mp4", DurationMs: 15000}, {URL: "https://example.com/b.mp4", DurationMs: 15000}}, ReferenceAudios: []providerMedia{{URL: "https://example.com/audio.mp3", DurationMs: 30000}}}
	if err := validateVideoTask(video, input); err != nil {
		t.Fatalf("valid mixed references rejected: %v", err)
	}
	input.ReferenceVideos[1].DurationMs = 15001
	if err := validateVideoTask(video, input); err == nil || !strings.Contains(err.Error(), "总时长") {
		t.Fatalf("video total duration should fail: %v", err)
	}
	input.ReferenceVideos = nil
	if err := validateVideoTask(video, input); err == nil || !strings.Contains(err.Error(), "参考音频") {
		t.Fatalf("audio without image/video should fail: %v", err)
	}
	input.ReferenceVideos = []providerMedia{{URL: "https://example.com/a.mp4", Bytes: 50 * 1024 * 1024}, {URL: "https://example.com/b.mp4", Bytes: 50 * 1024 * 1024}, {URL: "https://example.com/c.mp4", Bytes: 1}}
	if err := validateVideoTask(video, input); err == nil || !strings.Contains(err.Error(), "总大小") {
		t.Fatalf("video total bytes should fail: %v", err)
	}
}
