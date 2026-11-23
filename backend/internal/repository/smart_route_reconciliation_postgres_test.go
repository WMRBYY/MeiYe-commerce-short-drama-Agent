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

func TestSmartRouteReconciliationConcurrentRefundPostgres(t *testing.T) {
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
	schema := fmt.Sprintf("router_reconciliation_%d", time.Now().UnixNano())
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
	if err := db.AutoMigrate(&model.Task{}, &model.RouteAttempt{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := db.Create(&model.CreditAccount{UserID: "gray-user", AvailableMicrocredits: 800, ReservedMicrocredits: 200}).Error; err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		id := fmt.Sprintf("task-%d", i)
		bill := fmt.Sprintf("bill-%d", i)
		attempt := fmt.Sprintf("attempt-%d", i)
		for _, value := range []any{
			&model.Task{ID: id, UserID: "gray-user", BillingOrderID: bill, Status: model.TaskStatusReconciling, SmartRouteActive: true, RouteRun: 1, CreatedAt: now},
			&model.RouteAttempt{ID: attempt, TaskID: id, RouteRun: 1, AttemptNumber: 1, Status: "reconciling", DispatchState: "submission_unknown", SubmissionKey: "key-" + id, ReconciliationState: "manual_required", StartedAt: now},
			&model.BillingOrder{ID: bill, TaskID: id, UserID: "gray-user", IdempotencyKey: "reserve-" + id, Status: model.BillingStatusUncertain, BillingMode: "fixed_request", AmountMicrocredits: 100, ReservedAmountMicrocredits: 100, ChargeLimitSet: true, ChargeLimitMicrocredits: 100},
		} {
			if err := db.Create(value).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	repo := New(db)
	var workers sync.WaitGroup
	errors := make(chan error, 24)
	for i := 0; i < 24; i++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			n := index%2 + 1
			errors <- repo.ResolveSmartRouteReconciliationRefund(fmt.Sprintf("task-%d", n), fmt.Sprintf("attempt-%d", n), "reviewer", "上游账单和任务记录确认失败")
		}(i)
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("parallel review: %v", err)
		}
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "gray-user").Error; err != nil {
		t.Fatal(err)
	}
	var refunds int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type = ?", "gray-user", model.CreditLedgerRefund).Count(&refunds).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 0 || refunds != 2 {
		t.Fatalf("duplicate or cross-task refund: account=%+v refund rows=%d", account, refunds)
	}
	for i := 1; i <= 2; i++ {
		var task model.Task
		if err := db.First(&task, "id = ?", fmt.Sprintf("task-%d", i)).Error; err != nil || task.Status != model.TaskStatusFailed {
			t.Fatalf("task %d status=%+v err=%v", i, task, err)
		}
	}
}
