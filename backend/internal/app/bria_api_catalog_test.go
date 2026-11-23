package app

import (
	"context"
	"testing"

	"yingce/backend/internal/model"
)

func TestBriaCatalogImportsDocumentedVisualProtocolsDisabled(t *testing.T) {
	items, err := briaAPICatalog()
	if err != nil || len(items) != 58 {
		t.Fatalf("Bria catalog = %d operations, %v", len(items), err)
	}
	if !validateBriaBaseURL("https://engine.prod.bria-api.com") || validateBriaBaseURL("http://engine.prod.bria-api.com") || validateBriaBaseURL("https://example.com") {
		t.Fatal("Bria base URL validation failed")
	}
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "bria-channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Bria", BaseURL: "https://engine.prod.bria-api.com", APIKey: "test-token", APIFormat: "bria", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	preview, err := svc.PreviewAdminChannelModels(context.Background(), admin, channel.ID)
	if err != nil || len(preview) != 58 {
		t.Fatalf("Bria preview = %d operations, %v", len(preview), err)
	}
	selected := make([]string, 0, len(items))
	for _, operation := range items {
		selected = append(selected, operation.ID)
	}
	imported, err := svc.ImportAdminChannelModels(context.Background(), admin, channel.ID, selected)
	if err != nil || imported.Added != int64(len(items)) {
		t.Fatalf("Bria import = %#v, %v", imported, err)
	}
	models, err := svc.repo.ChannelModels(channel.ID, true)
	if err != nil || len(models) != len(items) {
		t.Fatalf("Bria saved models = %#v, %v", models, err)
	}
	for _, item := range models {
		operation, ok := briaCatalogOperation(item.ModelKey)
		capability := operation.Capability
		if operation.Protocol == "" {
			capability = ""
		} else if capability == "data" {
			capability = "text"
		}
		if !ok || item.Capability != capability || string(item.Protocol) != operation.Protocol || item.Enabled || item.PriceConfigured {
			t.Fatalf("Bria imported model = %#v; catalog = %#v", item, operation)
		}
	}
	for _, item := range models {
		if item.ModelKey != "/v2/image/edit/remove_background" && item.ModelKey != "/v2/image/generate" {
			continue
		}
		config := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(item.Protocol), item.ModelKey))
		if err := db.Model(&item).Updates(map[string]any{"enabled": true, "price_configured": true, "capability_config_json": config}).Error; err != nil {
			t.Fatal(err)
		}
		tier := model.ChannelModelPriceTier{ID: newID(), ChannelModelID: item.ID, SelectorKey: `{}`, SelectorJSON: `{}`, BillingMode: "fixed_request", UnitPriceMicrocredits: 1000000, PriceConfigured: true, Enabled: true}
		if err := db.Create(&tier).Error; err != nil {
			t.Fatal(err)
		}
	}
	ensureTestUsers(t, db, "user")
	public, err := svc.ModelCatalogForUser(&model.User{ID: "user", Role: model.UserRoleUser}, nil)
	if err != nil || len(public.Channels) != 1 || len(public.Channels[0].Models) != 1 {
		t.Fatalf("Bria managed-only public catalog = %#v, %v", public, err)
	}
	visible := public.Channels[0].Models[0]
	if visible.ModelKey != "/v2/image/edit/remove_background" || !visible.ManagedNodeOnly {
		t.Fatalf("Bria generic generation leaked into creation catalog: %#v", visible)
	}
	agentList, err := svc.cloudAgentModelList(testGroupUserID(svc), nil)
	if err != nil {
		t.Fatal(err)
	}
	listed, _ := agentList.(map[string]any)["models"].([]map[string]any)
	if len(listed) != 0 {
		t.Fatalf("Bria managed node leaked into Agent model list: %#v", listed)
	}
	if _, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{"config": map[string]any{"channelId": channel.ID, "model": "/v2/image/generate"}}, "canvas_image", "image"); err == nil {
		t.Fatal("Bria generic generation was admitted through system channel")
	}
}

func TestBriaManagedCatalogDefaultsExcludeUnsupportedOptions(t *testing.T) {
	cases := []struct{ key, protocol, capability string }{
		{"/v2/image/edit/erase_foreground", "bria-v2-image-edit-erase-foreground", "image"},
		{"/v2/image/edit/expand", "bria-v2-image-edit-expand", "image"},
		{"/v2/image/edit/increase_resolution", "bria-v2-image-edit-increase-resolution", "image"},
		{"/v2/image/edit/remove_background", "bria-v2-image-edit-remove-background", "image"},
		{"/v2/video/edit/increase_resolution", "bria-v2-video-edit-increase-resolution", "video"},
		{"/v2/video/edit/replace_background", "bria-v2-video-edit-replace-background", "video"},
	}
	for _, item := range cases {
		t.Run(item.protocol, func(t *testing.T) {
			config := DefaultModelCapabilityConfigForModel(item.protocol, item.key)
			if item.capability == "image" {
				config.Image.Size = ImageSizeConfig{Parameter: "none", Default: "auto"}
				config.Image.Resolution = ImageResolutionConfig{Default: "auto"}
			} else {
				config.Video.Ratios = nil
				config.Video.DefaultRatio = ""
				config.Video.Resolutions = nil
				config.Video.DefaultResolution = ""
			}
			spec, err := CapabilitySpecFromModelCapabilityConfig(config, item.capability)
			if err != nil {
				t.Fatal(err)
			}
			cm := model.ChannelModel{
				ModelKey: item.key, ProviderModelKey: item.key, Capability: item.capability,
				Protocol: model.ChannelInterfaceType(item.protocol), CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, config),
			}
			defaults, err := channelModelDefaultOptions(cm, spec, config)
			if err != nil {
				t.Fatalf("managed defaults invalid: %v", err)
			}
			if _, hasSize := defaults["size"]; hasSize {
				t.Fatalf("unsupported size default: %#v", defaults)
			}
			if _, hasQuality := defaults["vquality"]; hasQuality {
				t.Fatalf("unsupported video quality default: %#v", defaults)
			}
		})
	}
}

func TestBriaProtocolsOnlyAdmitMatchingManagedCanvasNodes(t *testing.T) {
	allowed := map[string]struct {
		protocol string
		taskType string
	}{
		"image-remove-background":  {"bria-v2-image-edit-remove-background", "canvas_image"},
		"psd-layers":               {"bria-v2-image-edit-erase-foreground", "canvas_image"},
		"image-upscale":            {"bria-v2-image-edit-increase-resolution", "canvas_image"},
		"image-expand":             {"bria-v2-image-edit-expand", "canvas_image"},
		"video-replace-background": {"bria-v2-video-edit-replace-background", "canvas_video"},
		"video-upscale":            {"bria-v2-video-edit-increase-resolution", "canvas_video"},
	}
	for nodeID, item := range allowed {
		input := map[string]any{"config": map[string]any{"interfaceType": item.protocol}, "metadata": map[string]any{"canvasNodeId": nodeID}}
		if err := requireBriaManagedCanvasTask(input, item.taskType); err != nil {
			t.Fatalf("%s rejected: %v", nodeID, err)
		}
		input["metadata"] = map[string]any{"canvasNodeId": "ordinary-image"}
		if err := requireBriaManagedCanvasTask(input, item.taskType); err == nil {
			t.Fatalf("%s accepted as ordinary creation", nodeID)
		}
		input["metadata"] = map[string]any{"canvasNodeId": nodeID}
		if err := requireBriaManagedCanvasTask(input, "canvas_text"); err == nil {
			t.Fatalf("%s accepted as text creation", nodeID)
		}
	}
	if err := requireBriaManagedCanvasTask(map[string]any{"config": map[string]any{"interfaceType": "bria-v2-image-edit-remove-background"}, "metadata": map[string]any{"canvasNodeId": "psd-layers"}}, "canvas_image"); err != nil {
		t.Fatalf("PSD subject cutout rejected: %v", err)
	}
	for _, protocolID := range []string{"bria-v2-image-generate", "bria-v2-ads-delayer", "bria-v2-structured-prompt-generate"} {
		input := map[string]any{"config": map[string]any{"interfaceType": protocolID}, "metadata": map[string]any{"canvasNodeId": "image-upscale"}}
		if err := requireBriaManagedCanvasTask(input, "canvas_image"); err == nil {
			t.Fatalf("unrelated Bria protocol %s was accepted", protocolID)
		}
	}
	if got := briaManagedCanvasNode("image-tools-layer-decomposition"); got != "" {
		t.Fatalf("PSD decomposition incorrectly depends on Bria: %s", got)
	}
}
