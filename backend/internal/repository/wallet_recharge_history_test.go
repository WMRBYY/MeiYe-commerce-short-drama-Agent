package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCreditLedgerTopupScopesUserAndPaginatesAfterFiltering(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	now := time.Now().UTC()
	entries := []model.CreditLedgerEntry{
		{ID: "online", UserID: "alice", Type: model.CreditLedgerPaymentTopup, AmountMicrocredits: 5_000_000, PaymentOrderID: "payment-1", CreatedAt: now},
		{ID: "redeem", UserID: "alice", Type: model.CreditLedgerRedeem, AmountMicrocredits: 2_000_000, CreatedAt: now.Add(-time.Hour)},
		{ID: "consume", UserID: "alice", Type: model.CreditLedgerConsume, AmountMicrocredits: -1_000_000, CreatedAt: now.Add(time.Hour)},
		{ID: "bonus", UserID: "alice", Type: model.CreditLedgerCheckinBonus, AmountMicrocredits: 1_000_000, CreatedAt: now.Add(time.Hour)},
		{ID: "refund", UserID: "alice", Type: model.CreditLedgerRefund, AmountMicrocredits: 1_000_000, CreatedAt: now.Add(time.Hour)},
		{ID: "other", UserID: "bob", Type: model.CreditLedgerPaymentTopup, AmountMicrocredits: 9_000_000, CreatedAt: now.Add(time.Hour)},
	}
	if err := db.Create(&entries).Error; err != nil {
		t.Fatal(err)
	}
	for offset, expected := range []string{"online", "redeem"} {
		items, total, err := repo.CreditLedger("alice", "topup", 1, offset)
		if err != nil || total != 2 || len(items) != 1 || items[0].ID != expected {
			t.Fatalf("offset %d: items=%+v total=%d err=%v", offset, items, total, err)
		}
	}
	items, total, err := repo.CreditLedger("new-user", "topup", 20, 0)
	if err != nil || total != 0 || len(items) != 0 {
		t.Fatalf("empty account: items=%+v total=%d err=%v", items, total, err)
	}
}
