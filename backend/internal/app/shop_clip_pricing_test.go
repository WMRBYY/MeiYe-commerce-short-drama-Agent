package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestShopClipPricingDefaultAndPersistence(t *testing.T) {
	svc := newShopClipKnowledgeTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	price, err := svc.ShopClipPrice()
	if err != nil || price != 10 {
		t.Fatalf("new clip default price: %d %v", price, err)
	}
	row, err := svc.repo.SystemSettingOptional(shopClipPricingSettingKey)
	if err != nil || row != nil {
		t.Fatal("reading default price must not create a setting")
	}
	status, err := svc.ShopClipPricingAdmin(admin)
	if err != nil || status.Configured || status.DefaultCredits != 10 {
		t.Fatalf("unexpected default status: %+v %v", status, err)
	}
	for _, amount := range []int64{25, 0, shopClipMaxCredits} {
		status, err := svc.UpdateShopClipPricing(admin, ShopClipPricingUpdate{CreditsPerClip: &amount})
		if err != nil || !status.Configured || status.CreditsPerClip != amount || status.UpdatedAt.IsZero() {
			t.Fatalf("save failed for %d: %+v %v", amount, status, err)
		}
		got, err := svc.ShopClipPrice()
		if err != nil || got != amount {
			t.Fatalf("quote/create getter did not read saved price: %d %v", got, err)
		}
	}
}

func TestShopClipPricingRejectsInvalidWritesAndNonAdmins(t *testing.T) {
	svc := newShopClipKnowledgeTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	amount := int64(20)
	for _, actor := range []*model.User{nil, {ID: "user", Role: model.UserRoleUser}} {
		if _, err := svc.ShopClipPricingAdmin(actor); err == nil {
			t.Fatal("non-admin read accepted")
		}
		if _, err := svc.UpdateShopClipPricing(actor, ShopClipPricingUpdate{CreditsPerClip: &amount}); err == nil {
			t.Fatal("non-admin price change accepted")
		}
	}
	if _, err := svc.UpdateShopClipPricing(admin, ShopClipPricingUpdate{}); err == nil {
		t.Fatal("omitted price must not silently become free")
	}
	for _, amount := range []int64{-1, shopClipMaxCredits + 1} {
		if _, err := svc.UpdateShopClipPricing(admin, ShopClipPricingUpdate{CreditsPerClip: &amount}); err == nil {
			t.Fatalf("out-of-range price accepted: %d", amount)
		}
	}
	for _, raw := range []string{`{"creditsPerClip":0.5}`, `{"creditsPerClip":"10"}`, `{"creditsPerClip":9223372036854775808}`} {
		var input ShopClipPricingUpdate
		if err := json.Unmarshal([]byte(raw), &input); err == nil {
			t.Fatalf("non-integer or overflow JSON accepted: %s", raw)
		}
	}
	if price, err := svc.ShopClipPrice(); err != nil || price != 10 {
		t.Fatalf("rejected write changed the price: %d %v", price, err)
	}
}

func TestShopClipPricingCorruptStorageFailsClosed(t *testing.T) {
	svc := newShopClipKnowledgeTestService(t)
	for _, raw := range []string{`not-json`, `{}`, `{"creditsPerClip":null}`, `{"creditsPerClip":-1}`, `{"creditsPerClip":100001}`, `{"creditsPerClip":0.5}`} {
		if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: shopClipPricingSettingKey, ValueJSON: raw}); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.ShopClipPrice(); err == nil {
			t.Fatalf("invalid billing configuration fell back silently: %s", raw)
		}
	}
}
