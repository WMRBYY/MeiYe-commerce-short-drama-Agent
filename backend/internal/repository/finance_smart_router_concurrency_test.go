package repository

import (
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

// A routed task retains one billing order while provider callbacks and workers
// may race to settle it. Exercise the actual PostgreSQL transaction boundary.
func TestSmartRouterConcurrentSettlementAndDuplicateCallbackPostgres(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
	}
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		t.Fatal(err)
	}
	closeTestDatabase(t, admin)
	schema := fmt.Sprintf("smart_router_billing_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error })
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), config)
	if err != nil {
		t.Fatal(err)
	}
	closeTestDatabase(t, db)
	if err := db.AutoMigrate(&model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	order := model.BillingOrder{ID: "one-task-one-order", TaskID: "user-task", UserID: "user", Status: model.BillingStatusRunning, BillingMode: "fixed_request", AmountMicrocredits: 100, ReservedAmountMicrocredits: 100, ChargeLimitSet: true, ChargeLimitMicrocredits: 100}
	if err := db.Create(&model.CreditAccount{UserID: "user", AvailableMicrocredits: 900, ReservedMicrocredits: 100}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	var workers sync.WaitGroup
	errors := make(chan error, 24)
	for i := 0; i < cap(errors); i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			errors <- repo.SettleBillingOrder(order.ID, "provider-job")
		}()
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent settlement: %v", err)
		}
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
		t.Fatal(err)
	}
	var entries []model.CreditLedgerEntry
	if err := db.Where("billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerConsume).Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 900 || account.ReservedMicrocredits != 0 || len(entries) != 1 || entries[0].AmountMicrocredits != -100 {
		t.Fatalf("duplicate settlement: account=%+v ledger=%+v", account, entries)
	}
	// A user may submit several independent generation tasks from one session.
	const simultaneousTasks = 12
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Updates(map[string]any{"available_microcredits": 780, "reserved_microcredits": simultaneousTasks * 10}).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < simultaneousTasks; i++ {
		item := model.BillingOrder{ID: fmt.Sprintf("parallel-order-%d", i), TaskID: fmt.Sprintf("parallel-task-%d", i), UserID: "user", IdempotencyKey: fmt.Sprintf("parallel-key-%d", i), Status: model.BillingStatusRunning, BillingMode: "fixed_request", AmountMicrocredits: 10, ReservedAmountMicrocredits: 10, ChargeLimitSet: true, ChargeLimitMicrocredits: 10}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	errors = make(chan error, simultaneousTasks)
	for i := 0; i < simultaneousTasks; i++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			errors <- repo.SettleBillingOrder(fmt.Sprintf("parallel-order-%d", index), fmt.Sprintf("provider-%d", index))
		}(i)
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("simultaneous task settlement: %v", err)
		}
	}
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
		t.Fatal(err)
	}
	var totalConsumes int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type = ?", "user", model.CreditLedgerConsume).Count(&totalConsumes).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 780 || account.ReservedMicrocredits != 0 || totalConsumes != 1+simultaneousTasks {
		t.Fatalf("parallel task charges: account=%+v ledger count=%d", account, totalConsumes)
	}
}
