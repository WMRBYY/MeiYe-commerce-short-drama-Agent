package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

func TestEcommercePackageLongDetailCropsAndJoinsDetectedScreens(t *testing.T) {
	svc, db, req := executionFixture(t)
	text := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	text.Text.References.MaxImages = 3
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, text)).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"screen-product", "screen-reference", "screen-reading-window"} {
		saveEcommercePackageFixtureImage(t, svc, db, id, "user")
		req.ReferenceImages = append(req.ReferenceImages, model.EcommerceExecutionReference{ID: id})
	}
	auto := 0
	req.Progressive = true
	req.Draft.ImageType, req.Draft.ReferenceMode, req.Draft.Count = "detail", "detail", 1
	req.Draft.DetailScreenCount = &auto
	req.Draft.References = []EcommerceReference{{ResourceID: "screen-product", Role: "primary"}}
	req.Draft.LayoutReferences = []EcommerceReference{{ResourceID: "screen-reference", Role: "style"}}
	req.Draft.AutoPackage = &EcommerceAutoPackage{Slots: []ecommercePackageSlot{{Kind: "detail", Ratio: req.Draft.Ratio}}}
	project, err := svc.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, svc, project.ID)
	planner, err := svc.repo.TaskForUser("user", executionDraft(t, project).PlanningTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(planner.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != 3 || input.ReferenceImages[2].ID != "screen-reading-window" || !strings.Contains(planner.Prompt, "bottomJoin") {
		t.Fatalf("planner did not receive the reading windows and long-image contract: %+v", input.ReferenceImages)
	}
	if !strings.Contains(planner.Prompt, ecommerceagent.ReferencePlanningMethod) {
		t.Fatal("reference planning did not receive its own visual contract")
	}
	for _, forbidden := range []string{ecommerceagent.PremiumPlanningOverride, ecommerceagent.ProductStateRule, ecommerceagent.WorkbenchShotMethod, ecommerceagent.PremiumDetailLayoutKnowledge, "【可选的差异化美术家族"} {
		if strings.Contains(planner.Prompt, forbidden) {
			t.Fatalf("reference planning included original-design override: %.100s", forbidden)
		}
	}
	const seam = "右侧浅米色背景延续至下一屏，同一版心和图标尺度"
	plan := model.EcommercePlan{
		ProductSummary: "便携风扇", VisualStrategy: "沿用原图分区", ConfirmedFacts: []string{},
		UncertainFacts: []string{}, QualityChecks: []string{}, ReferenceSummary: "原图为介绍与操作两个内容屏",
	}
	for index, title := range []string{"认识便携风扇", "使用方式"} {
		page := ecommerceWorkbenchTestPage("image-"+[]string{"1", "2"}[index], "detail", "", "", title)
		page.PerformanceAngle = "可见设计｜以实际外观说明产品结构"
		page.InformationComponent = "标题导语｜左上留白放标题并保留可清楚阅读的文字层级"
		page.ReferenceScreen = &model.EcommerceReferenceScreen{SourceResourceID: "screen-reference", ScreenIndex: index + 1, Top: float64(index) * .505, Bottom: float64(index+1) / 2, Content: title, Layout: "标题左上", Visual: "米色背景"}
		page.ReferenceScreen.ProductView = []string{"detail", "none"}[index]
		plan.Images = append(plan.Images, page)
	}
	raw, _ := json.Marshal(plan)
	result := map[string]any{"text": string(raw)}
	if err := svc.validateEcommerceWorkbenchResult("user", input, result); err == nil || !strings.Contains(err.Error(), "下边缘衔接") {
		t.Fatalf("missing visual continuity was accepted: %v", err)
	}
	plan.Images[0].ReferenceScreen.BottomJoin = seam
	plan.Images[1].ReferenceScreen.ProductView = ""
	raw, _ = json.Marshal(plan)
	result["text"] = string(raw)
	if err := svc.validateEcommerceWorkbenchResult("user", input, result); err == nil || !strings.Contains(err.Error(), "出镜方式") {
		t.Fatalf("new planner accepted a missing subject decision: %v", err)
	}
	plan.Images[1].ReferenceScreen.ProductView = "none"
	manual := 3
	manualDraft := req.Draft
	manualDraft.DetailScreenCount = &manual
	if err := svc.validateEcommerceReferencePlan("user", manualDraft, &plan); err == nil || !strings.Contains(err.Error(), "出图张数") {
		t.Fatalf("wrong manual output count was accepted: %v", err)
	}
	raw, _ = json.Marshal(plan)
	result["text"] = string(raw)
	if err := svc.validateEcommerceWorkbenchResult("user", input, result); err != nil {
		t.Fatal(err)
	}
	resultJSON, _ := json.Marshal(result)
	if err := db.Model(&model.Task{}).Where("id = ?", planner.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(resultJSON)}).Error; err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, svc, project.ID)
	draft := executionDraft(t, project)
	if draft.Count != 2 || len(draft.AutoPackage.Slots) != 2 {
		t.Fatalf("detected count did not replace the placeholder: %+v", draft.AutoPackage)
	}
	for range draft.Count {
		project = executionAdvance(t, svc, project.ID)
		if state := executionDraft(t, project).Execution; state.Error != "" {
			t.Fatalf("screen submission %s: %s", state.Stage, state.Error)
		}
	}
	if err := json.Unmarshal([]byte(project.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Images[0].ReferenceScreen.Bottom != plan.Images[1].ReferenceScreen.Top {
		t.Fatal("adjacent slices do not share the same original boundary")
	}
	for index, page := range plan.Images {
		task, err := svc.repo.TaskForUser("user", page.TaskID)
		if err != nil {
			t.Fatal(err)
		}
		var request canvasGenerationInput
		if err := json.Unmarshal([]byte(task.InputJSON), &request); err != nil {
			t.Fatal(err)
		}
		crop := page.ReferenceScreen.ResourceID
		if len(request.ReferenceImages) != 2-index || request.ReferenceImages[len(request.ReferenceImages)-1].ID != crop || crop == "screen-reference" {
			t.Fatalf("image %d has incorrect per-section inputs: %+v", index+1, request.ReferenceImages)
		}
		if (index == 0 && (request.ReferenceImages[0].ID != "screen-product" || !strings.Contains(task.Prompt, "只取本屏指定局部"))) ||
			(index == 1 && (!strings.Contains(task.Prompt, "本屏商品不出镜") || strings.Contains(task.Prompt, ecommerceProductAnchor))) {
			t.Fatalf("image %d lost its planned subject", index+1)
		}
		edge := []string{"下边缘衔接", "上边缘衔接"}[index]
		if !strings.Contains(task.Prompt, "【"+edge+"】"+seam) {
			t.Fatalf("image %d did not carry the shared boundary", index+1)
		}
		if at := strings.Index(task.Prompt, "【本屏参考·视觉执行】"); at < 0 || at > strings.Index(task.Prompt, "【避免】") || !strings.Contains(task.Prompt, "最后一张附图是当前屏的真实参考裁片") {
			t.Fatalf("image %d placed visual reference in negative guidance or omitted crop identity", index+1)
		}
	}
}

func TestEcommerceReferencePromptAlsoGuidesLegacyScreenMode(t *testing.T) {
	draft := EcommerceDraft{ImageType: "detail", ReferenceMode: "detail"}
	page := model.EcommercePlanTask{ImageType: "detail", Prompt: "blue cleanser", ReferenceScreen: &model.EcommerceReferenceScreen{ScreenIndex: 1, Content: "自然洗护", Layout: "人物近景，左侧标题", Visual: "绿色苔藓与自然日光", BottomJoin: "浅绿背景延续"}}
	prompt := ecommerceExecutionImagePrompt(draft, model.EcommercePlan{Images: []model.EcommercePlanTask{page}}, page)
	for _, required := range []string{"最后一张附图是当前屏的真实参考裁片", "绿色苔藓与自然日光", "人物近景，左侧标题", "不能据此把整套背景改成商品颜色", "【下边缘衔接】浅绿背景延续"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("legacy reference task lost %q", required)
		}
	}
	if !strings.HasPrefix(prompt, "【本屏参考·视觉执行】") {
		t.Fatal("reference image guidance is not a positive opening instruction")
	}
}

func TestEcommerceDetailMissingScreenStopsBeforeBilling(t *testing.T) {
	svc, db, req := executionFixture(t)
	req.Draft.ReferenceMode = "detail"
	req.Draft.Execution = &model.EcommerceExecution{ID: "missing-reference-run"}
	plan := &model.EcommercePlan{Images: []model.EcommercePlanTask{{ID: "image-1", Prompt: "must not submit without crop"}}}
	var before, after int64
	db.Model(&model.Task{}).Count(&before)
	_, err := svc.submitEcommerceExecutionImage(&model.EcommerceProject{ID: "missing-reference-project", UserID: "user"}, req.Draft, plan, 0)
	db.Model(&model.Task{}).Count(&after)
	if err == nil || !strings.Contains(err.Error(), "本屏缺少参考范围") || before != after || plan.Images[0].TaskID != "" {
		t.Fatalf("missing reference reached generation or billing: before=%d after=%d task=%q err=%v", before, after, plan.Images[0].TaskID, err)
	}
}
