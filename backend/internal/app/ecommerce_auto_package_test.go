package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func saveEcommercePackageFixtureImage(t *testing.T, svc *Service, db *gorm.DB, id, owner string) {
	t.Helper()
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewNRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(svc.dataDir, "resources")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	objectKey := id + ".png"
	if err := os.WriteFile(filepath.Join(dir, objectKey), data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: id, UserID: owner, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: objectKey, MimeType: "image/png", Size: int64(data.Len())}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestEcommercePackageRecognitionChargesOnceAndUsesLabeledAssets(t *testing.T) {
	svc, db, request := executionFixture(t)
	text := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	text.Text.References.MaxImages = 2
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, text)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", CreditScale).Error; err != nil {
		t.Fatal(err)
	}
	saveEcommercePackageFixtureImage(t, svc, db, "package-product", "user")
	saveEcommercePackageFixtureImage(t, svc, db, "package-layout", "user")
	draft := request.Draft
	draft.ProductName, draft.Instruction, draft.StylePrompt, draft.Language = "", "参考 @参考图1", "米白底简洁排版", "vi"
	draft.References = []EcommerceReference{{ResourceID: "package-product", Role: "primary"}}
	draft.LayoutReferences = []EcommerceReference{{ResourceID: "package-layout", Role: "style"}}
	draft.AutoPackage = &EcommerceAutoPackage{Slots: []ecommercePackageSlot{{Kind: "main", Ratio: "1:1"}, {Kind: "detail", Ratio: "3:4"}}}

	req := creationTextRequest()
	req.ClientSubmissionID = "package-recognition-001"
	req.Input["metadata"] = map[string]any{"source": "ecommerce-agent", "stage": ecommercePackageRecognitionStage, "ecommerceDraft": draft, "ecommerceRecognitionPricingVersion": 1}
	task, err := svc.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.TaskForUser("user", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != 2 || input.ReferenceImages[0].ID != "package-product" || input.ReferenceImages[1].ID != "package-layout" {
		t.Fatalf("expected both reference groups in stable order: %+v", input.ReferenceImages)
	}
	for _, want := range []string{"@商品图1", "@参考图1", "3:4", "Vietnamese", "米白底简洁排版"} {
		if !strings.Contains(input.Prompt, want) {
			t.Fatalf("prompt omitted %q", want)
		}
	}
	if again, err := svc.CreateTask("user", req); err != nil || again.ID != task.ID {
		t.Fatalf("recognition replay = %+v, %v", again, err)
	}
	if err := os.Remove(filepath.Join(svc.dataDir, "resources", "package-layout.png")); err != nil {
		t.Fatal(err)
	}
	req.ClientSubmissionID = "package-recognition-002"
	if _, err := svc.CreateTask("user", req); err == nil || !strings.Contains(err.Error(), "无法读取") {
		t.Fatalf("a missing reference was accepted: %v", err)
	}
	var orders int64
	if err := db.Model(&model.BillingOrder{}).Where("user_id = ?", "user").Count(&orders).Error; err != nil || orders != 1 {
		t.Fatalf("recognition attempts reserved %d orders, error %v", orders, err)
	}
	order, err := svc.repo.BillingOrder(stored.BillingOrderID)
	if err != nil {
		t.Fatal(err)
	}
	if order.BillingMode != "fixed_request" || order.AmountMicrocredits != 300_000 || order.ReservedAmountMicrocredits != 300_000 {
		t.Fatalf("unexpected recognition charge: %+v", order)
	}
	if err := svc.repo.SettleBillingOrder(order.ID, "fixture"); err != nil {
		t.Fatal(err)
	}
	settled, err := svc.repo.BillingOrder(order.ID)
	if err != nil || settled.ActualAmountMicrocredits != 300_000 {
		t.Fatalf("unexpected recognition settlement: %+v, %v", settled, err)
	}

	result := map[string]any{"text": `{"product":{"productName":"便携风扇"},"outline":[{"title":"首图","description":"展示便携风扇"}]}`}
	if err := svc.validateEcommerceWorkbenchResult("user", input, result); err == nil {
		t.Fatal("accepted a response missing one page")
	}
	result["text"] = `{"product":{"productName":"便携风扇"},"outline":[{"title":"首图","description":"展示便携风扇"},{"title":"细节","description":"说明网罩结构"}]}`
	if err := svc.validateEcommerceWorkbenchResult("user", input, result); err != nil || !strings.Contains(stringValue(result["text"]), `"brand":""`) {
		t.Fatalf("valid recognition was not normalized: %+v, %v", result, err)
	}
}

func TestEcommercePackagePlanningLocksRolesAndEachRatio(t *testing.T) {
	svc := &Service{}
	draft := EcommerceDraft{ImageType: "set", Count: 3, Resolution: "2K", Platform: "amazon", Language: "en", ImageModel: "image-model", Ratio: "1:1"}
	draft.AutoPackage = &EcommerceAutoPackage{Slots: []ecommercePackageSlot{
		{Kind: "main", Ratio: "1:1"},
		{Kind: "main", Ratio: "3:4"},
		{Kind: "detail", Ratio: "2:3", Title: "日常清洁", Description: "拍摄拆装过程"},
	}}
	page := func(id, copy string) model.EcommercePlanTask {
		return ecommerceWorkbenchTestPage(id, "main", "", "", copy)
	}
	got, err := validateEcommerceWorkbenchTestPlan(t, svc, draft, page("a", "Listing copy"), page("b", "Product details"), page("c", "Easy to clean"))
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{"main", "secondary", "detail"} {
		image := got.Images[i]
		if image.ImageType != want || image.Ratio != draft.AutoPackage.Slots[i].Ratio || image.Resolution != "2K" {
			t.Fatalf("unexpected slot %d: %+v", i+1, image)
		}
	}
	if got.Images[0].Copy != "" || got.Images[1].Copy == "" || !strings.Contains(ecommercePackageImagePrompt(draft, 2), "拍摄拆装过程") {
		t.Fatal("listing rules or user-edited outline were lost")
	}
}

func TestEcommercePackageDetailCountIndependentOfLayoutReferences(t *testing.T) {
	svc, db, req := executionFixture(t)
	var imageModel model.ChannelModel
	if err := db.First(&imageModel, "id = ?", "execution-image").Error; err != nil {
		t.Fatal(err)
	}
	var capability ModelCapabilityConfig
	if err := json.Unmarshal([]byte(imageModel.CapabilityConfigJSON), &capability); err != nil {
		t.Fatal(err)
	}
	capability.Image.MaxOutputs = 1
	capability.Image.Size.AllowCustom = false
	if err := db.Model(&imageModel).Update("capability_config_json", mustEncodeModelCapabilityConfig(t, &capability)).Error; err != nil {
		t.Fatal(err)
	}
	wantReferences := []string{"detail-product", "detail-layout-a", "detail-layout-b"}
	for _, id := range wantReferences {
		saveEcommercePackageFixtureImage(t, svc, db, id, "user")
	}
	req.Draft.ImageType, req.Draft.ReferenceMode, req.Draft.Count = "detail", "style", 3
	req.Draft.References = []EcommerceReference{{ResourceID: wantReferences[0], Role: "primary"}}
	req.Draft.LayoutReferences = []EcommerceReference{{ResourceID: wantReferences[1], Role: "style"}, {ResourceID: wantReferences[2], Role: "style"}}
	slots := []ecommercePackageSlot{{Kind: "detail", Ratio: "1:1"}, {Kind: "detail", Ratio: "1:1"}, {Kind: "detail", Ratio: "1024x1024"}}
	req.Draft.AutoPackage = &EcommerceAutoPackage{Slots: slots}
	withoutLayout := req
	withoutLayout.Draft.LayoutReferences = nil
	if _, err := svc.StartEcommerceExecution("user", withoutLayout); err == nil {
		t.Fatal("detail generation accepted no layout reference")
	}
	empty := req
	empty.Draft.Count = 0
	empty.Draft.AutoPackage = &EcommerceAutoPackage{}
	if _, err := svc.StartEcommerceExecution("user", empty); err == nil {
		t.Fatal("detail generation accepted no output slots")
	}
	invalidSize := req
	invalidSize.Draft.AutoPackage = &EcommerceAutoPackage{Slots: slices.Clone(slots)}
	invalidSize.Draft.AutoPackage.Slots[2].Ratio = "137:723"
	if _, err := svc.StartEcommerceExecution("user", invalidSize); err == nil {
		t.Fatal("detail generation accepted an unsupported individual size")
	}
	project, err := svc.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	draft := executionDraft(t, project)
	var planningRefs []string
	for _, ref := range draft.Execution.ReferenceImages {
		planningRefs = append(planningRefs, ref.ID)
	}
	if draft.Count != 3 || !slices.Equal(planningRefs, wantReferences) {
		t.Fatalf("unexpected persisted output count or source order: %d, %v", draft.Count, planningRefs)
	}
	outline := strings.Split(strings.TrimSpace(ecommercePackageOutlinePrompt(draft)), "\n")
	for index, want := range []string{"@参考图1", "@参考图2", "@参考图1"} {
		if !strings.Contains(outline[index], want) {
			t.Fatalf("outline %d did not choose %s: %s", index, want, outline[index])
		}
	}
	plan := model.EcommercePlan{Images: make([]model.EcommercePlanTask, len(slots))}
	for index := range slots {
		page := &plan.Images[index]
		page.Prompt = "按参考图展示真实商品"
		applyEcommercePackageSlot(draft, page, index)
	}
	project, err = svc.submitEcommerceExecutionImage(project, draft, &plan, 2)
	if err != nil {
		t.Fatal(err)
	}
	task, err := svc.repo.TaskForUser("user", plan.Images[2].TaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	var generationRefs []string
	for _, ref := range input.ReferenceImages {
		generationRefs = append(generationRefs, ref.ID)
	}
	if !slices.Equal(generationRefs, wantReferences) || input.Config.Size != "1024x1024" || input.Config.Count != "1" || !strings.Contains(input.Prompt, "本张主要借鉴 @参考图1") {
		t.Fatalf("third output did not keep all references, size and one-output billing: %+v", input)
	}
}
