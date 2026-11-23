package app

import (
	"strings"
	"testing"
)

func TestShopClipIndependentWhisperConfiguration(t *testing.T) {
	s, _ := newTimelineTaskTestService(t)
	t.Setenv(shopClipWhisperEnv, "http://127.0.0.1:9000")
	t.Setenv(whisperLangEnv, "")
	if tr, reason := s.shopClipTranscriberFor("clip-user"); tr == nil || reason != "" {
		t.Fatalf("dedicated ASR rejected: %s", reason)
	}
	if err := s.shopClipAnalysisCapability("clip-user", "subtitle"); err != nil {
		t.Fatalf("capability disagrees with selector: %v", err)
	}
	t.Setenv(shopClipWhisperEnv, "")
	if tr, reason := s.shopClipTranscriberFor("clip-user"); tr != nil || !strings.Contains(reason, "视频理解听写") {
		t.Fatalf("vision used as timestamps: %s", reason)
	}
	if err := s.shopClipAnalysisCapability("clip-user", "subtitle"); err == nil {
		t.Fatal("unconfigured precise ASR advertised available")
	}
}

func TestShopClipIndependentWhisperRejectsMalformedURL(t *testing.T) {
	s := &Service{}
	for _, raw := range []string{"file:///tmp/whisper", "http://", "https://secret@whisper.local", "https://whisper.local?token=secret"} {
		t.Setenv(shopClipWhisperEnv, raw)
		if tr, reason := s.shopClipTranscriberFor("user"); tr != nil || reason == "" || strings.Contains(reason, "secret") {
			t.Fatalf("invalid URL not safely rejected: %s", reason)
		}
	}
}
