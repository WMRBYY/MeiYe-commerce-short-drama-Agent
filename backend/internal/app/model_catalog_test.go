package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 目录始终来自系统渠道；空目录也要显式返回数组，不能被会话初始化判成畸形响应。
func TestModelCatalogAlwaysSerializesCollectionsAsArrays(t *testing.T) {
	for _, test := range []struct {
		name            string
		frontendEnabled bool
		wantSource      string
	}{
		{name: "逻辑模型开关不改变目录来源", frontendEnabled: true, wantSource: "system"},
		{name: "空的系统渠道目录", frontendEnabled: false, wantSource: "system"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := newModelCatalogTestService(t)
			if test.frontendEnabled {
				if err := db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"frontendModelsEnabled":true}`}).Error; err != nil {
					t.Fatal(err)
				}
			}

			catalog, err := svc.ModelCatalog(testGroupAccess(svc), nil)
			if err != nil {
				t.Fatal(err)
			}
			if string(catalog.Source) != test.wantSource {
				t.Fatalf("source = %q, want %q", catalog.Source, test.wantSource)
			}

			encoded, err := json.Marshal(catalog)
			if err != nil {
				t.Fatal(err)
			}
			var payload map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &payload); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"models", "channels"} {
				raw, present := payload[key]
				if !present || string(raw) == "null" {
					t.Fatalf("%s 集合没有序列化成数组：%s", key, encoded)
				}
			}
		})
	}
}

func newModelCatalogTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.LogicalModel{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

func TestSmartRouterTestChannelIsAbsentFromDirectCatalogs(t *testing.T) {
	svc, db := newModelCatalogTestService(t)
	for _, id := range []string{"normal", "fault"} {
		if err := db.Create(&model.ModelChannel{ID: id, Scope: model.ChannelScopeSystem, Enabled: true, Name: id, BaseURL: "https://example.com/v1"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.SystemSetting{Key: smartRouterTestChannelsSettingKey, ValueJSON: `["fault"]`}).Error; err != nil {
		t.Fatal(err)
	}
	if hidden, err := svc.IsSmartRouterTestChannel("fault"); err != nil || !hidden {
		t.Fatalf("test channel restriction = %v, %v", hidden, err)
	}
	channels, err := svc.PublicSystemChannels()
	if err != nil || len(channels) != 1 || channels[0].ID != "normal" {
		t.Fatalf("direct channel catalog = %+v, %v", channels, err)
	}
	catalog, err := svc.ModelCatalog(testGroupAccess(svc), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range catalog.Channels {
		if channel.ID == "fault" {
			t.Fatal("fault channel leaked into the direct model catalog")
		}
	}
	if _, err := svc.QuoteChannelModel(testGroupUserID(svc), ChannelModelQuoteRequest{ChannelID: "fault", ModelKey: "gpt-test", Intent: ModelRequestIntent{Capability: "text"}}); err == nil {
		t.Fatal("direct quote admitted the test channel")
	}
	if _, err := svc.CreateTask("ordinary", CreateTaskRequest{Type: "canvas_text", Prompt: "hello", Input: map[string]any{"config": map[string]any{"channelId": "fault"}}}); err == nil {
		t.Fatal("direct task admitted the test channel")
	}
}
