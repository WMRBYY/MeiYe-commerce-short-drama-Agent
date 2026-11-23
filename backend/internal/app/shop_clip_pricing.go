package app

import (
	"encoding/json"
	"errors"
	"time"

	"yingce/backend/internal/model"
)

const shopClipPricingSettingKey = "shop_clip_pricing_setting"
const shopClipDefaultCredits int64 = 10
const shopClipMaxCredits int64 = 100000

type ShopClipPricingUpdate struct {
	// A pointer distinguishes an explicitly free clip from an omitted price.
	CreditsPerClip *int64 `json:"creditsPerClip"`
}

type ShopClipPricing struct {
	CreditsPerClip int64     `json:"creditsPerClip"`
	DefaultCredits int64     `json:"defaultCredits"`
	MaxCredits     int64     `json:"maxCredits"`
	Configured     bool      `json:"configured"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type shopClipPricingRecord struct {
	CreditsPerClip *int64    `json:"creditsPerClip"`
	UpdatedAt      time.Time `json:"updatedAt"`
	UpdatedBy      string    `json:"updatedBy"`
}

func (s *Service) shopClipPricing() (*ShopClipPricing, error) {
	row, err := s.repo.SystemSettingOptional(shopClipPricingSettingKey)
	if err != nil {
		return nil, err
	}
	result := &ShopClipPricing{CreditsPerClip: shopClipDefaultCredits, DefaultCredits: shopClipDefaultCredits, MaxCredits: shopClipMaxCredits}
	if row == nil {
		return result, nil
	}
	var saved shopClipPricingRecord
	if err := json.Unmarshal([]byte(row.ValueJSON), &saved); err != nil || saved.CreditsPerClip == nil || *saved.CreditsPerClip < 0 || *saved.CreditsPerClip > shopClipMaxCredits {
		return nil, errors.New("剪辑计费配置无效，请管理员检查后重试")
	}
	result.CreditsPerClip, result.Configured, result.UpdatedAt = *saved.CreditsPerClip, true, saved.UpdatedAt
	return result, nil
}

// ShopClipPrice returns whole credits for a new clip. Callers persist this quote
// on submission; later configuration changes must not reprice existing tasks.
func (s *Service) ShopClipPrice() (int64, error) {
	setting, err := s.shopClipPricing()
	if err != nil {
		return 0, err
	}
	return setting.CreditsPerClip, nil
}

func (s *Service) ShopClipPricingAdmin(actor *model.User) (*ShopClipPricing, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.shopClipPricing()
}

func (s *Service) UpdateShopClipPricing(actor *model.User, input ShopClipPricingUpdate) (*ShopClipPricing, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if input.CreditsPerClip == nil || *input.CreditsPerClip < 0 || *input.CreditsPerClip > shopClipMaxCredits {
		return nil, BadAuthRequest("每条剪辑积分需为 0 至 100000 的整数")
	}
	credits := *input.CreditsPerClip
	now := time.Now().UTC()
	saved := shopClipPricingRecord{CreditsPerClip: &credits, UpdatedAt: now, UpdatedBy: actor.ID}
	data, err := json.Marshal(saved)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: shopClipPricingSettingKey, ValueJSON: string(data), UpdatedBy: actor.ID}); err != nil {
		return nil, err
	}
	return &ShopClipPricing{CreditsPerClip: credits, DefaultCredits: shopClipDefaultCredits, MaxCredits: shopClipMaxCredits, Configured: true, UpdatedAt: now}, nil
}
