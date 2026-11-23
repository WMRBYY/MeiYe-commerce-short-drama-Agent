package app

import (
	"bytes"
	"context"
	"image"
	"image/color"

	"image/png"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestOwnProfileUploadAndPersistence(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "profile.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	owner := &model.User{ID: "owner", Username: "owner", DisplayName: "原昵称", AvatarMode: "default", AvatarPreset: "cat", Role: model.UserRoleUser, Status: model.UserStatusActive}
	other := &model.User{ID: "other", Username: "other", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(other).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	img := image.NewRGBA(image.Rect(0, 0, 128, 128))
	for y := 0; y < 128; y++ {
		for x := 0; x < 128; x++ {
			img.Set(x, y, color.RGBA{R: 220, G: 85, B: 65, A: 255})
		}
	}
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, img); err != nil {
		t.Fatal(err)
	}
	name := "新的昵称"
	updated, err := svc.UpdateOwnProfile(owner, &name, multipartFileHeader(t, "avatar.png", "image/png", pngData.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayName != name || updated.AvatarMode != "" || !strings.HasPrefix(updated.AvatarURL, "/api/profile/avatars/owner/") {
		t.Fatalf("profile not updated: %+v", updated)
	}
	token := filepath.Base(updated.AvatarURL)
	avatar, err := svc.AvatarForUser(owner.ID, token)
	if err != nil || len(avatar) == 0 {
		t.Fatalf("saved avatar unavailable: %v", err)
	}
	if _, err := svc.AvatarForUser(other.ID, token); err == nil {
		t.Fatal("other account accessed owner avatar by changing user ID")
	}
	if _, err := svc.UpdateOwnProfile(owner, &name, multipartFileHeader(t, "fake.png", "image/png", []byte("malicious"))); err == nil {
		t.Fatal("fake image accepted")
	}
	after, err := svc.repo.User(owner.ID)
	if err != nil || after.AvatarURL != updated.AvatarURL || after.DisplayName != name {
		t.Fatal("failed upload changed saved profile")
	}
	if _, err := svc.StoreWeChatAvatar(context.Background(), owner.ID, "http://127.0.0.1/latest"); err == nil {
		t.Fatal("private avatar URL accepted")
	}
}
