package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestPersonalChannelTasksRequireAdmin(t *testing.T) {
	svc, db := newMediaRecoveryTestService(t)
	for _, user := range []model.User{
		{ID: "regular", Username: "regular", Email: "regular@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "admin", Username: "admin", Email: "admin@example.invalid", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	personal := map[string]any{"config": map[string]any{"baseUrl": "https://example.com/v1", "apiKey": "private-key"}}
	system := map[string]any{"config": map[string]any{"channelId": "system-1", "baseUrl": "/api/ai/system/system-1"}}
	if err := svc.requireAdminForCustomTask("regular", personal); err == nil {
		t.Fatal("regular user could use a personal channel")
	}
	if err := svc.requireAdminForCustomTask("admin", personal); err != nil {
		t.Fatalf("admin personal channel: %v", err)
	}
	if err := svc.requireAdminForCustomTask("regular", system); err != nil {
		t.Fatalf("regular user system channel: %v", err)
	}
}
