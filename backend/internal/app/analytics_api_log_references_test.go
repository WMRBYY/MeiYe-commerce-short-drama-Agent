package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTaskInputReferencesNumberPerKindLikeUpstream(t *testing.T) {
	// 线上商品视频复刻原片编辑任务的输入结构：视频 1 个、图片 2 张。
	raw := `{"mode":"video","referenceImages":[{"kind":"image","resourceId":"img-product","role":"reference"},{"kind":"image","resourceId":"img-model","role":"reference"}],"referenceVideos":[{"kind":"video","resourceId":"vid-clip","role":"reference"}],"workbench":{"references":[{"kind":"video","resourceId":"vid-clip"},{"kind":"image","resourceId":"img-product"},{"kind":"image","resourceId":"img-model"}]}}`
	refs := taskInputReferences(raw)
	if len(refs) != 3 || refs[0].ResourceID != "vid-clip" || refs[1].ResourceID != "img-product" || refs[2].ResourceID != "img-model" {
		t.Fatalf("refs = %+v", refs)
	}
	// 只有 workbench.references 时按类型重排，同类顺序不变。
	raw = `{"workbench":{"references":[{"kind":"image","resourceId":"a"},{"kind":"video","resourceId":"v"},{"kind":"image","resourceId":"b"},{"kind":"audio","resourceId":"s"}]}}`
	refs = taskInputReferences(raw)
	got := ""
	for _, ref := range refs {
		got += ref.Kind[:1] + ref.ResourceID + " "
	}
	if got != "vv ia ib as " {
		t.Fatalf("order = %q", got)
	}
	if refs := taskInputReferences(`{"referenceImages":["https://example.com/a.png","not-a-url"]}`); len(refs) != 1 || refs[0].URL != "https://example.com/a.png" {
		t.Fatalf("url refs = %+v", refs)
	}
}

// 端到端：后台请求明细详情接口要真的返回参考素材（2026-11-09 漏接线，页面上全部显示「未传」）。
func TestAdminAPICallLogReturnsReferenceItems(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.User{}, &model.ModelChannel{}, &model.BillingOrder{}, &model.Task{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	input := `{"mode":"video","referenceImages":[{"kind":"image","resourceId":"img-product","role":"reference"},{"kind":"image","resourceId":"img-model","role":"reference"}],"referenceVideos":[{"kind":"video","resourceId":"vid-clip","role":"reference"}]}`
	if err := db.Create(&model.Task{ID: "task-1", UserID: "user-1", Type: "canvas_video", Status: "succeeded", Prompt: "编辑视频：把 @视频1 中的商品替换成 @图片1 中的商品；人物换成 @图片2", InputJSON: input}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{ID: "log-1", UserID: "user-1", TaskID: "task-1", Capability: "video"}).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	admin := &model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	detail, err := svc.AdminAPICallLog(admin, "log-1")
	if err != nil {
		t.Fatal(err)
	}
	labels := []string{}
	for _, item := range detail.ReferenceItems {
		labels = append(labels, item.Label+"="+item.Kind)
	}
	if got := strings.Join(labels, ","); got != "视频1=video,图片1=image,图片2=image" {
		t.Fatalf("reference items = %q", got)
	}
	if detail.ReferenceItems[0].URL != "/api/admin/api-logs/log-1/media?ref=0" {
		t.Fatalf("reference url = %q", detail.ReferenceItems[0].URL)
	}
}
