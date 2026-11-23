package repository

import (
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestDirectDebitConcurrentRefundPostgres(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("direct_debit_%d", time.Now().UnixNano())
	if err = db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec("DROP SCHEMA " + schema + " CASCADE") })
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err = gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	r := New(db)
	if err = db.Create(&model.CreditAccount{UserID: "u", AvailableMicrocredits: 10000}).Error; err != nil {
		t.Fatal(err)
	}
	o := model.BillingOrder{ID: "o", UserID: "u", IdempotencyKey: "k", Status: model.BillingStatusReserved, AmountMicrocredits: 3000}
	if err = r.ReserveBillingOrder(&o); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 24)
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- r.MarkBillingUncertain(o.ID, "timeout") }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var a model.CreditAccount
	db.First(&a, "user_id = ?", "u")
	var count int64
	db.Model(&model.CreditLedgerEntry{}).Where("type = ?", model.CreditLedgerRefund).Count(&count)
	if a.AvailableMicrocredits != 10000 || a.ReservedMicrocredits != 0 || count != 1 {
		t.Fatalf("account %+v refunds %d", a, count)
	}
}
