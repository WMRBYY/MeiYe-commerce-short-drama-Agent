package app

import (
	"context"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestRetryEnforcesCurrentGroupWithCreditsDisabled(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "group-admin", Role: model.UserRoleAdmin}
	group, err := s.CreateUserGroup(admin, UserGroupRequest{Code: "retry-restricted", Name: "Restricted", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.User{}).Where("id = ?", "user").Update("user_group", "retry-restricted").Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"creditsEnabled":false}`}).Error; err != nil {
		t.Fatal(err)
	}
	if enabled, err := s.FeatureEnabled(FeatureCredits); err != nil || enabled {
		t.Fatalf("credits should be disabled: %v %v", enabled, err)
	}
	task := model.Task{ID: "retry-group", UserID: "user", Type: "canvas_text", Operation: "text", Status: model.TaskStatusFailed, InputJSON: `{"mode":"text","config":{"channelId":"channel","model":"text-test"}}`}
	if err = db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err = s.RetryTask("user", task.ID); err == nil || !strings.Contains(err.Error(), "分组") {
		t.Fatalf("restricted retry should fail on group: %v", err)
	}
	var after model.Task
	if err = db.First(&after, "id = ?", task.ID).Error; err != nil || after.Status != model.TaskStatusFailed {
		t.Fatalf("rejected retry mutated task: %+v %v", after, err)
	}
	if _, err = s.UpdateUserGroup(admin, group.ID, UserGroupRequest{Name: "Restricted", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale, ChannelIDs: []string{"channel"}}); err != nil {
		t.Fatal(err)
	}
	if retried, err := s.RetryTask("user", task.ID); err != nil || retried.Status != model.TaskStatusQueued {
		t.Fatalf("authorized retry: %+v %v", retried, err)
	}
}

func TestRetryAccessSupportsLegacySystemURLsAndLogicalRoutes(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "group-admin", Role: model.UserRoleAdmin}
	g, err := s.CreateUserGroup(admin, UserGroupRequest{Code: "retry-paths", Name: "Restricted", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.User{}).Where("id = ?", "user").Update("user_group", "retry-paths").Error; err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		task  model.Task
		input map[string]any
	}{
		{"legacy_system_url", model.Task{}, map[string]any{"config": map[string]any{"baseUrl": "https://example.com/api/ai/system/channel"}}},
		{"logical_snapshot", model.Task{LogicalModelID: "archived", ChannelModelID: "cm"}, map[string]any{}},
	}
	for _, tc := range cases {
		if err := s.requireRetryChannelAccess("user", &tc.task, tc.input); err == nil {
			t.Errorf("%s escaped group", tc.name)
		}
	}
	custom := map[string]any{"config": map[string]any{"baseUrl": "https://custom.example/v1", "apiKey": "key"}}
	if err := s.requireRetryChannelAccess("user", &model.Task{}, custom); err != nil {
		t.Fatalf("custom channel unexpectedly restricted: %v", err)
	}
	if _, err = s.UpdateUserGroup(admin, g.ID, UserGroupRequest{Name: "Restricted", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale, ChannelIDs: []string{"channel"}}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		if err := s.requireRetryChannelAccess("user", &tc.task, tc.input); err != nil {
			t.Errorf("%s authorized: %v", tc.name, err)
		}
	}
}

func TestQueuedTaskRechecksRevokedGroupBeforeDispatch(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "group-admin", Role: model.UserRoleAdmin}
	g, err := s.CreateUserGroup(admin, UserGroupRequest{Code: "queued-revoked", Name: "Queued", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale, ChannelIDs: []string{"channel"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.User{}).Where("id = ?", "user").Update("user_group", "queued-revoked").Error; err != nil {
		t.Fatal(err)
	}
	req := creationTextRequest()
	req.Input["metadata"] = map[string]any{"source": "drama_production"}
	task, err := s.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	orderID := task.BillingOrderID
	if orderID == "" {
		t.Fatal("test requires reserved order")
	}
	if _, err = s.UpdateUserGroup(admin, g.ID, UserGroupRequest{Name: "Queued", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale}); err != nil {
		t.Fatal(err)
	}
	claimed, err := s.repo.ClaimNextTask("test-worker", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim: %v", err)
	}
	s.activeCancels = map[string]context.CancelFunc{}
	probe := &queuedChannelExecutionProbe{Service: s}
	s.taskRouteExecutor = &taskRouteExecutor{port: probe}
	select {
	case <-dramaWakeChannel():
	default:
	}
	_ = s.taskWorker().processClaimedTask(claimed, nil)
	select {
	case <-dramaWakeChannel():
	default:
		t.Fatal("drama task completion must immediately wake the scheduler")
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || probe.calls != 0 || !strings.Contains(stored.Error, "分组") {
		t.Fatalf("revoked task dispatched: %+v calls=%d err=%v", stored, probe.calls, err)
	}
	order, err := s.repo.BillingOrder(orderID)
	if err != nil || order.Status != model.BillingStatusRefunded {
		t.Fatalf("unsent order not refunded: %+v %v", order, err)
	}
}
