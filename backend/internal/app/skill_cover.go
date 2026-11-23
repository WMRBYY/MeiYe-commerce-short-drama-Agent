package app

import (
	"errors"
	"mime/multipart"
	"strings"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const skillCoverURLPrefix = "/api/public/skills/covers/"

// UploadSkillCover replaces only the selected skill's visual cover. Skill text,
// version and user installation state are left in their existing records.
func (s *Service) UploadSkillCover(actor *model.User, skillID string, header *multipart.FileHeader) (*SkillItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	skill, err := s.repo.Skill(skillID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("技能不存在或已下架")
	}
	if err != nil {
		return nil, err
	}
	if skill.IsPrivate {
		return nil, BadAuthRequest("仅可为公开技能设置展示封面")
	}
	resource, err := s.UploadAppearanceAsset(actor, AppearanceAssetSkillCover, header)
	if err != nil {
		return nil, err
	}
	return s.UpdateSkillVisual(actor, skillID, SkillVisualUpdate{
		CoverURL: skillCoverURLPrefix + resource.ID, Tagline: skill.DisplayTagline, CoverSource: "管理员上传的本地图片",
	})
}

func (s *Service) validateSkillCoverReference(actor *model.User, skillID, coverURL string) error {
	if !strings.HasPrefix(coverURL, skillCoverURLPrefix) {
		return nil
	}
	resourceID := strings.TrimPrefix(coverURL, skillCoverURLPrefix)
	if resourceID == "" || strings.ContainsAny(resourceID, "/?#") || len(resourceID) > 80 {
		return BadAuthRequest("技能封面资源地址无效")
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		return BadAuthRequest("技能封面资源不存在")
	}
	if err := validateAppearanceResourceType(AppearanceAssetSkillCover, resource); err != nil {
		return err
	}
	if resource.UserID != actor.ID {
		skill, err := s.repo.Skill(skillID)
		if err != nil || skill.DisplayCoverURL != coverURL {
			return Forbidden("只能使用当前管理员上传的封面资源")
		}
	}
	return nil
}

func (s *Service) PrepareSkillCoverDelivery(id string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	if id == "" || strings.ContainsAny(id, "/?#") || len(id) > 80 {
		return nil, NotFound("技能封面不存在")
	}
	if _, err := s.repo.PublicSkillByCoverURL(skillCoverURLPrefix + id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("技能封面未发布")
		}
		return nil, err
	}
	resource, err := s.repo.Resource(id)
	if err != nil {
		return nil, NotFound("技能封面资源不存在")
	}
	if err := validateAppearanceResourceType(AppearanceAssetSkillCover, resource); err != nil {
		return nil, err
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}

func (s *Service) skillCoverResourceReferences(resourceIDs []string) (map[string][]AdminResourceReferenceView, error) {
	urls := make([]string, 0, len(resourceIDs))
	for _, id := range resourceIDs {
		urls = append(urls, skillCoverURLPrefix+id)
	}
	skills, err := s.repo.SkillsByCoverURLs(urls)
	if err != nil {
		return nil, err
	}
	result := make(map[string][]AdminResourceReferenceView)
	for _, skill := range skills {
		id := strings.TrimPrefix(skill.DisplayCoverURL, skillCoverURLPrefix)
		result[id] = append(result[id], AdminResourceReferenceView{Kind: "技能封面", ID: skill.ID, Title: skill.Name})
	}
	return result, nil
}
