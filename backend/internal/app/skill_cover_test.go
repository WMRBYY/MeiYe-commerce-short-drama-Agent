package app

import (
	"bytes"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestSkillCoverUploadPublishesOnlyCurrentCover(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	skill := model.Skill{ID: "cover-skill", OwnerID: admin.ID, Name: "商品摄影", Description: "摄影指导", Instruction: "original prompt", CurrentVersionID: "version-1", VersionLabel: "1.0", Status: 1, Tag: "ecommerce", DisplayTagline: "原有短文案"}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	png := append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0}, 32)...)
	if _, err := svc.UploadSkillCover(&model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}, skill.ID, multipartFileHeader(t, "cover.png", "image/png", png)); err == nil {
		t.Fatal("non-admin uploaded skill cover")
	}
	if _, err := svc.UploadSkillCover(admin, skill.ID, multipartFileHeader(t, "fake.png", "image/png", []byte("not an image"))); err == nil {
		t.Fatal("non-image bytes accepted")
	}
	first, err := svc.UploadSkillCover(admin, skill.ID, multipartFileHeader(t, "cover.png", "image/png", png))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(first.DisplayCoverURL, skillCoverURLPrefix) || first.DisplayTagline != skill.DisplayTagline || first.DisplayCoverSource == "" {
		t.Fatalf("uploaded visual = %#v", first)
	}
	firstID := strings.TrimPrefix(first.DisplayCoverURL, skillCoverURLPrefix)
	resource, err := svc.repo.Resource(firstID)
	if err != nil || resource.Provider != "local" {
		t.Fatalf("cover resource = %#v, %v", resource, err)
	}
	refs, err := svc.skillCoverResourceReferences([]string{firstID})
	if err != nil || len(refs[firstID]) != 1 {
		t.Fatalf("cover references = %#v, %v", refs, err)
	}
	delivery, err := svc.PrepareSkillCoverDelivery(firstID, ResourceAccessOptions{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Stream != nil {
		delivery.Stream.Body.Close()
	}
	second, err := svc.UploadSkillCover(admin, skill.ID, multipartFileHeader(t, "replacement.png", "image/png", png))
	if err != nil {
		t.Fatal(err)
	}
	if second.DisplayCoverURL == first.DisplayCoverURL {
		t.Fatal("replacement reused old cover")
	}
	if _, err := svc.PrepareSkillCoverDelivery(firstID, ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("replaced cover is still public")
	}
	var after model.Skill
	if err := db.First(&after, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Instruction != skill.Instruction || after.CurrentVersionID != skill.CurrentVersionID {
		t.Fatalf("skill content changed: %#v", after)
	}
}
