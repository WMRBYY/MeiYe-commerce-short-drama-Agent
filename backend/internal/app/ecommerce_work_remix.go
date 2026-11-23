package app

import (
	"encoding/json"
	"io"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type EcommerceWorkMaterial struct {
	ResourceID string `json:"resourceId"`
	Category   string `json:"category"`
	Name       string `json:"name"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int64  `json:"durationMs"`
}
type EcommerceWorkRemix struct {
	Prompt      string                  `json:"prompt"`
	ReplaceMode string                  `json:"replaceMode"`
	Materials   []EcommerceWorkMaterial `json:"materials"`
}

func (s *Service) PublicCanvasAuthorAvatar(id string) ([]byte, error) {
	works, _, err := s.repo.QueryCanvasTemplates(repository.CanvasTemplateFilter{UserID: id, Statuses: []model.CanvasTemplateStatus{model.CanvasTemplateStatusApproved}, Limit: 1})
	if err != nil {
		return nil, err
	}
	if len(works) == 0 {
		return nil, NotFound("作者头像不可用")
	}
	users, err := s.repo.UsersByIDs([]string{id})
	if err != nil {
		return nil, err
	}
	if users[id].AvatarMode != "custom" {
		return nil, NotFound("作者未设置自定义头像")
	}
	avatar, err := s.repo.UserAvatar(id)
	if err != nil {
		return nil, NotFound("作者头像不可用")
	}
	return avatar.Data, nil
}
func ecommerceWorkImageCategory(value string) bool {
	switch value {
	case "product_image", "model_image", "apparel_image", "face_image", "background_image", "product_detail_image", "packaging_image":
		return true
	}
	return false
}
func ecommerceWorkReplaceMode(value string) bool {
	switch value {
	case "model", "clothing", "face", "background", "product", "precise-product", "precise-person", "combination":
		return true
	}
	return false
}

// Copies only the explicitly published resources, streaming to the viewer's own
// storage and charging the normal upload quota. Repeated requests reuse uploads.
func (s *Service) RemixEcommerceWork(user *model.User, id string) (EcommerceWorkRemix, error) {
	if user == nil {
		return EcommerceWorkRemix{}, Unauthorized("请先登录")
	}
	template, err := s.approvedCanvasTemplate(id)
	if err != nil {
		return EcommerceWorkRemix{}, err
	}
	var payload struct {
		Ecommerce *EcommerceWorkMetadata `json:"ecommerce"`
	}
	if template.Category != "ecommerce" || json.Unmarshal([]byte(template.PayloadJSON), &payload) != nil || payload.Ecommerce == nil {
		return EcommerceWorkRemix{}, BadAuthRequest("这不是电商视频作品")
	}
	meta := payload.Ecommerce
	mode := meta.ReplaceMode
	if !ecommerceWorkReplaceMode(mode) {
		mode = "product"
	}
	result := EcommerceWorkRemix{Prompt: meta.Prompt, ReplaceMode: mode, Materials: []EcommerceWorkMaterial{}}
	videoID := meta.ReferenceVideoResourceID
	if videoID == "" {
		videoID = template.VideoResourceID
	}
	ids := append([]string{videoID}, meta.ReferenceResourceIDs...)
	for i, resourceID := range ids {
		allowed, err := s.repo.CanvasTemplateHasResource(template.ID, resourceID)
		if err != nil {
			return EcommerceWorkRemix{}, err
		}
		if !allowed {
			return EcommerceWorkRemix{}, NotFound("作品参考素材已不可用")
		}
		resource, err := s.repo.ResourceForUser(template.UserID, resourceID)
		if err != nil {
			return EcommerceWorkRemix{}, NotFound("作品参考素材已被移除")
		}
		category := "reference_video"
		kind := "video"
		if i > 0 {
			kind = "image"
			category = "product_image"
			if i-1 < len(meta.ReferenceCategories) {
				category = meta.ReferenceCategories[i-1]
			}
		}
		if resource.Kind != kind || resource.Status != model.ResourceStatusReady {
			return EcommerceWorkRemix{}, BadAuthRequest("作品参考素材尚不可用")
		}
		copied := resource
		if user.ID != template.UserID {
			key := normalizedResourceUploadKey([]string{"ecommerce-remix:" + user.ID + ":" + template.ID + ":" + resourceID})
			existing, err := s.resourceForUploadKey(user.ID, key)
			if err != nil {
				return EcommerceWorkRemix{}, err
			}
			if existing != nil && existing.Status == model.ResourceStatusReady {
				copied = existing
			} else {
				policy, err := s.RuntimePolicy()
				if err != nil {
					return EcommerceWorkRemix{}, err
				}
				storedLimit, err := s.storedFileLimit(user.ID, policy)
				if err != nil {
					return EcommerceWorkRemix{}, err
				}
				limit := policy.Resource.ResourceUploadMB
				if kind == "video" && limit < TemplateVideoUploadMB {
					limit = TemplateVideoUploadMB
				}
				day, err := s.reserveUserStoredFileQuota(user.ID, resource.Size, megabytes(limit), megabytes(policy.Resource.DailyUploadMB), storedLimit, "参考素材超过上传上限")
				if err != nil {
					return EcommerceWorkRemix{}, err
				}
				stream, err := s.openResourceRange(template.UserID, resource, "")
				if err != nil {
					s.releaseUserUploadQuota(user.ID, day, resource.Size)
					return EcommerceWorkRemix{}, err
				}
				var stored bool
				copied, stored, err = s.storeResource(user.ID, kind, "同款参考"+extensionFromMimeType(resource.MimeType), resource.MimeType, resource.Size, resource.Width, resource.Height, resource.DurationMs, io.LimitReader(stream.Body, resource.Size+1), key, false)
				stream.Body.Close()
				if err != nil || !stored {
					s.releaseUserUploadQuota(user.ID, day, resource.Size)
				} else {
					s.commitUserUploadQuota(user.ID, resource.Size)
				}
				if err != nil {
					return EcommerceWorkRemix{}, err
				}
			}
		}
		result.Materials = append(result.Materials, EcommerceWorkMaterial{ResourceID: copied.ID, Category: category, Name: "同款参考" + extensionFromMimeType(resource.MimeType), Width: copied.Width, Height: copied.Height, DurationMs: copied.DurationMs})
	}
	return result, nil
}
