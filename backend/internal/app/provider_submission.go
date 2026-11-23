package app

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"yingce/backend/internal/model"
)

type providerSubmissionKeyContext struct{}
type providerAttemptIDContext struct{}
type providerOutboundMarkerContext struct{}

type providerOutboundMarker struct {
	mu      sync.Mutex
	started bool
}

func withProviderSubmissionKey(ctx context.Context, attempt *model.RouteAttempt) context.Context {
	if attempt == nil {
		return ctx
	}
	// Stable for this persisted attempt across worker/process recovery; an
	// explicitly new user retry or a safely rejected route gets a new attempt.
	key := attempt.SubmissionKey
	if key == "" {
		key = routeAttemptSubmissionKey(attempt.TaskID, attempt.ID)
	}
	ctx = context.WithValue(ctx, providerSubmissionKeyContext{}, key)
	ctx = context.WithValue(ctx, providerAttemptIDContext{}, attempt.ID)
	return context.WithValue(ctx, providerOutboundMarkerContext{}, &providerOutboundMarker{})
}

func routeAttemptSubmissionKey(taskID, attemptID string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(taskID+":"+attemptID)).String()
}

func (s *Service) createDirectTaskAttempt(task *model.Task) (*model.RouteAttempt, error) {
	// Direct tasks start at run 0. RetryTaskWithBilling advances the run only
	// after an explicit user retry; worker recovery must still refuse a resend.
	if task.RouteRun == 0 && task.Attempts > 1 && task.ProviderRequestID == "" {
		return nil, routeDispatchUncertainError{"旧任务已尝试执行但缺少提交记录，为避免重复扣费已停止自动重发"}
	}
	id, err := s.repo.NextPrefixedID("ATTEMPT")
	if err != nil {
		return nil, err
	}
	attempt := &model.RouteAttempt{ID: id, TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: 1, ChannelModelID: task.ChannelModelID, SubmissionKey: routeAttemptSubmissionKey(task.ID, id), RequestCorrelationID: task.RequestID, Status: "selected", DispatchState: "not_sent", StartedAt: time.Now()}
	attempt.ProtocolBindingJSON = task.ProtocolBindingJSON
	if task.ProtocolBindingJSON != "" {
		binding, err := decodeTaskProtocolBinding(task.ProtocolBindingJSON)
		if err != nil {
			return nil, err
		}
		attempt.ChannelID, attempt.ChannelModelID = binding.ChannelID, binding.ChannelModelID
	}
	if task.ProviderRequestID != "" {
		attempt.ProviderRequestID, attempt.DispatchState = task.ProviderRequestID, "accepted"
	}
	if err := s.repo.CreateRouteAttempt(attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}
