package app

import (
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// A management role grants access to administration, not to a channel excluded
// from the administrator's own group when they act as a model user.
func TestAdminGroupSeparatesManagementAndExecution(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "user", Role: model.UserRoleAdmin}
	group, err := svc.CreateUserGroup(admin, UserGroupRequest{Code: "restricted", Name: "Restricted", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", admin.ID).Updates(map[string]any{"role": model.UserRoleAdmin, "user_group": "restricted"}).Error; err != nil {
		t.Fatal(err)
	}
	var actor model.User
	if err := db.First(&actor, "id = ?", admin.ID).Error; err != nil {
		t.Fatal(err)
	}
	admin = &actor
	// The privileged channel-management API retains the complete inventory.
	models, err := svc.AdminChannelModels(admin, "channel")
	if err != nil || len(models) == 0 {
		t.Fatalf("administrative inventory unavailable: %v", err)
	}
	catalog, err := svc.ModelCatalogForUser(admin, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range catalog.Channels {
		if channel.ID == "channel" {
			t.Error("restricted channel leaked into user's catalog")
		}
	}
	if err := svc.RequireUserChannelAccess(admin, "channel"); err == nil {
		t.Error("restricted administrator proxy access was allowed")
	}
	if _, err := svc.QuoteChannelModel(admin.ID, ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "text-test", Intent: ModelRequestIntent{Capability: "text", Operation: "text_generation"}}); err == nil {
		t.Error("restricted administrator quote was allowed")
	}
	if task, err := svc.CreateTask(admin.ID, creationTextRequest()); err == nil || task != nil {
		t.Errorf("restricted task was admitted: task=%v err=%v", task, err)
	}
	var orders int64
	if err := db.Model(&model.BillingOrder{}).Where("user_id = ?", admin.ID).Count(&orders).Error; err != nil || orders != 0 {
		t.Errorf("restricted task created %d orders: %v", orders, err)
	}
	access, err := svc.userGroupAccess(admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	routes := []cachedLogicalRoute{{Route: model.LogicalModelRoute{ID: "hidden", Enabled: true, Priority: 100, Weight: 1}, ChannelModel: model.ChannelModel{ID: "cm", ModelKey: "text-test", ChannelID: "channel"}, CapabilitySpec: CapabilitySpec{Capability: "text"}}}
	if got := svc.preferredFallbackRoutesWithAccess(access, "text-test", routes, ModelRequestIntent{Capability: "text"}, nil, false); len(got) != 0 {
		t.Error("restricted smart-route fallback was allowed")
	}
	// Positive control: the same model and request are accepted after granting
	// this channel, so denial above cannot pass because of a broken fixture.
	_, err = svc.UpdateUserGroup(admin, group.ID, UserGroupRequest{Name: "Restricted", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale, ChannelIDs: []string{"channel"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.QuoteChannelModel(admin.ID, ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "text-test", Intent: ModelRequestIntent{Capability: "text", Operation: "text_generation"}}); err != nil {
		t.Fatalf("authorized quote: %v", err)
	}
	if task, err := svc.CreateTask(admin.ID, creationTextRequest()); err != nil || task == nil {
		t.Fatalf("authorized task: %v", err)
	}
	access, err = svc.userGroupAccess(admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := svc.preferredFallbackRoutesWithAccess(access, "text-test", routes, ModelRequestIntent{Capability: "text"}, nil, false); len(got) != 1 {
		t.Fatalf("authorized smart-route fallback count = %d", len(got))
	}
}

// Independent processes keep independent UI caches. Revoking access or changing
// rates in one must affect the other process's next quote and execution check.
func TestUserGroupChangesApplyAcrossServiceInstances(t *testing.T) {
	a, db, _, _ := creationTestService(t)
	b := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	admin := &model.User{ID: "group-admin", Role: model.UserRoleAdmin}
	initial := UserGroupRequest{Code: "cross-instance", Name: "Cross instance", RatioBasisPoints: 10000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale, ChannelIDs: []string{"channel"}}
	group, err := a.CreateUserGroup(admin, initial)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("user_group", "cross-instance").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := b.userGroupSnapshot(); err != nil {
		t.Fatal(err)
	}
	quote := func() (int64, error) {
		q, err := b.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "text-test", Intent: ModelRequestIntent{Capability: "text", Operation: "text_generation"}})
		if err != nil {
			return 0, err
		}
		return q.AmountMicrocredits, nil
	}
	if got, err := quote(); err != nil || got != 100 {
		t.Fatalf("initial quote=%d err=%v", got, err)
	}
	updated := UserGroupRequest{Name: "Cross instance", RatioBasisPoints: 5000, PointsPerUSD: CreditScale, PointsPerCNY: CreditScale, ChannelIDs: []string{"channel"}}
	if _, err := a.UpdateUserGroup(admin, group.ID, updated); err != nil {
		t.Fatal(err)
	}
	if got, err := quote(); err != nil || got != 50 {
		t.Errorf("stale quote after rate update=%d err=%v", got, err)
	}
	updated.ChannelIDs = nil
	if _, err := a.UpdateUserGroup(admin, group.ID, updated); err != nil {
		t.Fatal(err)
	}
	if _, err := quote(); err == nil {
		t.Error("second instance accepted quote after channel revocation")
	}
	if task, err := b.CreateTask("user", creationTextRequest()); err == nil || task != nil {
		t.Errorf("second instance accepted revoked task: %v", err)
	}
}

func TestCreditPolicyChangesApplyAcrossServiceInstances(t *testing.T) {
	a, db, _, _ := creationTestService(t)
	b := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	admin := &model.User{ID: "group-admin", Role: model.UserRoleAdmin}
	policy := CreditPolicy{DefaultMultiplierBPS: 10000, ModelMultiplierBPS: map[string]int64{}}
	if _, err := a.UpdateCreditPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	if _, err := b.creditPolicy(); err != nil {
		t.Fatal(err)
	}
	quote := func() (int64, error) {
		q, err := b.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "text-test", Intent: ModelRequestIntent{Capability: "text", Operation: "text_generation"}})
		if err != nil {
			return 0, err
		}
		return q.AmountMicrocredits, nil
	}
	if got, err := quote(); err != nil || got != 100 {
		t.Fatalf("initial quote=%d err=%v", got, err)
	}
	policy.DefaultMultiplierBPS = 15000
	if _, err := a.UpdateCreditPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	if got, err := quote(); err != nil || got != 150 {
		t.Fatalf("stale quote after default policy update=%d err=%v", got, err)
	}
	if current, err := b.AdminCreditPolicy(admin); err != nil || current.DefaultMultiplierBPS != 15000 {
		t.Fatalf("stale admin policy: %+v %v", current, err)
	}
	policy.DefaultMultiplierBPS = 10000
	policy.ModelMultiplierBPS["text-test"] = 20000
	if _, err := a.UpdateCreditPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	if got, err := quote(); err != nil || got != 200 {
		t.Fatalf("stale quote after policy update=%d err=%v", got, err)
	}
	order, err := b.newBillingOrder("user", "task", "policy-update", "channel", "text-test", "text", "test", 1, tokenBillingEstimate{})
	if err != nil || order.AmountMicrocredits != 200 {
		t.Fatalf("stale order after policy update: %+v %v", order, err)
	}
}
