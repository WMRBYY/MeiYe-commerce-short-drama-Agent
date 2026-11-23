package app

import (
	"encoding/json"
	"strings"
	"yingce/backend/internal/model"
)

// EcommerceWorkMetadata is the explicitly published prompt and image selection.
// Resource IDs are stored privately and rewritten to scoped URLs in cards.
type EcommerceWorkMetadata struct {
	Prompt                   string   `json:"prompt"`
	Model                    string   `json:"model"`
	ReferenceResourceIDs     []string `json:"referenceResourceIds"`
	ReferenceVideoResourceID string   `json:"referenceVideoResourceId,omitempty"`
	ReferenceCategories      []string `json:"referenceCategories,omitempty"`
	ReplaceMode              string   `json:"replaceMode,omitempty"`
}

func (s *Service) submitEcommerceWork(user *model.User, req CanvasTemplateSubmitRequest) (CanvasTemplateCard, error) {
	if req.Category != "ecommerce" {
		return CanvasTemplateCard{}, BadAuthRequest("电商视频请选择电商分类")
	}
	pending, err := s.repo.CountUserCanvasTemplates(user.ID, model.CanvasTemplateStatusPending, "")
	if err != nil {
		return CanvasTemplateCard{}, err
	}
	if pending >= canvasTemplatePendingMax {
		return CanvasTemplateCard{}, NewAppError(429, "你已有 5 个作品正在审核中，请等待审核结果后再提交")
	}
	title, fits := normalizeCanvasTemplateText(req.Title, 40, false)
	if title == "" || !fits {
		return CanvasTemplateCard{}, BadAuthRequest("请填写 1–40 字的作品名称")
	}
	description, fits := normalizeCanvasTemplateText(req.Description, 500, true)
	if !fits {
		return CanvasTemplateCard{}, BadAuthRequest("作品简介不能超过 500 字")
	}
	meta := *req.Ecommerce
	meta.Prompt, fits = normalizeCanvasTemplateText(meta.Prompt, 6000, true)
	if meta.Prompt == "" || !fits {
		return CanvasTemplateCard{}, BadAuthRequest("请填写 1–6000 字的提示词")
	}
	meta.Model, fits = normalizeCanvasTemplateText(meta.Model, 80, false)
	if meta.Model == "" || !fits {
		return CanvasTemplateCard{}, BadAuthRequest("请填写生成模型，最多 80 字")
	}
	if len(meta.ReferenceResourceIDs) > 3 {
		return CanvasTemplateCard{}, BadAuthRequest("最多选择 3 张参考图")
	}
	video, err := s.canvasTemplateUpload(user.ID, req.VideoResourceID, "video", "成片视频")
	if err != nil {
		return CanvasTemplateCard{}, err
	}
	cover, err := s.canvasTemplateUpload(user.ID, req.CoverResourceID, "image", "封面")
	if err != nil {
		return CanvasTemplateCard{}, err
	}
	ids := []string{video.ID, cover.ID}
	if meta.ReferenceVideoResourceID != "" {
		reference, err := s.canvasTemplateUpload(user.ID, meta.ReferenceVideoResourceID, "video", "参考视频")
		if err != nil {
			return CanvasTemplateCard{}, err
		}
		meta.ReferenceVideoResourceID = reference.ID
		ids = append(ids, reference.ID)
	}
	if len(meta.ReferenceCategories) != 0 && len(meta.ReferenceCategories) != len(meta.ReferenceResourceIDs) {
		return CanvasTemplateCard{}, BadAuthRequest("参考图片分类与图片数量不一致")
	}
	for _, category := range meta.ReferenceCategories {
		if !ecommerceWorkImageCategory(category) {
			return CanvasTemplateCard{}, BadAuthRequest("参考图片分类无效")
		}
	}
	if meta.ReplaceMode != "" && !ecommerceWorkReplaceMode(meta.ReplaceMode) {
		return CanvasTemplateCard{}, BadAuthRequest("替换类型无效")
	}
	refs := []string{}
	seen := map[string]bool{}
	for _, raw := range meta.ReferenceResourceIDs {
		id := strings.TrimSpace(raw)
		if seen[id] {
			return CanvasTemplateCard{}, BadAuthRequest("参考图不能重复")
		}
		seen[id] = true
		image, err := s.canvasTemplateUpload(user.ID, id, "image", "参考图")
		if err != nil {
			return CanvasTemplateCard{}, err
		}
		refs = append(refs, image.ID)
		ids = append(ids, image.ID)
	}
	meta.ReferenceResourceIDs = refs
	payload, err := json.Marshal(map[string]any{"ecommerce": meta, "nodes": []any{}, "connections": []any{}})
	if err != nil {
		return CanvasTemplateCard{}, err
	}
	work := model.CanvasTemplate{ID: newID(), UserID: user.ID, CanvasID: "ecommerce-" + newID(), Title: title, Description: description, Category: "ecommerce", TagsJSON: "[]", VideoResourceID: video.ID, CoverResourceID: cover.ID, VideoDurationMs: video.DurationMs, VideoWidth: video.Width, VideoHeight: video.Height, VideoBytes: video.Size, AllowDownload: req.AllowDownload, PayloadJSON: string(payload), Status: model.CanvasTemplateStatusPending}
	if err := s.repo.ReplacePendingCanvasTemplate(&work, ids); err != nil {
		return CanvasTemplateCard{}, err
	}
	cards, err := s.canvasTemplateCards(user, []model.CanvasTemplate{work}, canvasTemplateScopeOwner)
	if err != nil {
		return CanvasTemplateCard{}, err
	}
	return cards[0], nil
}
