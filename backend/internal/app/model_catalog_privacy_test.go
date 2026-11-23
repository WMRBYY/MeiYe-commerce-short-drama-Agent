package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestModelCatalogForUserHidesSystemChannelIdentityAndKeepsPrice(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	for _, user := range []model.User{
		{ID: "regular", Username: "regular", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	channel := model.ModelChannel{ID: "system-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Lec API", ModelsJSON: `[]`}
	channelModel := model.ChannelModel{
		ID: "model-1", ChannelID: channel.ID, ModelKey: "gpt-test", DisplayName: "GPT Test",
		ChannelLabel: "Lec API", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion,
		CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "gpt-test")),
		BillingMode:          "fixed_request", PriceConfigured: true, Enabled: true,
	}
	priceTier := model.ChannelModelPriceTier{
		ID: "price-1", ChannelModelID: channelModel.ID, SelectorKey: `{}`, SelectorJSON: `{}`,
		BillingMode: "fixed_request", UnitPriceMicrocredits: 300000, PriceConfigured: true, Enabled: true,
	}
	for _, item := range []any{&channel, &channelModel, &priceTier} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.ModelCatalogForUser(nil, nil); err == nil {
		t.Fatal("anonymous actor received the model catalog")
	}
	regular, err := svc.ModelCatalogForUser(&model.User{ID: "regular", Role: model.UserRoleUser}, nil)
	if err != nil || len(regular.Channels) != 1 || len(regular.Channels[0].Models) != 1 {
		t.Fatalf("regular catalog: %#v, %v", regular, err)
	}
	publicChannel := regular.Channels[0]
	if publicChannel.Name != "系统渠道" || publicChannel.DisplayName != "系统渠道" || publicChannel.Models[0].ChannelLabel != "" {
		t.Fatalf("regular catalog leaked channel identity: %#v", publicChannel)
	}
	if publicChannel.ID != channel.ID || publicChannel.Models[0].ModelKey != channelModel.ModelKey ||
		!publicChannel.Models[0].Available || len(publicChannel.Models[0].PriceTiers) != 1 ||
		publicChannel.Models[0].PriceTiers[0].UnitPriceMicrocredits != priceTier.UnitPriceMicrocredits {
		t.Fatalf("regular catalog lost routing or pricing: %#v", publicChannel)
	}
	admin, err := svc.ModelCatalogForUser(&model.User{ID: "admin", Role: model.UserRoleAdmin}, nil)
	if err != nil || len(admin.Channels) != 1 || admin.Channels[0].Name != channel.Name ||
		admin.Channels[0].Models[0].ChannelLabel != channelModel.ChannelLabel {
		t.Fatalf("admin catalog lost channel identity: %#v, %v", admin, err)
	}
	if err := db.Model(&channelModel).Update("channel_label", "公开优选").Error; err != nil {
		t.Fatal(err)
	}
	regular, err = svc.ModelCatalogForUser(&model.User{ID: "regular", Role: model.UserRoleUser}, nil)
	if err != nil || regular.Channels[0].Models[0].ChannelLabel != "公开优选" {
		t.Fatalf("regular catalog lost configured public label: %#v, %v", regular, err)
	}
	if err := db.Model(&channelModel).Updates(map[string]any{"channel_label": "", "provider_model_key": "private-upstream-id"}).Error; err != nil {
		t.Fatal(err)
	}
	regular, err = svc.ModelCatalogForUser(&model.User{ID: "regular", Role: model.UserRoleUser}, nil)
	if err != nil || regular.Channels[0].Models[0].ChannelLabel != "" {
		t.Fatalf("regular catalog exposed default upstream label: %#v, %v", regular, err)
	}
}
