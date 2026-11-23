package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestDirectTaskExplicitRetryGetsNewAttempt(t *testing.T) {
	s, _ := newMediaRecoveryTestService(t)
	task := &model.Task{ID: "direct-retry", Attempts: 2}
	if _, err := s.createDirectTaskAttempt(task); !isRouteDispatchUncertain(err) {
		t.Fatalf("worker recovery without submission evidence must be blocked: %v", err)
	}
	task.RouteRun = 1 // RetryTaskWithBilling advances a direct task from 0 to 1.
	attempt, err := s.createDirectTaskAttempt(task)
	if err != nil {
		t.Fatal(err)
	}
	if attempt.RouteRun != 1 || attempt.DispatchState != "not_sent" || attempt.SubmissionKey == "" {
		t.Fatalf("explicit retry did not get a fresh unsent attempt: %+v", attempt)
	}
	resumed, err := s.beginTaskRouteAttempt(task)
	if err != nil || resumed.ID != attempt.ID {
		t.Fatalf("recovery must reuse the persisted retry attempt: %+v, %v", resumed, err)
	}
}
