package app

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestLogicalModelPublicationIsIndependentOfFailoverAdmission(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:publication-scope?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.LogicalModel{}, &model.SmartRoutePolicy{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	item := model.LogicalModel{ID: "published-model", Code: "published-model", Name: "Published", Capability: "text", Enabled: true, PublicationScope: "all"}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	if visible, err := svc.publicationVisibleForUser("ordinary-user", item); err != nil || !visible {
		t.Fatalf("all-user publication with router off = %v, %v", visible, err)
	}
	item.PublicationScope = "gray"
	item.PublicationAllowUserIDsJSON = `["gray-user"]`
	if visible, err := svc.publicationVisibleForUser("ordinary-user", item); err != nil || visible {
		t.Fatalf("ordinary user gray visibility = %v, %v", visible, err)
	}
	if visible, err := svc.publicationVisibleForUser("gray-user", item); err != nil || !visible {
		t.Fatalf("gray user visibility = %v, %v", visible, err)
	}
	item.PublicationScope = "off"
	if visible, err := svc.publicationVisibleForUser("gray-user", item); err != nil || visible {
		t.Fatalf("disabled publication = %v, %v", visible, err)
	}
	item.PublicationScope = "all"
	now := time.Now()
	if err := db.Create(&model.SmartRoutePolicy{LogicalModelID: item.ID, Mode: "priority", MaxAttempts: 1, ArchivedAt: &now}).Error; err != nil {
		t.Fatal(err)
	}
	if visible, err := svc.publicationVisibleForUser("ordinary-user", item); err != nil || visible {
		t.Fatalf("archived route group visibility = %v, %v", visible, err)
	}
}
