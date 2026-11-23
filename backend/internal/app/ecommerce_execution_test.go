package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func executionFixture(t *testing.T) (*Service, *gorm.DB, EcommerceExecutionRequest) {
	t.Helper()
	t.Setenv("AI_MODE", "disabled")
	var s *Service
	var db *gorm.DB
	if dsn := os.Getenv("ECOMMERCE_TEST_POSTGRES_URL"); dsn != "" {
		admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		schema := "execution_" + newID()
		if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`)
			conn, _ := admin.DB()
			_ = conn.Close()
		})
		u, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		q.Set("search_path", schema)
		u.RawQuery = q.Encode()
		db, err = gorm.Open(postgres.Open(u.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		s, db, _, _ = creationTestServiceOnDatabase(t, db)
		features := defaultFeatureAvailability()
		features.EcommerceEnabled, features.EcommerceVideoEnabled = true, true
		features.ImageWorkbenchEnabled, features.VideoWorkbenchEnabled = true, true
		saveAdmissionFeatures(t, s, features)
	} else {
		s, db, _, _ = ecommerceCreationTestService(t)
	}
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-1")
	profile.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k"}, Default: "1k"}
	profile.Image.Size.Presets = []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024}}
	cm := model.ChannelModel{ID: "execution-image", ChannelID: "channel", ModelKey: "gpt-image-1", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}
	if err := db.Create(&cm).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModelPriceTier{ID: "execution-price", ChannelModelID: cm.ID, SelectorJSON: "{}", SelectorKey: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: `{"channelModelId":"cm","channelId":"channel","modelKey":"text-test"}`}); err != nil {
		t.Fatal(err)
	}
	draft := EcommerceDraft{ProductName: "测试商品", Platform: "taobao", Language: "zh-CN", ImageType: "set", Count: 2, Ratio: "1:1", Resolution: "1k", ReferenceMode: "product", AgentModel: "text-test", ImageModel: "gpt-image-1", References: []EcommerceReference{}, LayoutReferences: []EcommerceReference{}, Skus: []EcommerceSku{}}
	request := EcommerceExecutionRequest{ID: "execution-client-123", Draft: draft, Prompt: "请输出两张商品图片方案", InputSignature: "request-signature", Image: WorkbenchTaskInput{Kind: "image", Model: "gpt-image-1", ChannelID: "channel", Parameters: map[string]any{"size": "1:1", "imageResolution": "1k", "count": 1}}}
	return s, db, request
}

func TestEcommerceExecutionConcurrentWorkersChargeOnce(t *testing.T) {
	if os.Getenv("ECOMMERCE_TEST_POSTGRES_URL") == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	s, db, req := executionFixture(t)
	p, err := s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errorsCh := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stale := *p
			err := s.advanceEcommerceExecution(context.Background(), &stale)
			if err != nil && !errors.Is(err, repository.ErrEcommerceRoundConflict) {
				errorsCh <- err
			}
		}()
	}
	wg.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Task{}).Where("project_id = ?", p.ID).Count(&count)
	if count != 1 {
		t.Fatalf("concurrent tasks = %d", count)
	}
	db.Model(&model.BillingOrder{}).Where("user_id = ?", "user").Count(&count)
	if count != 1 {
		t.Fatalf("concurrent charges = %d", count)
	}
}

func executionDraft(t *testing.T, p *model.EcommerceProject) EcommerceDraft {
	t.Helper()
	var draft EcommerceDraft
	if err := json.Unmarshal([]byte(p.DraftJSON), &draft); err != nil {
		t.Fatal(err)
	}
	return draft
}

func executionAdvance(t *testing.T, s *Service, id string) *model.EcommerceProject {
	t.Helper()
	p, err := s.repo.EcommerceProject("user", id)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.advanceEcommerceExecution(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	p, err = s.repo.EcommerceProject("user", id)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func executionPlan(t *testing.T, db *gorm.DB, taskID string) model.EcommercePlan {
	t.Helper()
	plan := model.EcommercePlan{ProductSummary: "测试商品", VisualStrategy: "简洁商品摄影", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{}, Images: []model.EcommercePlanTask{}}
	for _, id := range []string{"screen-a", "screen-b"} {
		plan.Images = append(plan.Images, model.EcommercePlanTask{ID: id, ImageType: "main", Platform: "taobao", Language: "zh-CN", Goal: "展示商品", Theme: id, Composition: "居中", MainVisual: "真实商品", Fidelity: "保真", Prompt: "商品摄影", ImageModel: "gpt-image-1", Ratio: "1:1", Resolution: "1k", Copy: "日常好物"})
	}
	raw, _ := json.Marshal(plan)
	result, _ := json.Marshal(map[string]any{"text": string(raw)})
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)}).Error; err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestEcommerceExecutionResumesWithoutBrowserAndChargesOnce(t *testing.T) {
	s, db, req := executionFixture(t)
	p, err := s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	startedAt := executionDraft(t, p).Execution.StartedAt
	if _, err := time.Parse(time.RFC3339Nano, startedAt); err != nil {
		t.Fatalf("missing durable start time: %q", startedAt)
	}
	duplicate, err := s.StartEcommerceExecution("user", req)
	if err != nil || duplicate.ID != p.ID {
		t.Fatalf("duplicate: %v %+v", err, duplicate)
	}
	if executionDraft(t, duplicate).Execution.StartedAt != startedAt {
		t.Fatal("replaying submission reset the start time")
	}
	changed := req
	changed.Prompt = "changed"
	if _, err = s.StartEcommerceExecution("user", changed); err == nil {
		t.Fatal("idempotency key accepted another intent")
	}
	if _, err = s.EcommerceProject("other", p.ID); err == nil {
		t.Fatal("cross-account project read")
	}
	p = executionAdvance(t, s, p.ID)
	draft := executionDraft(t, p)
	if draft.Execution.Status != "running" || draft.PlanningTaskID == "" {
		t.Fatalf("not queued: %+v", draft.Execution)
	}
	rows, err := s.repo.ActiveEcommerceExecutions("", 100)
	if err != nil || len(rows) != 1 {
		t.Fatalf("planning run was not discoverable: %d %v", len(rows), err)
	}
	if _, err = s.SaveEcommerceProject("user", p.ID, SaveEcommerceProjectRequest{Revision: p.Revision, Draft: req.Draft}); err == nil {
		t.Fatal("browser overwrote worker snapshot")
	}
	// No browser callbacks: only a new service instance, the persisted queue and
	// upstream task completion events advance the entire run.
	executionPlan(t, db, draft.PlanningTaskID)
	restarted := &Service{repo: repository.New(db), dataDir: s.dataDir}
	p = executionAdvance(t, restarted, p.ID)
	for i := 0; i < 3; i++ {
		p = executionAdvance(t, restarted, p.ID)
	}
	var plan model.EcommercePlan
	_ = json.Unmarshal([]byte(p.PlanJSON), &plan)
	if len(plan.Images) != 2 || plan.Images[0].TaskID == "" || plan.Images[1].TaskID == "" {
		t.Fatalf("images not submitted: %+v; %s", plan, p.DraftJSON)
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 3 {
		t.Fatalf("task count=%d", count)
	}
	for i := 0; i < 3; i++ {
		executionAdvance(t, restarted, p.ID)
	}
	db.Model(&model.Task{}).Count(&count)
	if count != 3 {
		t.Fatalf("duplicate charges/tasks: %d", count)
	}
	for _, page := range plan.Images {
		db.Model(&model.Task{}).Where("id = ?", page.TaskID).Update("status", model.TaskStatusSucceeded)
	}
	p = executionAdvance(t, restarted, p.ID)
	if executionDraft(t, p).Execution.Status != "completed" {
		t.Fatalf("not completed: %s", p.DraftJSON)
	}
	if executionDraft(t, p).Execution.StartedAt != startedAt {
		t.Fatal("worker restart reset the start time")
	}
	duplicate, err = s.StartEcommerceExecution("user", req)
	if err != nil || duplicate.ID != p.ID {
		t.Fatalf("replayed response: %v", err)
	}
}

func TestEcommerceExecutionProgressiveOverlapsImagesAndRetries(t *testing.T) {
	s, db, req := executionFixture(t)
	req.Progressive = true
	req.Draft.Count = 9
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	project, err = s.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: req.Draft})
	if err != nil {
		t.Fatal(err)
	}
	req.ProjectID, req.Revision = project.ID, project.Revision
	project, err = s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	plannerID := executionDraft(t, project).PlanningTaskID
	if err := db.Model(&model.Task{}).Where("id = ?", plannerID).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	plan := model.EcommercePlan{ProductSummary: "测试商品", VisualStrategy: "自然摄影", ConfirmedFacts: []string{}, UncertainFacts: []string{"容量未核实"}, QualityChecks: []string{}}
	titles := []string{"日常好物", "细节可见", "随手一放", "自然相伴", "简洁摆放", "轻松收纳", "自在日常", "晨间随行", "静享片刻"}
	for index, title := range titles {
		id := "screen-" + string(rune('a'+index))
		plan.Images = append(plan.Images, model.EcommercePlanTask{ID: id, ImageType: "main", Goal: "展示商品", Theme: id, Composition: "居中", MainVisual: "真实商品", Fidelity: "保真", Prompt: "商品摄影", Copy: title})
	}
	// Explicit order mirrors the planner contract: the header precedes images.
	header, _ := json.Marshal(struct {
		ProductSummary string   `json:"productSummary"`
		VisualStrategy string   `json:"visualStrategy"`
		ConfirmedFacts []string `json:"confirmedFacts"`
		UncertainFacts []string `json:"uncertainFacts"`
		QualityChecks  []string `json:"qualityChecks"`
	}{plan.ProductSummary, plan.VisualStrategy, plan.ConfirmedFacts, plan.UncertainFacts, plan.QualityChecks})
	first, _ := json.Marshal(plan.Images[0])
	second, _ := json.Marshal(plan.Images[1])
	fragment := string(header[:len(header)-1]) + `,"images":[` + string(first) + "," + string(second[:len(second)-1])
	if _, err := s.AppendTaskTextDelta("user", plannerID, fragment); err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	var saved model.EcommercePlan
	_ = json.Unmarshal([]byte(project.PlanJSON), &saved)
	if len(saved.Images) != 1 || saved.Images[0].TaskID == "" || len(saved.UncertainFacts) != 0 {
		t.Fatalf("first image was not admitted while planning: %s", project.PlanJSON)
	}
	firstID := saved.Images[0].TaskID
	if err := db.Model(&model.Task{}).Where("id = ?", firstID).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	_ = json.Unmarshal([]byte(project.PlanJSON), &saved)
	if len(saved.Images) != 1 || saved.Images[0].TaskID != firstID {
		t.Fatalf("incomplete second screen changed the saved plan: %s", project.PlanJSON)
	}
	if _, err := s.AppendTaskTextDelta("user", plannerID, string(second[len(second)-1:])); err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	_ = json.Unmarshal([]byte(project.PlanJSON), &saved)
	if len(saved.Images) != 2 || saved.Images[0].TaskID != firstID || saved.Images[1].TaskID == "" {
		t.Fatalf("second image was not admitted while planning and the first image were running: %s", project.PlanJSON)
	}
	secondID := saved.Images[1].TaskID
	if err := db.Model(&model.Task{}).Where("id = ?", plannerID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "任务执行超时，请稍后重试。"}).Error; err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	if _, err := s.RetryEcommerceExecution("user", project.ID, ""); err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	plannerID = executionDraft(t, project).PlanningTaskID
	planner, err := s.repo.TaskForUser("user", plannerID)
	if err != nil || ecommercePlanningResumeAfter(planner.InputJSON) != 2 || !strings.Contains(planner.Prompt, "只写第 3 至 9 屏") {
		t.Fatalf("expected planning to resume after two submitted screens: %v", err)
	}
	var resumedInput canvasGenerationInput
	if err := json.Unmarshal([]byte(planner.InputJSON), &resumedInput); err != nil {
		t.Fatal(err)
	}
	plan.Images = plan.Images[2:]
	raw, _ := json.Marshal(plan)
	normalized := map[string]any{"text": string(raw)}
	if err := s.validateEcommerceWorkbenchResult("user", resumedInput, normalized); err != nil {
		t.Fatal(err)
	}
	result, _ := json.Marshal(normalized)
	if err := db.Model(&model.Task{}).Where("id = ?", plannerID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)}).Error; err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	project = executionAdvance(t, s, project.ID)
	_ = json.Unmarshal([]byte(project.PlanJSON), &saved)
	if len(saved.Images) != 9 || saved.Images[0].TaskID != firstID || saved.Images[1].TaskID != secondID || saved.Images[2].TaskID == "" || len(saved.UncertainFacts) != 0 {
		t.Fatalf("final plan did not preserve the streamed receipts and admit the third image: %s", project.PlanJSON)
	}
	thirdID := saved.Images[2].TaskID
	if err := db.Model(&model.Task{}).Where("id = ?", firstID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RetryEcommerceExecution("user", project.ID, firstID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RetryEcommerceExecution("user", project.ID, firstID); err == nil {
		t.Fatal("a stale retry created another task")
	}
	project, err = s.repo.EcommerceProject("user", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal([]byte(project.PlanJSON), &saved)
	if saved.Images[0].TaskID == "" || saved.Images[0].TaskID == firstID || saved.Images[1].TaskID != secondID || saved.Images[2].TaskID != thirdID {
		t.Fatalf("retry failed to replace just the failed image: %s", project.PlanJSON)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", saved.Images[0].TaskID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{saved.Images[0].TaskID: true}
	for index := 1; index < 9; index++ {
		id := saved.Images[index].TaskID
		if id == "" || seen[id] {
			t.Fatalf("screen %d has missing or duplicate receipt: %q", index+1, id)
		}
		seen[id] = true
		if err := db.Model(&model.Task{}).Where("id = ?", id).Update("status", model.TaskStatusSucceeded).Error; err != nil {
			t.Fatal(err)
		}
		project = executionAdvance(t, s, project.ID)
		_ = json.Unmarshal([]byte(project.PlanJSON), &saved)
	}
	project = executionAdvance(t, s, project.ID)
	if executionDraft(t, project).Execution.Status != "completed" {
		t.Fatalf("nine-screen execution did not complete: %s", project.DraftJSON)
	}
}

func TestEcommerceExecutionAnalysisFailureCanBeRetried(t *testing.T) {
	s, db, req := executionFixture(t)
	project, err := s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	oldID := executionDraft(t, project).PlanningTaskID
	if err := db.Model(&model.Task{}).Where("id = ?", oldID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "Upstream channel is temporarily unavailable."}).Error; err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	run := executionDraft(t, project).Execution
	if run.Status != "failed" || run.Error != "分析模型暂时无法完成商品分析，请重试。" {
		t.Fatalf("analysis failure was not localized: %+v", run)
	}
	if _, err := s.RetryEcommerceExecution("user", project.ID, ""); err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	if run = executionDraft(t, project).Execution; run.Status != "running" || run.PlanningTaskID == "" || run.PlanningTaskID == oldID {
		t.Fatalf("retry did not start a new analysis: %+v", run)
	}
}

func TestEcommerceExecutionAtomicRollbackKeepsReceiptsAndExistingImages(t *testing.T) {
	s, db, req := executionFixture(t)
	p, err := s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	p = executionAdvance(t, s, p.ID)
	executionPlan(t, db, executionDraft(t, p).PlanningTaskID)
	p = executionAdvance(t, s, p.ID)
	p = executionAdvance(t, s, p.ID)
	var before model.EcommercePlan
	_ = json.Unmarshal([]byte(p.PlanJSON), &before)
	if err := db.Callback().Create().Before("gorm:create").Register("reject_execution_task", func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "Task" {
			tx.AddError(errors.New("模拟任务保存失败"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	p = executionAdvance(t, s, p.ID)
	var after model.EcommercePlan
	_ = json.Unmarshal([]byte(p.PlanJSON), &after)
	if after.Images[0].TaskID != before.Images[0].TaskID || after.Images[1].TaskID != "" {
		t.Fatalf("uncommitted receipt escaped rollback: %+v", after)
	}
	if executionDraft(t, p).Execution.Status != "failed" {
		t.Fatal("failure vanished")
	}
	_ = db.Callback().Create().Remove("reject_execution_task")
	if _, err = s.RetryEcommerceExecution("user", p.ID, ""); err != nil {
		t.Fatal(err)
	}
	p = executionAdvance(t, s, p.ID)
	_ = json.Unmarshal([]byte(p.PlanJSON), &after)
	if after.Images[0].TaskID != before.Images[0].TaskID || after.Images[1].TaskID == "" {
		t.Fatalf("unsafe retry: %+v", after)
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 3 {
		t.Fatalf("expected one analysis and two images, got %d", count)
	}
}

func TestEcommerceExecutionRejectsForeignReferencesAndInvalidDraft(t *testing.T) {
	s, db, req := executionFixture(t)
	db.Create(&model.Resource{ID: "foreign", UserID: "other", Kind: "image", Status: model.ResourceStatusReady})
	req.Draft.References = []EcommerceReference{{ResourceID: "foreign", Role: "primary"}}
	if _, err := s.StartEcommerceExecution("user", req); err == nil {
		t.Fatal("foreign reference admitted")
	}
	req.Draft.References = nil
	req.Draft.Count = 0
	if _, err := s.StartEcommerceExecution("user", req); err == nil {
		t.Fatal("invalid draft admitted")
	}
	var count int64
	db.Model(&model.EcommerceProject{}).Count(&count)
	if count != 0 {
		t.Fatal("rejected request left a project")
	}
}

func TestEcommerceExecutionExistingProjectAndManualConfirmation(t *testing.T) {
	s, db, req := executionFixture(t)
	p, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.SaveEcommerceProject("user", p.ID, SaveEcommerceProjectRequest{Revision: p.Revision, Draft: req.Draft})
	if err != nil {
		t.Fatal(err)
	}
	req.ProjectID, req.Revision, req.AutoGenerate = p.ID, p.Revision, ptr(false)
	p, err = s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := s.StartEcommerceExecution("user", req)
	if err != nil || duplicate.ID != p.ID {
		t.Fatal("existing project replay failed", err)
	}
	p = executionAdvance(t, s, p.ID)
	executionPlan(t, db, executionDraft(t, p).PlanningTaskID)
	p = executionAdvance(t, s, p.ID)
	if executionDraft(t, p).Execution.Status != "awaiting_confirmation" {
		t.Fatalf("manual analysis auto-generated: %s", p.DraftJSON)
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 1 {
		t.Fatal("image charged without confirmation")
	}
	if _, err = s.ConfirmEcommerceExecution("other", p.ID, "approve"); err == nil {
		t.Fatal("cross-user confirmation")
	}
	if _, err = s.ConfirmEcommerceExecution("user", p.ID, "approve"); err != nil {
		t.Fatal(err)
	}
	executionAdvance(t, s, p.ID)
	db.Model(&model.Task{}).Count(&count)
	if count != 2 {
		t.Fatalf("confirmation did not submit: %d", count)
	}
}

func TestEcommerceExecutionStaleWorkerCannotChargeTwice(t *testing.T) {
	s, db, req := executionFixture(t)
	p, err := s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	stale := *p
	if err := s.advanceEcommerceExecution(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	err = s.advanceEcommerceExecution(context.Background(), &stale)
	if !errors.Is(err, repository.ErrEcommerceRoundConflict) {
		t.Fatalf("stale worker: %v", err)
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate task: %d", count)
	}
	db.Model(&model.BillingOrder{}).Count(&count)
	if count > 1 {
		t.Fatalf("duplicate charge: %d", count)
	}
}
