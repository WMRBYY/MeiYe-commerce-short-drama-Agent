package repository

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func TestClaimDailyCreditsLedgerAndIdempotency(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	days := []string{"2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"}
	account, granted, err := repo.ClaimDailyCredits("daily-user", days, 200_000)
	if err != nil || granted != 1_400_000 || account.AvailableMicrocredits != 1_400_000 {
		t.Fatalf("claim account=%+v granted=%d err=%v", account, granted, err)
	}
	_, granted, err = repo.ClaimDailyCredits("daily-user", days, 200_000)
	if err != nil || granted != 0 {
		t.Fatalf("repeat granted=%d err=%v", granted, err)
	}
	pending, err := repo.UnclaimedDailyCreditDays("daily-user", days)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending=%v err=%v", pending, err)
	}
	var entries []model.CreditLedgerEntry
	if err := db.Where("user_id = ? AND type = ?", "daily-user", model.CreditLedgerCheckinBonus).Order("created_at, id").Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	if len(entries) != 7 {
		t.Fatalf("ledger entries=%d", len(entries))
	}
	var total int64
	for _, entry := range entries {
		if entry.AmountMicrocredits != 200_000 || entry.AvailableDeltaMicrocredits != 200_000 {
			t.Fatalf("incorrect ledger entry: %+v", entry)
		}
		total += entry.AvailableDeltaMicrocredits
	}
	if total != account.AvailableMicrocredits {
		t.Fatalf("ledger total=%d balance=%d", total, account.AvailableMicrocredits)
	}
}

func TestLegacyCheckinCannotBeClaimedAgainOnMigrationDay(t *testing.T) {
	db := openPaymentTestDB(t)
	userID := "legacy-user"
	day := "2026-10-13"
	legacyRef := "checkin:" + userID + ":2026-10-12"
	claimedAt := time.Date(2026, 10, 12, 16, 30, 0, 0, time.UTC) // Beijing 00:30 on the 13th.
	if err := db.Create(&model.CreditAccount{UserID: userID, AvailableMicrocredits: 200_000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditLedgerEntry{ID: "legacy-entry", UserID: userID, Type: model.CreditLedgerCheckinBonus,
		AmountMicrocredits: 200_000, AvailableDeltaMicrocredits: 200_000, ReferenceKey: &legacyRef, CreatedAt: claimedAt}).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	pending, err := repo.UnclaimedDailyCreditDays(userID, []string{day})
	if err != nil || len(pending) != 0 {
		t.Fatalf("legacy checkin still pending: %v err=%v", pending, err)
	}
	account, granted, err := repo.ClaimDailyCredits(userID, []string{day}, 200_000)
	if err != nil || granted != 0 || account.AvailableMicrocredits != 200_000 {
		t.Fatalf("legacy checkin credited twice: account=%+v granted=%d err=%v", account, granted, err)
	}
}

func TestClaimDailyCreditsPostgresConcurrentLedger(t *testing.T) {
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
	schema := fmt.Sprintf("daily_credit_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	})
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
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	var wg sync.WaitGroup
	errors := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := repo.ClaimDailyCredits("postgres-user", []string{"2026-10-13"}, 200_000)
			errors <- err
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent claim: %v", err)
		}
	}
	account, granted, err := repo.ClaimDailyCredits("postgres-user", []string{"2026-10-13", "2026-10-14"}, 200_000)
	if err != nil || granted != 200_000 || account.AvailableMicrocredits != 400_000 {
		t.Fatalf("second day: account=%+v granted=%d err=%v", account, granted, err)
	}
	var entries []model.CreditLedgerEntry
	if err := db.Where("user_id = ? AND type = ?", "postgres-user", model.CreditLedgerCheckinBonus).Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	var total int64
	for _, entry := range entries {
		total += entry.AvailableDeltaMicrocredits
	}
	if len(entries) != 2 || total != account.AvailableMicrocredits {
		t.Fatalf("postgres ledger entries=%d total=%d balance=%d", len(entries), total, account.AvailableMicrocredits)
	}
}

func TestClaimDailyCreditsOverflowRollsBackLedger(t *testing.T) {
	db := openPaymentTestDB(t)
	if err := db.Create(&model.CreditAccount{UserID: "overflow-user", AvailableMicrocredits: maxPaymentCreditBalance - 100_000}).Error; err != nil {
		t.Fatal(err)
	}
	_, granted, err := New(db).ClaimDailyCredits("overflow-user", []string{"2026-10-13"}, 200_000)
	if !errors.Is(err, ErrPaymentCreditOverflow) || granted != 0 {
		t.Fatalf("overflow granted=%d err=%v", granted, err)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", "overflow-user").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("overflow left %d ledger entries", count)
	}
}

func TestClaimDailyCreditsSurvivesDatabaseReopen(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "daily-credit.db")
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if _, granted, err := New(db).ClaimDailyCredits("restart-user", []string{"2026-10-13"}, 200_000); err != nil || granted != 200_000 {
		t.Fatalf("first claim: granted=%d err=%v", granted, err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	reopenedConn, err := reopened.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopenedConn.Close() })
	account, granted, err := New(reopened).ClaimDailyCredits("restart-user", []string{"2026-10-13", "2026-10-14"}, 200_000)
	if err != nil || granted != 200_000 || account.AvailableMicrocredits != 400_000 {
		t.Fatalf("after restart: account=%+v granted=%d err=%v", account, granted, err)
	}
}

func TestClaimDailyCreditsConcurrentUniqueLedger(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	days := []string{"2026-10-13"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _ = repo.ClaimDailyCredits("race-user", days, 200_000)
		}()
	}
	wg.Wait()
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "race-user").Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type = ?", "race-user", model.CreditLedgerCheckinBonus).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 || account.AvailableMicrocredits != 200_000 {
		t.Fatalf("concurrent result: ledger=%d balance=%d", count, account.AvailableMicrocredits)
	}
}
