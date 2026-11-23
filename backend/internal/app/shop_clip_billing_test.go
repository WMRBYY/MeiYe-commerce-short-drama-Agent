package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestShopClipBillingCancellationAtomicAndGenericRetryBlocked(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	svc.activeCancels = map[string]context.CancelFunc{}
	if err := db.Create(&model.CreditAccount{UserID: "clip-billing-user", AvailableMicrocredits: 100 * CreditScale}).Error; err != nil {
		t.Fatal(err)
	}
	plan := ShopClipPlan{PricingVersion: 1, Credits: 10, AutoRender: true}
	data, _ := json.Marshal(plan)
	p := &model.ShopClipProject{ID: "clip-billing", UserID: "clip-billing-user", TaskID: "clip-billing-task", RequestKey: "clip-billing-key", Mode: "koubo", Status: "analyzing", PlanJSON: string(data)}
	task := newShopClipTask(p, model.TaskTypeShopClipAnalysis)
	order, err := shopClipBillingOrder(task, plan)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateShopClip(p, nil); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateTaskWithCreditReservation(task, order, 10); err != nil {
		t.Fatal(err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", p.UserID).Error; err != nil || account.AvailableMicrocredits != 90*CreditScale {
		t.Fatalf("precharge: %+v %v", account, err)
	}
	claimed, err := svc.repo.ClaimNextTask("clip-billing-worker", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	if _, err := svc.CancelTask(context.Background(), p.UserID, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CancelShopClip(context.Background(), p.UserID, p.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&account, "user_id = ?", p.UserID).Error; err != nil || account.AvailableMicrocredits != 100*CreditScale {
		t.Fatalf("refund: %+v %v", account, err)
	}
	var refunds int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerRefund).Count(&refunds).Error; err != nil || refunds != 1 {
		t.Fatalf("duplicate refund: %d %v", refunds, err)
	}
	if _, err := svc.RetryTask(p.UserID, task.ID); err == nil {
		t.Fatal("generic retry bypassed quote")
	}
	worker := newTaskWorkerCoordinator(svc)
	if err := worker.failShopClipTask(claimed, p.ID, "late failure"); err == nil {
		t.Fatal("cancelled worker changed terminal state")
	}
}

func TestShopClipBillingSnapshotAndLegacyStayProtected(t *testing.T) {
	for _, plan := range []ShopClipPlan{{}, {Credits: 10}, {PricingVersion: 1, Credits: 0, AutoRender: true}, {PricingVersion: 1, Credits: 10, AutoRender: false}} {
		task := &model.Task{ID: "test", UserID: "owner", Type: model.TaskTypeShopClipAnalysis}
		order, err := shopClipBillingOrder(task, plan)
		if err != nil || order != nil || task.BillingOrderID != "" {
			t.Fatalf("legacy/review analysis charged: %+v %v", order, err)
		}
	}
	price := int64(10)
	if validateShopClipPrice(nil, 10) == nil || validateShopClipPrice(&price, 12) == nil {
		t.Fatal("unconfirmed price accepted")
	}
	if err := validateShopClipPrice(&price, 10); err != nil {
		t.Fatal(err)
	}
	old := ShopClipPlan{PricingVersion: 1, Credits: 10}
	next := old
	next.Credits = 0
	if shopClipImmutablePlan(old, next) == nil {
		t.Fatal("client changed locked price")
	}
}
