package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestDoubaoAudioUsesProviderOriginalDurationForBilling(t *testing.T) {
	service := &Service{}
	task := model.Task{Type: "audio_generate", ResultJSON: `{"mode":"audio","audio":{"resourceId":"saved-audio","durationMs":2000,"billingDurationMs":2500}}`}
	duration, err := service.AudioOutputDurationMs(task)
	if err != nil || duration != 2500 {
		t.Fatalf("duration = %d, error = %v", duration, err)
	}
}
