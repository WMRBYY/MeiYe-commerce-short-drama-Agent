package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

// This test drives the normal task admission and worker, with real HTTP
// responses from two channels and an isolated database.
func TestSmartRouteWorkerFailsOver429WithoutDoubleBilling(t *testing.T) {
	runSmartRouteWorkerFaultCase(t, http.StatusTooManyRequests, 1, model.TaskStatusSucceeded)
}

func TestSmartRouteImageWorkerFailsOver429AndPersistsResult(t *testing.T) {
	runSmartRouteImageWorkerCase(t, 100, 1000, false, true)
}

func TestSmartRouteImageWorkerRejectsOverBudgetBackup(t *testing.T) {
	runSmartRouteImageWorkerCase(t, 150, 200, false, false)
}

func TestSmartRouteImageWorkerRejectsBackupWithoutReferenceSupport(t *testing.T) {
	runSmartRouteImageWorkerCase(t, 100, 1000, true, false)
}

func runSmartRouteImageWorkerCase(t *testing.T, backupCost, maxCost int64, referenceIncompatible, expectSuccess bool) {
	t.Helper()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	primaryCalls, backupCalls := 0, 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		primaryCalls++
		expectedPath := "/images/generations"
		if referenceIncompatible {
			expectedPath = "/images/edits"
		}
		if !strings.HasSuffix(r.URL.Path, expectedPath) {
			t.Errorf("primary path = %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"rate limit"}}`))
	}))
	defer primary.Close()
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backupCalls++
		if !strings.HasSuffix(r.URL.Path, "/images/generations") {
			t.Errorf("backup path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII="}]}`))
	}))
	defer backup.Close()

	svc, db, _, _ := creationTestService(t)
	svc = New(svc.repo, svc.dataDir)
	t.Cleanup(func() { _ = svc.Close() })
	if referenceIncompatible {
		imageBytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII=")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", "smart-reference.png"), imageBytes, 0600); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.Resource{ID: "smart-reference", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Provider: "local", ObjectKey: "smart-reference.png", Width: 1, Height: 1, Size: int64(len(imageBytes))}).Error; err != nil {
			t.Fatal(err)
		}
	}
	primaryCapability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	backupCapability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	if referenceIncompatible {
		backupCapability.Image.References.MaxImages = 0
	}
	profile := mustEncodeModelCapabilityConfig(t, primaryCapability)
	backupProfile := mustEncodeModelCapabilityConfig(t, backupCapability)
	for _, item := range []any{
		&model.ModelChannel{ID: "image-backup-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "图片备用", APIFormat: "openai", BaseURL: backup.URL, APIKey: "test-only"},
		&model.ChannelModel{ID: "image-backup-model", ChannelID: "image-backup-channel", ModelKey: "gpt-image-2", ProviderModelKey: "gpt-image-2", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: backupProfile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-backup-tier", ChannelModelID: "image-backup-model", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: backupCost}, PriceConfigured: true, Enabled: true},
		&model.SystemSetting{Key: smartRouterGlobalSettingKey, ValueJSON: `{"enabled":true}`},
		&model.SmartRoutePolicy{LogicalModelID: "smart-image", Enabled: true, Mode: "priority", FailoverEnabled: true, GrayPercent: 100, MaxAttempts: 2, MaxUpstreamCostMicrocredits: maxCost, CompatibleChannelModelIDsJSON: "[]"},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": primary.URL, "api_key": "test-only", "api_format": "openai"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Updates(map[string]any{"provider_model_key": "gpt-image-2", "model_key": "gpt-image-2", "capability": "image", "protocol": model.ChannelInterfaceOpenAIImage, "capability_config_json": profile}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier").Updates(map[string]any{"cost_configured": true, "cost_unit_price_microcredits": 100}).Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2"), "image")
	if err != nil {
		t.Fatal(err)
	}
	specJSON, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []any{
		&model.LogicalModel{ID: "smart-image", Code: "smart-image", Name: "图片智能路由", Capability: "image", Enabled: true, ActiveRevisionID: "smart-image-v1", PricePolicy: "channel", BillingMode: "fixed_request"},
		&model.LogicalModelRevision{ID: "smart-image-v1", LogicalModelID: "smart-image", Version: 1, CapabilitySpecJSON: string(specJSON), DefaultOptionsJSON: "{}"},
		&model.LogicalModelRoute{ID: "image-primary-route", LogicalModelRevisionID: "smart-image-v1", ChannelModelID: "cm", Priority: 200, Weight: 1, Enabled: true},
		&model.LogicalModelRoute{ID: "image-backup-route", LogicalModelRevisionID: "smart-image-v1", ChannelModelID: "image-backup-model", Priority: 100, Weight: 1, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	input := map[string]any{"mode": "image", "prompt": "一张图片", "config": map[string]any{"size": "1024x1024"}}
	if referenceIncompatible {
		input["referenceImages"] = []any{map[string]any{"type": "image", "storageKey": "resource:smart-reference"}}
	}
	task, err := svc.CreateTask("user", CreateTaskRequest{Type: "canvas_image", Prompt: "一张图片", LogicalModelID: "smart-image", Input: input})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ProcessNextTask(); (err == nil) != expectSuccess {
		stored, _ := svc.repo.Task(task.ID)
		attempts, _ := svc.repo.RouteAttempts(task.ID, 1)
		t.Fatalf("unexpected worker result: %v primary=%d backup=%d task=%+v attempts=%+v", err, primaryCalls, backupCalls, stored, attempts)
	}
	stored, err := svc.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	attempts, err := svc.repo.RouteAttempts(task.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	expectedBackupCalls, expectedAttempts, expectedStatus, expectedRoute := 1, 2, model.TaskStatusSucceeded, "image-backup-route"
	if !expectSuccess {
		expectedBackupCalls, expectedAttempts, expectedStatus, expectedRoute = 0, 1, model.TaskStatusFailed, "image-primary-route"
	}
	if primaryCalls != 1 || backupCalls != expectedBackupCalls || len(attempts) != expectedAttempts || stored.Status != expectedStatus || stored.RouteID != expectedRoute {
		t.Fatalf("image route primary=%d backup=%d attempts=%+v task=%+v", primaryCalls, backupCalls, attempts, stored)
	}
	var consume []model.CreditLedgerEntry
	if err := db.Where("billing_order_id = ? AND type = ?", stored.BillingOrderID, model.CreditLedgerConsume).Find(&consume).Error; err != nil {
		t.Fatal(err)
	}
	if expectSuccess && (len(consume) != 1 || stored.ResultJSON == "") {
		t.Fatalf("image result or settlement missing: consume=%+v result=%q", consume, stored.ResultJSON)
	}
	if expectSuccess {
		public, err := svc.Task("user", task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if public.RouteAttemptCount != 2 || public.AutoSwitchCount != 1 || len(public.RouteAttempts) != 2 || public.RouteAttempts[0].Status != "failed" || public.RouteAttempts[1].Status != "succeeded" || public.RouteAttempts[1].SwitchReason != "upstream_429" || public.Billing == nil || public.Billing.Status != model.BillingStatusSettled {
			t.Fatalf("task detail lost route or billing evidence: %+v", public)
		}
	}
	if !expectSuccess && (len(consume) != 0 || stored.ResultJSON != "") {
		t.Fatalf("over-budget fallback generated or charged: consume=%+v result=%q", consume, stored.ResultJSON)
	}
}

func TestSmartRouteWorkerKeepsPrimaryOnSuccess(t *testing.T) {
	runSmartRouteWorkerFaultCase(t, http.StatusOK, 0, model.TaskStatusSucceeded)
}

func TestSmartRouteWorkerDoesNotResubmitUnknown502(t *testing.T) {
	runSmartRouteWorkerFaultCase(t, http.StatusBadGateway, 0, model.TaskStatusReconciling)
}

func TestSmartRouteWorkerDoesNotResubmitUnknown504(t *testing.T) {
	runSmartRouteWorkerFaultCase(t, http.StatusGatewayTimeout, 0, model.TaskStatusReconciling)
}

func TestSmartRouteWorkerDoesNotResubmitAfterAcceptedConnectionBreak(t *testing.T) {
	runSmartRouteWorkerFaultCase(t, -1, 0, model.TaskStatusReconciling)
}

func TestSmartRoutePreOutboundValidationReleasesCredits(t *testing.T) {
	runSmartRouteWorkerFaultCase(t, -2, 0, model.TaskStatusFailed)
}

func TestSmartRouteUnknownSubmissionAndRefundPostgres(t *testing.T) {
	if os.Getenv("CANVAS_TEST_POSTGRES_DSN") == "" {
		t.Skip("isolated PostgreSQL DSN is required")
	}
	runSmartRouteWorkerFaultCaseOnDatabase(t, http.StatusBadGateway, 0, model.TaskStatusReconciling, true)
}

func TestSmartRoutePreOutboundRefundPostgres(t *testing.T) {
	if os.Getenv("CANVAS_TEST_POSTGRES_DSN") == "" {
		t.Skip("isolated PostgreSQL DSN is required")
	}
	runSmartRouteWorkerFaultCaseOnDatabase(t, -2, 0, model.TaskStatusFailed, true)
}

func TestSmartRouteWorkerFailsOverConfirmedDialFailure(t *testing.T) {
	runSmartRouteWorkerFaultCase(t, 0, 1, model.TaskStatusSucceeded)
}

func runSmartRouteWorkerFaultCase(t *testing.T, primaryStatus int, expectedBackupCalls int, expectedStatus model.TaskStatus) {
	runSmartRouteWorkerFaultCaseOnDatabase(t, primaryStatus, expectedBackupCalls, expectedStatus, false)
}

func runSmartRouteWorkerFaultCaseOnDatabase(t *testing.T, primaryStatus int, expectedBackupCalls int, expectedStatus model.TaskStatus, usePostgres bool) {
	t.Helper()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	primaryCalls, backupCalls := 0, 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		primaryCalls++
		if primaryStatus == -1 {
			_, _ = io.Copy(io.Discard, r.Body)
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Errorf("hijack accepted connection: %v", err)
				return
			}
			_ = connection.Close()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(primaryStatus)
		if primaryStatus == http.StatusOK {
			_, _ = w.Write([]byte(`{"id":"reply","choices":[{"message":{"role":"assistant","content":"主线成功"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
		} else {
			_, _ = w.Write([]byte(`{"error":{"message":"temporary upstream failure"}}`))
		}
	}))
	defer primary.Close()
	if primaryStatus == 0 {
		primary.Close()
	}
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		backupCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"reply","choices":[{"message":{"role":"assistant","content":"备线成功"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer backup.Close()

	var svc *Service
	var db *gorm.DB
	if usePostgres {
		svc, db = creationPostgresSmartRouteTestService(t)
	} else {
		svc, db, _, _ = creationTestService(t)
	}
	svc = New(svc.repo, svc.dataDir)
	t.Cleanup(func() { _ = svc.Close() })
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test"))
	for _, item := range []any{
		&model.ModelChannel{ID: "backup-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "备用测试", APIFormat: "openai", BaseURL: backup.URL, APIKey: "test-only"},
		&model.ChannelModel{ID: "backup-model", ChannelID: "backup-channel", ModelKey: "text-test", ProviderModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "backup-tier", ChannelModelID: "backup-model", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.SystemSetting{Key: smartRouterGlobalSettingKey, ValueJSON: `{"enabled":true}`},
		&model.SmartRoutePolicy{LogicalModelID: "smart-text", Enabled: true, Mode: "priority", FailoverEnabled: true, GrayPercent: 100, MaxAttempts: 2, CompatibleChannelModelIDsJSON: "[]"},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": primary.URL, "api_key": "test-only", "api_format": "openai"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("provider_model_key", "text-test").Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test"), "text")
	if err != nil {
		t.Fatal(err)
	}
	specJSON, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []any{
		&model.LogicalModel{ID: "smart-text", Code: "smart-text", Name: "文本智能路由", Capability: "text", Enabled: true, ActiveRevisionID: "smart-text-v1", PricePolicy: "channel", BillingMode: "fixed_request"},
		&model.LogicalModelRevision{ID: "smart-text-v1", LogicalModelID: "smart-text", Version: 1, CapabilitySpecJSON: string(specJSON), DefaultOptionsJSON: "{}"},
		&model.LogicalModelRoute{ID: "primary-route", LogicalModelRevisionID: "smart-text-v1", ChannelModelID: "cm", Priority: 200, Weight: 1, Enabled: true},
		&model.LogicalModelRoute{ID: "backup-route", LogicalModelRevisionID: "smart-text-v1", ChannelModelID: "backup-model", Priority: 100, Weight: 1, Enabled: true},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	task, err := svc.CreateTask("user", CreateTaskRequest{Type: "canvas_text", Prompt: "只输出测试", LogicalModelID: "smart-text", Input: map[string]any{"mode": "text", "prompt": "只输出测试", "config": map[string]any{}}})
	if err != nil {
		t.Fatal(err)
	}
	if primaryStatus == -2 {
		if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Update("base_url", "http://[invalid").Error; err != nil {
			t.Fatal(err)
		}
	}
	admitted, err := svc.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !admitted.SmartRouteActive || admitted.RouteID != "primary-route" {
		t.Fatalf("wrong initial route: %+v", admitted)
	}
	if err := svc.ProcessNextTask(); (err != nil) != (expectedStatus == model.TaskStatusFailed) {
		t.Fatalf("worker result for status %d: %v", primaryStatus, err)
	}
	stored, err := svc.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	attempts, err := svc.repo.RouteAttempts(task.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	expectedPrimaryCalls := 1
	if primaryStatus == 0 || primaryStatus == -2 {
		expectedPrimaryCalls = 0
	}
	if primaryCalls != expectedPrimaryCalls || backupCalls != expectedBackupCalls || len(attempts) != 1+expectedBackupCalls || stored.Status != expectedStatus {
		t.Fatalf("unexpected dispatch primary=%d backup=%d attempts=%+v task=%+v", primaryCalls, backupCalls, attempts, stored)
	}
	var entries []model.CreditLedgerEntry
	if err := db.Where("billing_order_id = ? AND type IN ?", stored.BillingOrderID,
		[]model.CreditLedgerType{model.CreditLedgerConsume, model.CreditLedgerRefund}).Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	var consumed, refunded int
	for _, entry := range entries {
		switch entry.Type {
		case model.CreditLedgerConsume:
			consumed++
		case model.CreditLedgerRefund:
			refunded++
		}
	}
	wantRefunds := 0
	if expectedStatus != model.TaskStatusSucceeded {
		wantRefunds = 1
	}
	if consumed != 1 || refunded != wantRefunds {
		t.Fatalf("personal direct debit: consume=%d refund=%d, want 1/%d; entries=%+v", consumed, refunded, wantRefunds, entries)
	}
	if primaryStatus == -2 {
		order, err := svc.repo.BillingOrder(stored.BillingOrderID)
		if err != nil || order.Status != model.BillingStatusRefunded || attempts[0].OutboundStartedAt != nil || attempts[0].DispatchState != "rejected_no_job" {
			t.Fatalf("pre-outbound failure did not refund safely: order=%+v attempt=%+v err=%v", order, attempts[0], err)
		}
	}
	if expectedStatus == model.TaskStatusReconciling {
		order, err := svc.repo.BillingOrder(stored.BillingOrderID)
		if err != nil {
			t.Fatal(err)
		}
		if order.Status != model.BillingStatusRefunded {
			t.Fatalf("personal direct debit was not refunded while submission is reconciled: %+v", order)
		}
		if attempts[0].SubmissionKey == "" || attempts[0].OutboundStartedAt == nil || attempts[0].ReconciliationState != "pending" || attempts[0].CompletedAt != nil {
			t.Fatalf("unknown attempt lost durable reconciliation evidence: %+v", attempts[0])
		}
		// A new process can claim the durable reconciliation row. Synchronous
		// vendors without a query API move to manual review, never a new create.
		restarted := New(svc.repo, svc.dataDir)
		defer restarted.Close()
		claimed, err := restarted.repo.ClaimNextSmartRouteReconciliation("restart-reconciler", 45*time.Second)
		if err != nil || claimed == nil {
			t.Fatalf("restart claim: task=%+v err=%v", claimed, err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("lease_expires_at", time.Now().Add(-time.Second)).Error; err != nil {
			t.Fatal(err)
		}
		reclaimed, err := restarted.repo.ClaimNextSmartRouteReconciliation("second-process", 45*time.Second)
		if err != nil || reclaimed == nil || reclaimed.ID != claimed.ID || reclaimed.LeaseOwner == claimed.LeaseOwner {
			t.Fatalf("expired lease was not recoverable: old=%+v new=%+v err=%v", claimed, reclaimed, err)
		}
		if err := restarted.reconcileSmartRouteTask(context.Background(), reclaimed); err != nil {
			t.Fatal(err)
		}
		after, err := restarted.repo.Task(task.ID)
		if err != nil || after.Status != model.TaskStatusReconciling || after.Stage != "等待人工核查上游状态" || backupCalls != 0 {
			t.Fatalf("unsafe unknown retry: %+v err=%v backup=%d", after, err, backupCalls)
		}
		if usePostgres {
			if err := restarted.repo.ResolveSmartRouteReconciliationRefund(task.ID, attempts[0].ID, "reviewer", "查阅渠道账单后确认未生成任务"); err != nil {
				t.Fatal(err)
			}
			if err := restarted.repo.ResolveSmartRouteReconciliationRefund(task.ID, attempts[0].ID, "reviewer", "重复回调不得再次入账"); err != nil {
				t.Fatal(err)
			}
			var refunds int64
			if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", stored.BillingOrderID, model.CreditLedgerRefund).Count(&refunds).Error; err != nil || refunds != 1 {
				t.Fatalf("refund rows=%d err=%v", refunds, err)
			}
		}
	}
}

func creationPostgresSmartRouteTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), options)
	if err != nil {
		t.Fatal(err)
	}
	adminSQL, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = adminSQL.Close() })
	schema := fmt.Sprintf("smart_route_fault_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error })
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), options)
	if err != nil {
		t.Fatal(err)
	}
	svc, db, _, _ := creationTestServiceOnDatabase(t, db)
	return svc, db
}
