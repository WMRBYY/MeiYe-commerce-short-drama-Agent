package repository

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestDirectDebitLifecycle(t *testing.T) {
	for _, action := range []string{"success", "failure", "uncertain", "audio", "token"} {
		t.Run(action, func(t *testing.T) {
			r, db := newRefundedBillingRecoveryRepository(t)
			if err := db.Create(&model.CreditAccount{UserID: "u", AvailableMicrocredits: 10000}).Error; err != nil {
				t.Fatal(err)
			}
			o := model.BillingOrder{ID: "o", UserID: "u", IdempotencyKey: "k", Status: model.BillingStatusReserved, BillingMode: "fixed", AmountMicrocredits: 3000, MultiplierBasisPoints: 10000}
			if action == "audio" {
				o.BillingMode, o.Capability, o.UnitPriceMicrocredits = "per_second", "audio", 1000
			}
			if action == "token" {
				o.BillingMode, o.InputTokenPriceMicrocredits = "token", 1000000
			}
			if err := r.ReserveBillingOrder(&o); err != nil {
				t.Fatal(err)
			}
			check := func(want int64) {
				t.Helper()
				var a model.CreditAccount
				if err := db.First(&a, "user_id = ?", "u").Error; err != nil {
					t.Fatal(err)
				}
				if a.AvailableMicrocredits != want || a.ReservedMicrocredits != 0 {
					t.Fatalf("account = %+v, want available %d and no frozen credits", a, want)
				}
				var net int64
				if err := db.Model(&model.CreditLedgerEntry{}).Select("coalesce(sum(amount_microcredits),0)").Scan(&net).Error; err != nil {
					t.Fatal(err)
				}
				if net != want-10000 {
					t.Fatalf("ledger net %d does not match balance", net)
				}
			}
			check(7000)
			want := int64(7000)
			for range 2 {
				var err error
				switch action {
				case "failure":
					err = r.RefundBillingOrder(o.ID, "failed")
					want = 10000
				case "uncertain":
					err = r.MarkBillingUncertain(o.ID, "timeout")
					want = 10000
				case "audio":
					err = r.SettleBillingOrderWithAudioDuration(o.ID, "req", 1500)
					want = 8000
				case "token":
					if err = db.Where("id = ?", "usage").Assign(model.ApiCallLog{BillingOrderID: o.ID, Status: model.ApiCallStatusSucceeded, UsageAvailable: true, InputTokens: 1000}).FirstOrCreate(&model.ApiCallLog{ID: "usage"}).Error; err != nil {
						t.Fatal(err)
					}
					err = r.SettleBillingOrder(o.ID, "req")
					want = 9000
				default:
					err = r.SettleBillingOrder(o.ID, "req")
				}
				if err != nil {
					t.Fatal(err)
				}
				check(want)
			}
			if action == "failure" || action == "uncertain" {
				_ = r.SettleBillingOrder(o.ID, "late-callback")
				check(want)
			}
			duplicate := o
			if err := r.ReserveBillingOrder(&duplicate); err == nil {
				t.Fatal("duplicate debit accepted")
			}
			check(want)
		})
	}
}
