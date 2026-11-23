package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentOmniQuoteRespectsExcludedMedia(t *testing.T) {
	kind, _, images, videos, _, audio := omniEstimateWork("制作1张插画海报，不要生成视频或音频")
	if kind != "图片与海报" || images != 1 || videos != 0 || audio != 0 {
		t.Fatalf("excluded media added to quote: %s images=%d videos=%d audio=%d", kind, images, videos, audio)
	}
}

func TestCloudAgentOmniRunReportsExhaustedBudgetAndResume(t *testing.T) {
	encoded, err := json.Marshal(CloudAgentRun{PermissionMode: cloudAgentOmniMode, BudgetMaxCredits: 0.2, BudgetRemainingCredits: 0, OmniPaused: false})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"budgetRemainingCredits":0`) || !strings.Contains(string(encoded), `"omniPaused":false`) {
		t.Fatalf("zero budget or resumed state omitted: %s", encoded)
	}
}

func TestCloudAgentOmniSkillsMatchReadAndIsolation(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("role", model.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	ids := make(map[string]string)
	for _, spec := range []struct{ name, description string }{{"动画分镜", "动画短片剧本角色镜头"}, {"商品详情页", "商品图片电商详情页海报视觉"}, {"豆包音频提示词", "为当前画布音频生成编写台词与声音提示词"}} {
		created, err := s.CreateSkill("user", SkillMutationRequest{SkillName: spec.name, Description: spec.description, Instruction: "# " + spec.name + "\n必须遵守专属制作规则", Tag: "others", IsPrivate: true})
		if err != nil {
			t.Fatal(err)
		}
		ids[spec.name] = created.SkillID
	}
	if none, err := s.cloudAgentOmniSkillIDs("user", "动画分镜", nil); err != nil || len(none) != 0 {
		t.Fatalf("unselected library skills must not be loaded: %v %v", none, err)
	}
	selected := []string{ids["动画分镜"], ids["商品详情页"], ids["豆包音频提示词"]}
	one, err := s.cloudAgentOmniSkillIDs("user", "动画分镜", []string{ids["动画分镜"]})
	if err != nil || len(one) != 1 || one[0] != ids["动画分镜"] {
		t.Fatalf("one enabled skill expanded from user's library: %v %v", one, err)
	}
	animation, err := s.cloudAgentOmniSkillIDs("user", "动画分镜", selected)
	if err != nil || len(animation) != 1 {
		t.Fatalf("animation matching: %v %v", animation, err)
	}
	commerce, err := s.cloudAgentOmniSkillIDs("user", "商品详情页", selected)
	if err != nil || len(commerce) != 1 || commerce[0] == animation[0] {
		t.Fatalf("commerce matching: %v %v", commerce, err)
	}
	poster, err := s.cloudAgentOmniSkillIDs("user", "请在当前自由画布制作原创治愈系插画海报", selected)
	if err != nil || len(poster) != 0 {
		t.Fatalf("unrelated category skills selected for poster: %v %v", poster, err)
	}
	if _, err := s.cloudAgentOmniSkillIDs("user", "动画分镜", []string{"not-installed"}); err == nil {
		t.Fatal("uninstalled skill accepted")
	}
	if _, err := s.cloudAgentOmniSkillIDs("other", "动画分镜", []string{ids["动画分镜"]}); err == nil {
		t.Fatal("another user's skill accepted")
	}
	pool, err := s.cloudAgentBuildSkillPool("user", "动画分镜", animation)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := s.cloudAgentOmniSkillContext("user", canonicalAgentRequest{}, pool.Pinned)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(canonical.Messages)
	if !strings.Contains(string(data), "必须遵守专属制作规则") {
		t.Fatal("matched skill rules never reached model context")
	}
	if _, err := s.cloudAgentOmniSkillContext("other", canonicalAgentRequest{}, pool.Pinned); err == nil {
		t.Fatal("cross-user skill context leak")
	}
}

func TestCloudAgentOmniBudgetStopsBeforePaidMedia(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, args, "auto")
	state.Request.PermissionMode = cloudAgentOmniMode
	state.Plan = []cloudAgentPlanItem{{ID: "media", Title: "生成参考镜头视频", Status: "doing"}}
	state.Request.Budget.MaxCredits = 0.000001
	state.Request.OmniAuthorization = omniTestGrant(state.Request)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("budget allowed a paid media task")
	}
}

func omniTestGrant(req CloudAgentRequest) *CloudAgentOmniAuthorization {
	return &CloudAgentOmniAuthorization{Version: 1, Confirmed: true, MaxCredits: req.Budget.MaxCredits, Scope: "canvas_creation", MaxGenerationTasks: req.Budget.MaxGenerationTasks, MaxVideoSeconds: req.Budget.MaxVideoSeconds, EstimateHash: "test-checkpoint-estimate"}
}

func TestCloudAgentOmniGrantAndLegacyIsolation(t *testing.T) {
	for _, mode := range []string{"read_only", "request_approval", "auto", cloudAgentOmniMode} {
		req := agentTestRequest()
		req.PermissionMode = mode
		if mode == cloudAgentOmniMode {
			if validateCloudAgentRequest(&req) == nil {
				t.Fatal("missing project grant accepted")
			}
			req.OmniAuthorization = omniTestGrant(req)
		}
		if err := validateCloudAgentRequest(&req); err != nil {
			t.Fatalf("%s: %v", mode, err)
		}
		if mode != cloudAgentOmniMode {
			if cloudAgentOmniMediaAuthorized(&cloudAgentRuntime{Request: req}) {
				t.Fatal("legacy mode gained project media authority")
			}
		} else {
			req.Budget.MaxCredits++
			if validateCloudAgentRequest(&req) == nil {
				t.Fatal("budget escalation accepted")
			}
		}
	}
}

func TestCloudAgentOmniMediaAdmissionRecoveryAndPause(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	// Start through the existing auto fixture, then freeze an independently
	// authorized omni checkpoint without changing any legacy fixture behavior.
	run, state := agentMediaRun(t, s, args, "auto")
	state.Request.PermissionMode = cloudAgentOmniMode
	state.Plan = []cloudAgentPlanItem{{ID: "media", Title: "生成参考镜头视频", Status: "doing"}}
	state.Request.OmniAuthorization = omniTestGrant(state.Request)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetCloudAgentOmniPaused("other", run.ID, true); err == nil {
		t.Fatal("other user paused project")
	}
	if err := s.SetCloudAgentOmniPaused("user", run.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("paused run submitted paid task")
	}
	if err := s.SetCloudAgentOmniPaused("user", run.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if state.Approval != nil || state.AutoPreparedMedia == nil {
		t.Fatalf("project admission did not checkpoint quote: status=%s approval=%v", run.Status, state.Approval)
	}
	// Reloaded checkpoint is the restart boundary before the billed transaction.
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err = cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if state.MediaTaskID == "" || state.AutoPreparedMedia != nil {
		t.Fatalf("authorized media not submitted once: status=%s", run.Status)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("restart duplicated task: %d", count)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err = cloudAgentDecode(run)
	if err != nil || run.Status == "failed" || state.MediaTaskID == "" || state.CallIndex != 0 {
		t.Fatalf("polling re-admitted active media: status=%s err=%v", run.Status, err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes[args.NodeID] == nil || len(creationMaps(doc["connections"])) != 3 {
		t.Fatal("dynamic media node/reference connections missing")
	}
	nodes["shot-1"]["title"] = "用户正在编辑的镜头标题"
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "omni-output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 720, Height: 1280}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", state.MediaTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:omni-output"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, state.Calls[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, state.Calls[0]); err != nil {
		t.Fatal("committed tool replay failed:", err)
	}
	canvas, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ = creationDocument(canvas.PayloadJSON)
	nodes, _ = creationObjects(doc["nodes"])
	meta := nodes[args.NodeID]["metadata"].(map[string]any)
	if meta["status"] != "success" || meta["storageKey"] != "resource:omni-output" || nodes["shot-1"]["title"] != "用户正在编辑的镜头标题" {
		t.Fatal("completion failed or overwrote unrelated user editing")
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err = cloudAgentDecode(run)
	if err != nil || run.Status == "failed" || state.MediaTaskID != "" || state.CallIndex != 1 {
		t.Fatalf("media completion left an invalid run: status=%s err=%v", run.Status, err)
	}
}

func TestCloudAgentOmniRolloutClosedByDefault(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	t.Setenv("CANVAS_OMNI_AUTO_ROLLOUT", "")
	if s.CloudAgentOmniAvailable("user") {
		t.Fatal("omni public rollout enabled by default")
	}
	req := agentTestRequest()
	req.PermissionMode = cloudAgentOmniMode
	req.OmniAuthorization = omniTestGrant(req)
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("closed rollout admitted a run")
	}
}

func TestCloudAgentOmniQuoteDoesNotChargeAndBindsMaterials(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	t.Setenv("CANVAS_OMNI_AUTO_ROLLOUT", "admin")
	if err := db.Model(&model.User{}).Where("id = ?", "user").Updates(map[string]any{"username": "omni-admin", "role": model.UserRoleAdmin}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.PermissionMode = cloudAgentOmniMode
	req.Prompt = "制作30秒动画短片"
	req.Budget.MaxGenerationTasks = 20
	req.Budget.MaxVideoSeconds = 30
	var before int64
	db.Model(&model.BillingOrder{}).Count(&before)
	quote, err := s.CloudAgentOmniQuote("user", req)
	if err != nil {
		t.Fatal(err)
	}
	if quote.Hash == "" || quote.Kind != "剧本与短片" {
		t.Fatalf("bad project quote: %+v", quote)
	}
	var after int64
	db.Model(&model.BillingOrder{}).Count(&after)
	if before != after {
		t.Fatal("preflight created a charge")
	}
	commerce := req
	commerce.Prompt = "根据商品图片制作8张电商详情页"
	other, err := s.CloudAgentOmniQuote("user", commerce)
	if err != nil || quote.Hash == other.Hash || other.Kind == quote.Kind {
		t.Fatalf("quote did not adapt to task: %v", err)
	}
	req.OmniAuthorization = omniTestGrant(req)
	req.OmniAuthorization.EstimateHash = quote.Hash
	if _, err := s.CloudAgentOmniQuote("other", req); err == nil {
		t.Fatal("preflight leaked another user's materials")
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", `{"nodes":[]}`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("stale materials quote admitted a run")
	}
	fresh, err := s.CloudAgentOmniQuote("user", req)
	if err != nil {
		t.Fatal(err)
	}
	req.OmniAuthorization.EstimateHash = fresh.Hash
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatalf("fresh project quote could not start: %v", err)
	}
	duplicate, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil || duplicate.ID != run.ID {
		t.Fatalf("project authorization replay lost idempotency: %v", err)
	}
}

func TestCloudAgentOmniZeroMediaLimitsAreHard(t *testing.T) {
	req := agentTestRequest()
	req.PermissionMode = cloudAgentOmniMode
	req.OmniAuthorization = omniTestGrant(req)
	state := &cloudAgentRuntime{Request: req}
	if validateCloudAgentMediaBudget(cloudAgentMediaArgs{Mode: "image"}, state) == nil {
		t.Fatal("zero media limit treated as unlimited")
	}
	req.Budget.MaxGenerationTasks = 1
	req.OmniAuthorization = omniTestGrant(req)
	state.Request = req
	if validateCloudAgentMediaBudget(cloudAgentMediaArgs{Mode: "video", Duration: 5}, state) == nil {
		t.Fatal("zero video limit treated as unlimited")
	}
	if omniCommittedBudget(model.BillingOrder{Status: model.BillingStatusUncertain, AmountMicrocredits: 100}) != 100 || omniCommittedBudget(model.BillingOrder{Status: model.BillingStatusRefunded, AmountMicrocredits: 100}) != 0 {
		t.Fatal("uncertain/refunded orders have wrong budget occupancy")
	}
}
