package app

import (
	"bytes"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestAdminAPICallLogUserAvatar(t *testing.T) {
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: "file:" + newID() + "?mode=memory&cache=shared"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserAvatar{}, &model.ModelChannel{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}

	user := model.User{ID: "creator", Username: "creator", DisplayName: "创作者", Role: model.UserRoleUser, AvatarMode: "custom", AvatarVersion: "test-version"}
	payload := []byte("avatar fixture")
	for _, record := range []any{
		&user,
		&model.UserAvatar{UserID: user.ID, Data: payload},
		&model.ApiCallLog{ID: "request-1", UserID: user.ID, RequestKind: "create", Capability: "text"},
		&model.ApiCallLog{ID: "request-2", UserID: "missing", RequestKind: "create", Capability: "text"},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}

	svc := &Service{repo: repository.New(db)}
	admin := &model.User{Role: model.UserRoleAdmin}
	page, err := svc.AdminAPICallLogs(admin, APICallLogQuery{})
	if err != nil || len(page.Logs) != 2 {
		t.Fatalf("list = %+v, err = %v", page, err)
	}
	checkCreator := func(log model.ApiCallLog) {
		t.Helper()
		if log.UserDisplayName != user.DisplayName || log.UserAvatarMode != "custom" || log.UserAvatarURL != "/api/admin/api-log-users/creator/avatar?v=test-version" {
			t.Fatalf("creator metadata = %+v", log)
		}
	}
	for _, log := range page.Logs {
		if log.UserID == user.ID {
			checkCreator(log)
		} else if log.UserDisplayName != "" || log.UserAvatarURL != "" {
			t.Fatalf("missing user should have no metadata, got %+v", log)
		}
	}
	detail, err := svc.AdminAPICallLog(admin, "request-1")
	if err != nil {
		t.Fatal(err)
	}
	checkCreator(*detail)

	got, err := svc.AdminAPICallLogUserAvatar(admin, user.ID)
	if err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("avatar = %q, err = %v", got, err)
	}
	if _, err := svc.AdminAPICallLogUserAvatar(&user, user.ID); err == nil {
		t.Fatal("ordinary user could access the admin avatar endpoint")
	}
	if _, err := svc.AdminAPICallLogUserAvatar(admin, "missing"); err == nil {
		t.Fatal("missing avatar should return an error")
	}
}
