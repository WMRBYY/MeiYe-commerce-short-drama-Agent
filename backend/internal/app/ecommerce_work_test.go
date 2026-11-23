package app

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestEcommerceWorkPublishingAndResourceScope(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.Resource{}, &model.CanvasTemplate{}, &model.CanvasTemplateResource{}, &model.CanvasTemplateLike{}, &model.CanvasTemplateReport{}, &model.UserFollow{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "work-owner", Username: "work-owner", DisplayName: "创作者"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	for _, r := range []model.Resource{{ID: "work-video", UserID: user.ID, Kind: "video", Status: model.ResourceStatusReady}, {ID: "work-cover", UserID: user.ID, Kind: "image", Status: model.ResourceStatusReady}, {ID: "work-ref", UserID: user.ID, Kind: "image", Status: model.ResourceStatusReady}, {ID: "private-ref", UserID: "other", Kind: "image", Status: model.ResourceStatusReady}} {
		if err := db.Create(&r).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := CanvasTemplateSubmitRequest{Title: "商品视频", Category: "ecommerce", VideoResourceID: "work-video", CoverResourceID: "work-cover", Ecommerce: &EcommerceWorkMetadata{Prompt: "商品环绕镜头", Model: "Seedance 2.5", ReferenceResourceIDs: []string{"private-ref"}}}
	if _, err := svc.SubmitCanvasTemplate(&user, req); err == nil {
		t.Fatal("accepted another user's reference")
	}
	if _, err := svc.SubmitCanvasTemplate(nil, req); err == nil {
		t.Fatal("accepted guest publication")
	}
	req.Ecommerce.ReferenceResourceIDs = []string{"work-ref"}
	card, err := svc.SubmitCanvasTemplate(&user, req)
	if err != nil {
		t.Fatal(err)
	}
	if card.Status != "pending" || card.PublishedAt != nil {
		t.Fatalf("submission bypassed review: %#v", card)
	}
	list, err := svc.PublicCanvasTemplates(nil, CanvasTemplateQuery{Category: "ecommerce"})
	if err != nil || len(list.Items) != 0 {
		t.Fatalf("pending work exposed: %#v %v", list, err)
	}
	if _, err := svc.PublicCanvasTemplate(nil, card.ID); err == nil {
		t.Fatal("pending work detail exposed")
	}
	if _, err := svc.PreparePublicCanvasTemplateResourceDelivery(card.ID, "work-video", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("pending media exposed")
	}
	if _, err := svc.RemixEcommerceWork(&user, card.ID); err == nil {
		t.Fatal("pending remix accepted")
	}
	if _, err := svc.ReviewCanvasTemplate(&user, card.ID, CanvasTemplateReviewRequest{Action: "approve"}); err == nil {
		t.Fatal("author approved own work without admin")
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	detail, err := svc.AdminCanvasTemplate(admin, card.ID)
	if err != nil || detail.Template.Ecommerce == nil || !strings.HasPrefix(detail.Template.VideoURL, "/api/admin/canvas-templates/") {
		t.Fatalf("admin preview missing: %#v %v", detail, err)
	}
	card, err = svc.ReviewCanvasTemplate(admin, card.ID, CanvasTemplateReviewRequest{Action: "approve"})
	if err != nil || card.Status != "approved" || card.PublishedAt == nil || card.ReviewedAt == nil {
		t.Fatalf("approval: %#v %v", card, err)
	}
	list, err = svc.PublicCanvasTemplates(nil, CanvasTemplateQuery{Category: "ecommerce"})
	if err != nil || len(list.Items) != 1 {
		t.Fatalf("public list: %#v %v", list, err)
	}
	meta := list.Items[0].Ecommerce
	if meta == nil || meta.Model != "Seedance 2.5" || meta.Prompt != "商品环绕镜头" || len(meta.ReferenceResourceIDs) != 1 || !strings.HasPrefix(meta.ReferenceResourceIDs[0], "/api/public/canvas-templates/") {
		t.Fatalf("metadata: %#v", meta)
	}
	var refs []model.CanvasTemplateResource
	if err := db.Where("template_id = ?", card.ID).Find(&refs).Error; err != nil {
		t.Fatal(err)
	}
	if len(refs) != 3 {
		t.Fatalf("public resource count=%d", len(refs))
	}
	for _, ref := range refs {
		if ref.ResourceID == "private-ref" {
			t.Fatal("private resource leaked")
		}
	}
	req.Ecommerce.ReferenceResourceIDs = []string{"work-ref", "work-ref"}
	if _, err := svc.SubmitCanvasTemplate(&user, req); err == nil {
		t.Fatal("duplicate references accepted")
	}
	req.Ecommerce.ReferenceResourceIDs = []string{"work-ref"}
	rejected, err := svc.SubmitCanvasTemplate(&user, req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReviewCanvasTemplate(admin, rejected.ID, CanvasTemplateReviewRequest{Action: "reject", Note: "需要调整素材"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PublicCanvasTemplate(nil, rejected.ID); err == nil {
		t.Fatal("rejected work exposed")
	}
}

func TestEcommerceWorkRemixCopiesPublishedMaterialsAndAvatar(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}, &model.UserDailyUploadUsage{}, &model.Resource{}, &model.ResourceOffloadJob{}, &model.UploadReservation{}, &model.UserStorageGrant{}, &model.UserStorageState{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	if err := db.AutoMigrate(&model.User{}, &model.UserAvatar{}, &model.CanvasTemplate{}, &model.CanvasTemplateResource{}, &model.CanvasTemplateLike{}, &model.UserFollow{}); err != nil {
		t.Fatal(err)
	}
	owner := model.User{ID: "owner", Username: "owner", DisplayName: "作者", Status: model.UserStatusActive, AvatarMode: "custom", AvatarVersion: "version"}
	viewer := model.User{ID: "viewer", Username: "viewer", Status: model.UserStatusActive}
	if err := db.Create(&[]model.User{owner, viewer}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserAvatar{UserID: owner.ID, Data: []byte("avatar")}).Error; err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0700)
	for _, id := range []string{"result", "original", "image", "cover"} {
		kind, mime := "image", "image/png"
		if id == "result" || id == "original" {
			kind = "video"
			mime = "video/mp4"
		}
		r := model.Resource{ID: id, UserID: owner.ID, Provider: "local", Kind: kind, MimeType: mime, ObjectKey: id, Size: 4, Status: model.ResourceStatusReady}
		if err := db.Create(&r).Error; err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", id), []byte("data"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	work, err := svc.SubmitCanvasTemplate(&owner, CanvasTemplateSubmitRequest{Title: "同款", Category: "ecommerce", VideoResourceID: "result", CoverResourceID: "cover", Ecommerce: &EcommerceWorkMetadata{Prompt: "完整提示词", Model: "Seedance", ReferenceVideoResourceID: "original", ReferenceResourceIDs: []string{"image"}, ReferenceCategories: []string{"product_image"}, ReplaceMode: "product"}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(work.Author.AvatarURL, "/api/public/canvas-authors/owner/avatar") {
		t.Fatal(work.Author)
	}
	if _, err := svc.PublicCanvasAuthorAvatar(owner.ID); err == nil {
		t.Fatal("pending author avatar exposed")
	}
	work, err = svc.ReviewCanvasTemplate(&model.User{ID: "admin", Role: model.UserRoleAdmin}, work.ID, CanvasTemplateReviewRequest{Action: "approve"})
	if err != nil {
		t.Fatal(err)
	}
	avatar, err := svc.PublicCanvasAuthorAvatar(owner.ID)
	if err != nil || string(avatar) != "avatar" {
		t.Fatalf("avatar %q %v", avatar, err)
	}
	if _, err := svc.RemixEcommerceWork(nil, work.ID); err == nil {
		t.Fatal("guest remix accepted")
	}
	result, err := svc.RemixEcommerceWork(&viewer, work.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Materials) != 2 || result.Materials[0].Category != "reference_video" || result.Materials[0].ResourceID == "original" {
		t.Fatalf("materials %#v", result)
	}
	for _, item := range result.Materials {
		if _, err := svc.repo.ResourceForUser(viewer.ID, item.ResourceID); err != nil {
			t.Fatal(err)
		}
	}
	again, err := svc.RemixEcommerceWork(&viewer, work.ID)
	if err != nil || again.Materials[0].ResourceID != result.Materials[0].ResourceID {
		t.Fatalf("idempotency %#v %v", again, err)
	}
	if err := db.Model(&model.CanvasTemplate{}).Where("id = ?", work.ID).Update("status", model.CanvasTemplateStatusOffline).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RemixEcommerceWork(&viewer, work.ID); err == nil {
		t.Fatal("offline remix accepted")
	}
	if _, err := svc.PublicCanvasAuthorAvatar(owner.ID); err == nil {
		t.Fatal("unpublished avatar exposed")
	}
}
