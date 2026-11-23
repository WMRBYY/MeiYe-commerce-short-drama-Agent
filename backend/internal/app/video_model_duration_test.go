package app

import (
	"strconv"
	"testing"
)

func TestTopViewVideoModelDurations(t *testing.T) {
	for _, tc := range []struct {
		name   string
		max    int
		follow bool
	}{
		{"Seedance 2.0", 15, false}, {"Seedance 2.0 Fast", 15, false}, {"seedance-2.0-style", 15, false},
		{"Seedance 2.0 Mini", 15, false}, {"Seedance 2.5", 30, true}, {"seedance-2.5", 30, true}, {"Topview T1", 30, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel("topview-video", tc.name)
			if profile.Video.Duration.Min != 4 || profile.Video.Duration.Max != tc.max {
				t.Fatalf("duration = %+v", profile.Video.Duration)
			}
			// 模拟已保存的通用 1–60 秒配置，服务端仍须以供应商限制校验。
			profile.Video.Duration = VideoDurationConfig{Selection: "range", Min: 1, Max: 60, Step: 1, Default: 1}
			profile.Video.References.MaxVideos = 3
			normalized, err := NormalizeModelCapabilityConfigForModel("video", "topview-video", tc.name, profile)
			if err != nil {
				t.Fatal(err)
			}
			if normalized.Video.Duration.Min != 4 || normalized.Video.Duration.Max != tc.max || normalized.Video.References.MaxVideoDuration != tc.max {
				t.Fatalf("normalized = %+v", normalized.Video)
			}
			for _, seconds := range []int{3, 4, tc.max, tc.max + 1} {
				err := validateVideoTask(normalized.Video, canvasGenerationInput{Config: providerConfig{VideoSeconds: strconv.Itoa(seconds)}})
				if (err == nil) != (seconds >= 4 && seconds <= tc.max) {
					t.Fatalf("%d seconds: %v", seconds, err)
				}
			}
		})
	}
}
