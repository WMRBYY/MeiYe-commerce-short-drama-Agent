package app

import (
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

type ShopClipQuote struct {
	Credits    int64  `json:"credits"`
	ChargeMode string `json:"chargeMode"`
	Label      string `json:"label"`
	ChargeAt   string `json:"chargeAt"`
}

func shopClipCreatePlan(req ShopClipCreateRequest) (ShopClipPlan, error) {
	p := ShopClipPlan{Version: 1, TemplateVersion: 1, SourceResourceID: req.SourceResourceID, Materials: req.MaterialResourceIDs, Transcript: []ShopClipCue{}, Placements: []ShopClipPlacement{}, TemplateID: req.TemplateID, Title: strings.TrimSpace(req.Title), BehindText: strings.TrimSpace(req.BehindText), BehindPosition: req.BehindPosition, SubjectBox: req.SubjectBox, AutoRender: req.AutoRender, ReferenceText: strings.TrimSpace(req.ReferenceText), Visual: req.Visual, TrimStartMs: req.TrimStartMs, TrimEndMs: req.TrimEndMs, MusicResourceID: req.MusicResourceID, MusicVolume: req.MusicVolume}
	if p.Title == "" || utf8.RuneCountInString(p.Title) > 100 {
		return p, BadAuthRequest("请为这支成片填写标题，最多 100 字")
	}
	if p.Materials == nil {
		p.Materials = []string{}
	}
	if p.TemplateID == "" {
		p.TemplateID = "clean"
	}
	if p.BehindPosition == "" {
		p.BehindPosition = "center"
	}
	return p, nil
}

func shopClipTrimEnd(start, end, duration int64) (int64, error) {
	if end == 0 {
		end = duration
	}
	if start < 0 || end > duration || end <= start || end-start < 500 {
		return 0, BadAuthRequest("请选择视频内至少 0.5 秒的剪辑范围")
	}
	return end, nil
}

func shopClipNeedsAnalysis(mode string, plan ShopClipPlan) bool {
	return mode != "behind" && (len(plan.Transcript) == 0 || plan.AutoRender && (plan.Director == nil || plan.Director.CaptionMaxChars == 0)) || mode == "mix" && len(plan.Placements) == 0
}

// Quotes never call a paid model, download videos, or start a render.
func (s *Service) QuoteShopClip(userID string, req ShopClipCreateRequest) (*ShopClipQuote, error) {
	if req.ProjectID != "" {
		if err := s.RequireFeature(FeatureEcommerce); err != nil {
			return nil, err
		}
		project, err := s.ShopClip(userID, req.ProjectID)
		if err != nil {
			return nil, err
		}
		return shopClipQuote(project.Plan.Credits, project.Plan.AutoRender || project.RetryStage == "render"), nil
	}
	if err := s.shopClipCapability(userID, req.Mode); err != nil {
		return nil, err
	}
	if req.AutoRender && req.Mode != "behind" {
		if _, _, err := s.shopClipMatchingConfig(userID, 1); err != nil {
			return nil, err
		}
	}
	if req.Mode == "mix" {
		if _, _, err := s.shopClipMatchingConfig(userID, len(req.MaterialResourceIDs)); err != nil {
			return nil, err
		}
	}
	plan, err := shopClipCreatePlan(req)
	if err != nil {
		return nil, err
	}
	if plan.SourceResourceID == "" || len(plan.Materials) > 8 {
		return nil, BadAuthRequest("请选择口播视频，辅助素材最多 8 个")
	}
	assets := map[string]shopClipAsset{}
	for _, id := range shopClipResourceIDs(plan) {
		if _, exists := assets[id]; id == "" || exists {
			return nil, BadAuthRequest("素材引用为空或重复")
		}
		resource, err := s.repo.ResourceForUser(userID, id)
		if err != nil {
			return nil, BadAuthRequest("素材不可读取")
		}
		mime := "video/"
		if id == plan.MusicResourceID {
			mime = "audio/"
		}
		if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, mime) || resource.Size > 512<<20 {
			return nil, BadAuthRequest("请选择已上传完成且不超过 512 MB 的素材")
		}
		// Uploaded metadata is only a quote preflight; creation probes real bytes.
		duration := resource.DurationMs
		if duration <= 0 {
			duration = 300000
		}
		if duration > 300000 {
			return nil, BadAuthRequest("剪辑素材不能超过 5 分钟")
		}
		assets[id] = shopClipAsset{duration: duration}
		if id == plan.SourceResourceID {
			end, err := shopClipTrimEnd(plan.TrimStartMs, plan.TrimEndMs, duration)
			if err != nil {
				return nil, err
			}
			plan.DurationMs = end - plan.TrimStartMs
		}
	}
	if err := validateShopClipPlan(req.Mode, plan, assets, false); err != nil {
		return nil, err
	}
	price, err := s.ShopClipPrice()
	if err != nil {
		return nil, err
	}
	return shopClipQuote(price, req.AutoRender), nil
}

func shopClipQuote(price int64, submit bool) *ShopClipQuote {
	quote := &ShopClipQuote{Credits: price, ChargeMode: "fixed", Label: "每条成片固定积分", ChargeAt: "render"}
	if price == 0 {
		quote.ChargeMode = "free"
		quote.Label = "当前剪辑免积分"
	}
	if submit {
		quote.ChargeAt = "submit"
	}
	return quote
}
