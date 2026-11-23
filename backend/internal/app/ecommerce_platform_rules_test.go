package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommercePlatformRulesValidateBeforeNewImageTasks(t *testing.T) {
	svc := &Service{}
	page := ecommerceWorkbenchTestPage("image-1", "secondary", "", "", "Soft everyday style")
	page.Platform, page.Language = "shein", "en"
	draft := EcommerceDraft{ImageType: "set", Platform: "shein"}
	plan := model.EcommercePlan{ProductSummary: "真实商品", VisualStrategy: "目录摄影", Images: []model.EcommercePlanTask{page}}
	if err := svc.validateEcommercePlan("user", draft, &plan); err != nil {
		t.Fatal(err)
	}
	plan.Images[0].Copy = "Ｂｅｓｔ　Ｓｅｌｌｅｒ"
	if err := svc.validateEcommercePlan("user", draft, &plan); err == nil || !strings.Contains(err.Error(), "高风险") {
		t.Fatalf("unchecked marketing copy: %v", err)
	}
	plan.Images[0].Copy = "Everyday style"
	plan.Images[0].Platform = "ebay"
	draft.Platform = "ebay"
	if err := svc.validateEcommercePlan("user", draft, &plan); err == nil || !strings.Contains(err.Error(), "无新增文字") {
		t.Fatalf("eBay secondary text accepted: %v", err)
	}
	plan.Images[0].Copy = ""
	if err := svc.validateEcommercePlan("user", draft, &plan); err != nil {
		t.Fatal(err)
	}
}

func TestEcommercePromotionalPurposeReachesImagePrompt(t *testing.T) {
	svc := &Service{}
	page := ecommerceWorkbenchTestPage("image-1", "main", "", "", "Designed for everyday use")
	page.Platform, page.Language = "tiktok", "en"
	plan := model.EcommercePlan{ProductSummary: "A portable product", VisualStrategy: "Blue editorial design", Images: []model.EcommercePlanTask{page}}
	draft := EcommerceDraft{Platform: "tiktok", Language: "en", ImageType: "set"}
	if err := svc.validateEcommercePlan("user", draft, &plan); err == nil {
		t.Fatal("listing copy accepted")
	}
	draft.TypeOptions = map[string]string{"purpose": "宣传图"}
	if err := svc.validateEcommercePlan("user", draft, &plan); err != nil {
		t.Fatal(err)
	}
	prompt := ecommerceExecutionImagePrompt(draft, plan, page)
	if !strings.Contains(prompt, page.Copy) || strings.Contains(prompt, "不添加任何文字") || strings.Contains(prompt, "纯白背景RGB") {
		t.Fatalf("promotional prompt contains listing restrictions or loses copy: %s", prompt)
	}
	draft.ImageType = "white"
	if validateEcommerceImagePurpose(draft) == nil || ecommercePlanImageAllowsText(draft, page.ImageType) {
		t.Fatal("white background type accepted promotional text")
	}
}
