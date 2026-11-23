package app

import (
	"math"
	"testing"
)

func TestCloudAgentDraftSize(t *testing.T) {
	for _, kind := range []string{"image", "video"} {
		width, height, err := cloudAgentDraftSize(kind, "16:9", 720, 520)
		if err != nil || width == nil || height == nil || math.Abs(*width / *height - 16.0/9.0) > 0.001 {
			t.Fatalf("%s draft should be 16:9: %v %v %v", kind, width, height, err)
		}
	}
	if _, _, err := cloudAgentDraftSize("text", "16:9", 340, 240); err == nil {
		t.Fatal("text draft must reject media size")
	}
	if _, _, err := cloudAgentDraftSize("image", "bad", 720, 520); err == nil {
		t.Fatal("invalid size must be rejected")
	}
}
