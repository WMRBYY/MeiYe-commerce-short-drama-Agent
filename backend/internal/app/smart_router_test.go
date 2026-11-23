package app

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestSmartRouteAdmissionRequiresGlobalGroupAndCohort(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:smart-route-admission?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.SmartRoutePolicy{}, &model.LogicalModel{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	policy := model.SmartRoutePolicy{LogicalModelID: "image-group", Enabled: true, Mode: "priority", FailoverEnabled: true, GrayPercent: 100, MaxAttempts: 2}
	if err := db.Create(&policy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.LogicalModel{ID: policy.LogicalModelID, Code: "image-group", Name: "图片", Capability: "image", Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if active, err := svc.smartRouteAdmission("user-a", policy.LogicalModelID); err != nil || active {
		t.Fatalf("global default-off admission = %v, %v", active, err)
	}
	if err := db.Create(&model.SystemSetting{Key: smartRouterGlobalSettingKey, ValueJSON: `{"enabled":true,"allowUserIds":["user-a"]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if active, err := svc.smartRouteAdmission("user-a", policy.LogicalModelID); err != nil || !active {
		t.Fatalf("enabled admission = %v, %v", active, err)
	}
	if active, err := svc.smartRouteAdmission("other-user", policy.LogicalModelID); err != nil || active {
		t.Fatalf("non-allowlisted admission = %v, %v", active, err)
	}
	if err := db.Model(&policy).Update("gray_percent", 0).Error; err != nil {
		t.Fatal(err)
	}
	if active, err := svc.smartRouteAdmission("user-a", policy.LogicalModelID); err != nil || active {
		t.Fatalf("zero-percent admission = %v, %v", active, err)
	}
	if err := db.Model(&policy).Updates(map[string]any{"gray_percent": 100}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.LogicalModel{}).Where("id = ?", policy.LogicalModelID).Update("capability", "video").Error; err != nil {
		t.Fatal(err)
	}
	if active, err := svc.smartRouteAdmission("user-a", policy.LogicalModelID); err != nil || active {
		t.Fatalf("video admission must fail closed = %v, %v", active, err)
	}
}

func TestSmartRouteStatisticsDoNotCountAcceptedTaskAsSuccess(t *testing.T) {
	start := time.Now().Add(-2 * time.Second)
	end := start.Add(time.Second)
	stats := buildSmartRouteStats([]repository.SmartRouteAttemptOutcome{
		{LogicalModelID: "group", AttemptNumber: 1, Status: "succeeded", TaskStatus: string(model.TaskStatusRunning), StartedAt: start, CompletedAt: &end},
		{LogicalModelID: "group", AttemptNumber: 2, Status: "succeeded", TaskStatus: string(model.TaskStatusSucceeded), StartedAt: start, CompletedAt: &end},
	})["group"]
	if stats.Succeeded != 1 || stats.Pending != 1 || stats.Switches != 1 || stats.P50LatencyMs != 1000 {
		t.Fatalf("incorrect final-status statistics: %#v", stats)
	}
}

func TestSmartRouteCompatibilityDefaultsToSameExecutionModel(t *testing.T) {
	candidates := []cachedLogicalRoute{
		{ChannelModel: model.ChannelModel{ID: "same", ModelKey: "gpt-image-2"}},
		{ChannelModel: model.ChannelModel{ID: "other", ModelKey: "nano-banana", Capability: "image"}},
	}
	if got := compatibleLogicalRoutes("GPT-IMAGE-2", candidates, nil); len(got) != 1 || got[0].ChannelModel.ID != "same" {
		t.Fatalf("default compatible routes = %#v", got)
	}
	if got := compatibleLogicalRoutes("gpt-image-2", candidates, map[string]bool{"other": true}); len(got) != 2 {
		t.Fatalf("explicit compatible routes = %#v", got)
	}
	candidates[1].ChannelModel.Capability = "text"
	if got := compatibleLogicalRoutes("gpt-image-2", candidates, map[string]bool{"other": true}); len(got) != 1 {
		t.Fatalf("unverified text family fallback accepted = %#v", got)
	}
}

func TestSmartRouteFallbackPrefersOriginalModelAcrossChannels(t *testing.T) {
	svc := &Service{routeHealthBlocked: map[string]time.Time{}}
	spec := CapabilitySpec{Capability: "image"}
	routes := []cachedLogicalRoute{
		{Route: model.LogicalModelRoute{ID: "other", Enabled: true, Priority: 200, Weight: 1}, ChannelModel: model.ChannelModel{ID: "other", ModelKey: "compatible"}, CapabilitySpec: spec},
		{Route: model.LogicalModelRoute{ID: "same", Enabled: true, Priority: 100, Weight: 1}, ChannelModel: model.ChannelModel{ID: "same", ModelKey: "original"}, CapabilitySpec: spec},
	}
	intent := ModelRequestIntent{Capability: "image"}
	selected := svc.preferredFallbackRoutes("original", routes, intent, nil, false)
	if len(selected) != 1 || selected[0].Route.ID != "same" {
		t.Fatalf("did not prefer same model: %+v", selected)
	}
	selected = svc.preferredFallbackRoutes("original", routes, intent, map[string]bool{"same": true}, false)
	if len(selected) != 1 || selected[0].Route.ID != "other" {
		t.Fatalf("compatible family was not used after same-model exhaustion: %+v", selected)
	}
}

func TestSmartRouteFallbackRespectsUserGroupVisibility(t *testing.T) {
	svc := &Service{routeHealthBlocked: map[string]time.Time{}}
	spec := CapabilitySpec{Capability: "image"}
	routes := []cachedLogicalRoute{
		{Route: model.LogicalModelRoute{ID: "hidden", Enabled: true, Priority: 200, Weight: 1}, ChannelModel: model.ChannelModel{ID: "hidden", ModelKey: "original", ChannelID: "hidden-channel"}, CapabilitySpec: spec},
		{Route: model.LogicalModelRoute{ID: "allowed", Enabled: true, Priority: 100, Weight: 1}, ChannelModel: model.ChannelModel{ID: "allowed", ModelKey: "compatible", ChannelID: "allowed-channel"}, CapabilitySpec: spec},
	}
	access := &userGroupAccess{group: &resolvedUserGroup{channels: map[string]bool{"allowed-channel": true}}}
	selected := svc.preferredFallbackRoutesWithAccess(access, "original", routes, ModelRequestIntent{Capability: "image"}, nil, false)
	if len(selected) != 1 || selected[0].Route.ID != "allowed" {
		t.Fatalf("fallback ignored user group visibility: %+v", selected)
	}
	access.group.channels = map[string]bool{}
	if selected := svc.preferredFallbackRoutesWithAccess(access, "original", routes, ModelRequestIntent{Capability: "image"}, nil, false); len(selected) != 0 {
		t.Fatalf("fallback admitted a hidden channel: %+v", selected)
	}
}

func TestSmartRouteCostCapReservesWholeAttemptBudget(t *testing.T) {
	snapshot := model.BillingCostSnapshot{CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 100_000}, CostBillingMode: "fixed_request", CostQuantity: 1}
	if !smartRouteCostWithinCap(snapshot, "image", 2, 200_000, tokenBillingEstimate{}) {
		t.Fatal("two exact-cost attempts should fit the budget")
	}
	if smartRouteCostWithinCap(snapshot, "image", 3, 200_000, tokenBillingEstimate{}) {
		t.Fatal("three attempts exceeded the budget")
	}
	if smartRouteCostWithinCap(model.BillingCostSnapshot{}, "image", 2, 200_000, tokenBillingEstimate{}) {
		t.Fatal("unknown supplier cost must fail closed")
	}
	text := model.BillingCostSnapshot{CostPricing: model.CreditCostPricing{Configured: true, InputTokenPriceMicrocredits: 1_550_000, OutputTokenPriceMicrocredits: 5_800_000}, CostBillingMode: "token"}
	envelope := tokenBillingEstimate{InputTokens: 2_500, OutputTokens: 16_384}
	if !smartRouteCostWithinCap(text, "text", 2, 250_000, envelope) {
		t.Fatal("bounded text token cost should fit the route budget before usage exists")
	}
	if smartRouteCostWithinCap(text, "text", 2, 190_000, envelope) {
		t.Fatal("text token cost above the total attempt budget must fail closed")
	}
	if smartRouteCostWithinCap(text, "text", 2, 250_000, tokenBillingEstimate{}) {
		t.Fatal("text cost without an output envelope must fail closed")
	}
}

func TestSmartRouteAcceptedAsyncPollRemainsPending(t *testing.T) {
	svc, _, _, _ := creationTestService(t)
	attempt := &model.RouteAttempt{ID: "video-attempt", TaskID: "video-task", RouteRun: 1, AttemptNumber: 1, Status: "dispatching", DispatchState: "submission_unknown", StartedAt: time.Now()}
	if err := svc.repo.CreateRouteAttempt(attempt); err != nil {
		t.Fatal(err)
	}
	task := &model.Task{ID: "video-task", ProviderRequestID: "upstream-video-1"}
	svc.finishTaskRouteAttempt(attempt, task, providerStatePendingError{TaskID: "upstream-video-1"})
	stored, err := svc.repo.RouteAttempts(task.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || stored[0].Status != "accepted" || stored[0].DispatchState != "accepted" || stored[0].CompletedAt != nil || stored[0].AcceptedAt == nil {
		t.Fatalf("accepted asynchronous task counted as terminal: %+v", stored)
	}
}

func TestSmartRouteReferenceCapabilityBlocksFallback(t *testing.T) {
	svc := &Service{routeHealthBlocked: map[string]time.Time{}}
	routes := []cachedLogicalRoute{{
		Route:          model.LogicalModelRoute{ID: "backup", Enabled: true, Priority: 100, Weight: 1},
		ChannelModel:   model.ChannelModel{ID: "backup-model", ModelKey: "gpt-image-2", Capability: "image"},
		CapabilitySpec: CapabilitySpec{Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 0, Max: 0}}},
	}}
	intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}}
	if selected := svc.preferredFallbackRoutes("gpt-image-2", routes, intent, nil, false); len(selected) != 0 {
		t.Fatalf("reference image was sent to a route without image input support: %+v", selected)
	}
}

func TestSmartRouteOnlyRetriesConfirmedNoJobFailures(t *testing.T) {
	if !safeRouteRejection(providerHTTPError{StatusCode: 429}) {
		t.Fatal("rate limit should permit fallback")
	}
	if !safeRouteRejection(&net.OpError{Op: "dial", Err: errors.New("connection refused")}) {
		t.Fatal("dial failure happened before request submission")
	}
	if safeRouteRejection(providerHTTPError{StatusCode: 502}) {
		t.Fatal("unqualified gateway failure may hide an accepted task")
	}
	if safeRouteRejection(providerHTTPError{StatusCode: 403, Body: `{"error":{"code":"content_policy_violation"}}`}) {
		t.Fatal("content safety refusal must not be bypassed")
	}
}

func TestSmartRouteAdminSavedPriorityControlsWorkerDispatch(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	primaryCalls, backupCalls := 0, 0
	response := []byte(`{"id":"reply","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { primaryCalls++; _, _ = w.Write(response) }))
	defer primary.Close()
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { backupCalls++; _, _ = w.Write(response) }))
	defer backup.Close()

	svc, db, _, _ := creationTestService(t)
	svc = New(svc.repo, svc.dataDir)
	t.Cleanup(func() { _ = svc.Close() })
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test"))
	for _, item := range []any{
		&model.ModelChannel{ID: "sort-backup-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "排序备用", APIFormat: "openai", BaseURL: backup.URL, APIKey: "test-only"},
		&model.ChannelModel{ID: "sort-backup-model", ChannelID: "sort-backup-channel", ModelKey: "text-test", ProviderModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "sort-backup-tier", ChannelModelID: "sort-backup-model", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 100}, PriceConfigured: true, Enabled: true},
		&model.SystemSetting{Key: smartRouterGlobalSettingKey, ValueJSON: `{"enabled":true,"allowUserIds":["user"]}`},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": primary.URL, "api_key": "test-only", "api_format": "openai"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Updates(map[string]any{"model_key": "text-test", "provider_model_key": "text-test", "capability": "text", "protocol": model.ChannelInterfaceChatCompletion, "capability_config_json": profile}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("channel_model_id = ?", "cm").Updates(map[string]any{"cost_configured": true, "cost_unit_price_microcredits": 100}).Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test"), "text")
	if err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	published := "all"
	request := LogicalModelRequest{Code: "sort-test", Name: "排序测试", Capability: "text", Enabled: true, PublicationScope: &published, PricePolicy: "channel", BillingMode: "fixed_request", CapabilitySpec: spec, DefaultOptions: map[string]any{}, Routes: []LogicalRouteRequest{{ChannelModelID: "cm", Enabled: true, Priority: 200, Weight: 1}, {ChannelModelID: "sort-backup-model", Enabled: true, Priority: 100, Weight: 1}}}
	saved, err := svc.SaveAdminLogicalModel(admin, "", request)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SmartRoutePolicy{LogicalModelID: saved.ID, Enabled: true, Mode: "priority", FailoverEnabled: true, GrayPercent: 100, MaxAttempts: 2, MaxUpstreamCostMicrocredits: 1000, CompatibleChannelModelIDsJSON: "[]"}).Error; err != nil {
		t.Fatal(err)
	}
	if first, err := svc.ResolveLogicalModel(testGroupAccess(svc), saved.ID, ModelRequestIntent{Capability: "text"}); err != nil || first.ChannelModel.ID != "cm" {
		t.Fatalf("initial order: %+v %v", first, err)
	}
	originalRoutes := request.Routes
	request.Routes = originalRoutes[:1]
	if _, err := svc.SaveAdminLogicalModel(admin, saved.ID, request); err == nil {
		t.Fatal("active failover group accepted removal of its only backup")
	}
	request.Routes = originalRoutes
	request.Routes[0].Priority, request.Routes[1].Priority = 100, 200
	if _, err := svc.SaveAdminLogicalModel(admin, saved.ID, request); err != nil {
		t.Fatal(err)
	}
	task, err := svc.CreateTask("user", CreateTaskRequest{Type: "canvas_text", Prompt: "排序测试", LogicalModelID: saved.ID, Input: map[string]any{"mode": "text", "prompt": "排序测试", "config": map[string]any{}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ProcessNextTask(); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if primaryCalls != 0 || backupCalls != 1 || stored.ChannelModelID != "sort-backup-model" || stored.Status != model.TaskStatusSucceeded {
		encoded, _ := json.Marshal(stored)
		t.Fatalf("saved order did not control real dispatch: primary=%d backup=%d task=%s", primaryCalls, backupCalls, encoded)
	}
}
