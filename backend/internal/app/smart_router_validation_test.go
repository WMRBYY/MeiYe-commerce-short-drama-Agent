package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestSmartRouteAdminRejectsUnsafeCandidateRules(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test"))
	for _, item := range []any{
		&model.ModelChannel{ID: "backup-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "备用"},
		&model.ChannelModel{ID: "backup-model", ChannelID: "backup-channel", ModelKey: "text-test", ProviderModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "backup-tier", ChannelModelID: "backup-model", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", PriceConfigured: true, Enabled: true, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 100}},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier").Updates(map[string]any{"cost_configured": true, "cost_unit_price_microcredits": 100}).Error; err != nil {
		t.Fatal(err)
	}
	group := &model.LogicalModel{ID: "group", Code: "test-group", Name: "测试组", Capability: "text", Enabled: true, PricePolicy: "channel"}
	routes := []model.LogicalModelRoute{
		{ChannelModelID: "cm", Priority: 200, Weight: 1, Enabled: true},
		{ChannelModelID: "backup-model", Priority: 100, Weight: 1, Enabled: true},
	}
	policy := SmartRoutePolicyRequest{Enabled: true, Mode: "priority", FailoverEnabled: true, GrayPercent: 100, MaxAttempts: 2, MaxUpstreamCostMicrocredits: 1000}
	if err := svc.validateSmartRouteCandidates(group, routes, policy); err != nil {
		t.Fatalf("valid same-model routes rejected: %v", err)
	}
	assertReject := func(reason string, changed []model.LogicalModelRoute, candidate SmartRoutePolicyRequest) {
		t.Helper()
		if err := svc.validateSmartRouteCandidates(group, changed, candidate); err == nil || !strings.Contains(err.Error(), reason) {
			t.Fatalf("want rejection containing %q, got %v", reason, err)
		}
	}
	oneAttempt := policy
	oneAttempt.MaxAttempts = 1
	assertReject("至少 2 个", routes[:1], oneAttempt)
	assertReject("最多尝试 1 次", routes, oneAttempt)
	lowBudget := policy
	lowBudget.MaxUpstreamCostMicrocredits = 100
	assertReject("候选所需预算", routes, lowBudget)
	withoutBudget := policy
	withoutBudget.MaxUpstreamCostMicrocredits = 0
	assertReject("成本上限", routes, withoutBudget)
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "backup-channel").Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	assertReject("已停用", routes, policy)
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "backup-channel").Update("enabled", true).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "backup-tier").Update("cost_configured", false).Error; err != nil {
		t.Fatal(err)
	}
	assertReject("未配置上游成本", routes, policy)
	group.Capability = "video"
	assertReject("视频", routes, policy)
}

func TestSmartRouterGlobalRequiresExplicitAllUserConfirmation(t *testing.T) {
	svc, _, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if err := svc.SetAdminSmartRouterGlobal(admin, SmartRouterGlobalSetting{Enabled: true}); err == nil {
		t.Fatal("empty allowlist was accepted without all-user confirmation")
	}
	if err := svc.SetAdminSmartRouterGlobal(admin, SmartRouterGlobalSetting{Enabled: true, AllUsersConfirmed: true}); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.smartRouterGlobal()
	if err != nil || !stored.Enabled || stored.AllUsersConfirmed {
		t.Fatalf("confirmation must not persist: %+v %v", stored, err)
	}
}
