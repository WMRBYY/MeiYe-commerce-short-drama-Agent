package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestSkillVisualUpdatePreservesSkillAndUserState(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	skill := model.Skill{ID: "visual-skill", OwnerID: "owner", Name: "导演分镜", Description: "生成分镜", Instruction: "original prompt", CurrentVersionID: "version-1", VersionLabel: "1.0", Status: 1, Tag: "drama", ShowcaseMediaJSON: "[]"}
	state := model.UserSkillState{ID: "visual-state", UserID: "user", SkillID: skill.ID, InstalledVersionID: "version-1", Added: true, Liked: true}
	if err := db.Create(&skill).Error; err != nil { t.Fatal(err) }
	if err := db.Create(&state).Error; err != nil { t.Fatal(err) }
	update := SkillVisualUpdate{CoverURL: "https://example.com/original.webp", Tagline: "一页剧本变分镜", CoverSource: "原创授权案例"}
	if _, err := s.UpdateSkillVisual(&model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}, skill.ID, update); err == nil {
		t.Fatal("non-admin changed visual metadata")
	}
	item, err := s.UpdateSkillVisual(&model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}, skill.ID, update)
	if err != nil { t.Fatal(err) }
	if item.DisplayCoverURL != update.CoverURL || item.DisplayTagline != update.Tagline { t.Fatalf("display metadata missing: %+v", item) }
	var after model.Skill
	if err := db.First(&after, "id = ?", skill.ID).Error; err != nil { t.Fatal(err) }
	if after.ID != skill.ID || after.Instruction != skill.Instruction || after.CurrentVersionID != skill.CurrentVersionID || after.Name != skill.Name || after.ShowcaseMediaJSON != skill.ShowcaseMediaJSON {
		t.Fatalf("skill content changed: %+v", after)
	}
	var userState model.UserSkillState
	if err := db.First(&userState, "id = ?", state.ID).Error; err != nil { t.Fatal(err) }
	if !userState.Added || !userState.Liked || userState.InstalledVersionID != state.InstalledVersionID { t.Fatalf("installation state changed: %+v", userState) }
}
