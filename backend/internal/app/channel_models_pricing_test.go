package app

import (
	"testing"

	"yingce/backend/internal/model"
	protocolcontract "yingce/backend/internal/protocol"
)

func TestImagePriceTierResolutionCanBeSavedAndMatched(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: "https://example.com/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	enabled := true
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{
		ModelKey: "gpt-image-2", DisplayName: "GPT Image 2", Capability: "image", Protocol: string(model.ChannelInterfaceOpenAIImage),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2"),
		PriceTiers: []ChannelModelPriceTierRequest{
			{BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled},
			{Selector: map[string]string{"resolution": "4K"}, BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled},
		},
		Enabled: &enabled,
	})
	if err != nil {
		t.Fatalf("save image model with resolution price tier: %v", err)
	}
	if len(saved.PriceTiers) != 2 {
		t.Fatalf("saved price tiers = %#v", saved.PriceTiers)
	}
	for _, tier := range saved.PriceTiers {
		if tier.Selector["resolution"] == "4k" && tier.Resolution != "*" {
			t.Fatalf("image resolution leaked into legacy video field: %#v", tier)
		}
	}
	for _, test := range []struct {
		size           string
		wantResolution string
	}{
		{size: "2880x2880", wantResolution: "4k"},
		{size: "2048x2048", wantResolution: ""},
	} {
		matched := channelModelPriceTierForIntent(*saved, ModelRequestIntent{Capability: "image", Options: map[string]any{"quality": "medium", "size": test.size}})
		if matched == nil || matched.Selector["resolution"] != test.wantResolution {
			t.Errorf("size %s matched %#v, want resolution %q", test.size, matched, test.wantResolution)
		}
	}
}

func TestImagePriceTierResolutionRejectsOtherCapabilities(t *testing.T) {
	for _, capability := range []string{"text", "video", "audio"} {
		if _, _, _, err := normalizeChannelModelTierSelector(capability, ChannelModelPriceTierRequest{
			Selector: map[string]string{"resolution": "4k"},
		}); err == nil {
			t.Errorf("%s model accepted image resolution selector", capability)
		}
	}
}

func TestLegacyImageResolutionPriceCannotExceedModelPresets(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	profile.Image.Parameters = []protocolcontract.ImageParameter{}
	profile.Image.Size.Presets = profile.Image.Size.Presets[:1]
	tiers := []model.ChannelModelPriceTier{{Selector: map[string]string{"resolution": "4k"}}}
	if err := validateChannelModelTierCapabilities(tiers, mustEncodeModelCapabilityConfig(t, profile), "image", string(model.ChannelInterfaceOpenAIImage)); err == nil {
		t.Fatal("unsupported 4K legacy price tier was accepted")
	}
}
