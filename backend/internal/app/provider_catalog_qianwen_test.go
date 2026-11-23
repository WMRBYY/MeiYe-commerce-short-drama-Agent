package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/providercatalog"
)

func TestQianwenProviderCatalogInstall(t *testing.T) {
	service, _ := newChannelModelTestService(t)
	service.providerCatalog = providercatalog.NewSourceForTest("", "", nil, "", func() time.Time {
		return time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	})
	ctx := context.Background()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	provider := providercatalog.BundledQianwen()
	request := ProviderCatalogInstallRequest{APIKey: "sk-test", Enabled: boolPtr(false)}
	for _, item := range provider.Models {
		request.Models = append(request.Models, ProviderCatalogInstallModel{ModelKey: item.ModelKey})
	}
	if _, err := service.VerifyProviderCatalogKey(ctx, admin, provider.ID, ProviderCatalogVerifyRequest{APIKey: "sk-sp-test"}); err == nil || !strings.Contains(err.Error(), "按量付费") {
		t.Fatalf("verify accepted a subscription key: %v", err)
	}
	channel, err := service.InstallProviderCatalog(ctx, admin, provider.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if channel.Enabled || !channel.HasAPIKey || len(channel.Models) != len(provider.Models) {
		t.Fatalf("unexpected preset installation: enabled=%v, has key=%v, models=%d", channel.Enabled, channel.HasAPIKey, len(channel.Models))
	}
	request.APIKey = "sk-sp-test"
	if _, err := service.InstallProviderCatalog(ctx, admin, provider.ID, request); err == nil || !strings.Contains(err.Error(), "按量付费") {
		t.Fatalf("install accepted a subscription key: %v", err)
	}
}
