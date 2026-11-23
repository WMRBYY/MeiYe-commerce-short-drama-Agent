package app

import (
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDailyCreditDaysBeijingBoundaryAndActivation(t *testing.T) {
	migrated := time.Date(2026, 10, 12, 15, 59, 0, 0, time.UTC) // 23:59 Beijing
	before, next := dailyCreditDays(time.Date(2026, 10, 12, 15, 58, 59, 0, time.UTC), migrated, time.Time{})
	if len(before) != 0 || next.Format(time.RFC3339) != "2026-10-13T00:00:00+08:00" {
		t.Fatalf("before activation: days=%v next=%s", before, next.Format(time.RFC3339))
	}
	atActivation, _ := dailyCreditDays(migrated, migrated, time.Time{})
	if len(atActivation) != 1 || atActivation[0] != "2026-10-12" {
		t.Fatalf("at activation: %v", atActivation)
	}
	after, _ := dailyCreditDays(time.Date(2026, 10, 12, 16, 0, 0, 0, time.UTC), migrated, time.Time{})
	if len(after) != 1 || after[0] != "2026-10-13" {
		t.Fatalf("at Beijing midnight: %v", after)
	}
	week, _ := dailyCreditDays(time.Date(2026, 10, 19, 16, 0, 0, 0, time.UTC), migrated, time.Time{})
	if len(week) != 1 || week[0] != "2026-10-20" {
		t.Fatalf("previous days should expire at midnight: %v", week)
	}
	registered := time.Date(2026, 10, 16, 3, 0, 0, 0, time.UTC)
	newUser, _ := dailyCreditDays(time.Date(2026, 10, 17, 16, 0, 0, 0, time.UTC), migrated, registered)
	if len(newUser) != 1 || newUser[0] != "2026-10-18" {
		t.Fatalf("new user received pre-registration days: %v", newUser)
	}
	late, _ := dailyCreditDays(time.Date(2027, 3, 1, 16, 0, 0, 0, time.UTC), migrated, time.Time{})
	if len(late) != 1 || late[0] != "2027-03-02" {
		t.Fatalf("long absence and month boundary: %v", late)
	}
}

func TestDailyCreditsControlledClockAndHistoricalPolicy(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "credits.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME NOT NULL)").Error; err != nil {
		t.Fatal(err)
	}
	migrated := time.Date(2026, 10, 12, 8, 0, 0, 0, beijingTime)
	if err := db.Exec("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", 50, migrated).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: creditPolicySettingKey, ValueJSON: `{"signupBonusMicrocredits":100000000,"checkinBonusMicrocredits":1000000,"defaultMultiplierBasisPoints":10000}`}).Error; err != nil {
		t.Fatal(err)
	}
	registered := time.Date(2026, 10, 13, 9, 0, 0, 0, beijingTime)
	first := &model.User{ID: "first", Username: "first", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: registered}
	late := &model.User{ID: "late", Username: "late", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: registered}
	for _, user := range []*model.User{first, late} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	now := registered.Add(time.Minute)
	svc.creditClock = func() time.Time { return now }
	policy, err := svc.creditPolicy()
	if err != nil || policy.SignupBonusMicrocredits != 0 || policy.CheckinBonusMicrocredits != dailyCreditMicrocredits {
		t.Fatalf("effective policy=%+v err=%v", policy, err)
	}
	if _, err := svc.UpdateCreditPolicy(&model.User{ID: "admin", Role: model.UserRoleAdmin}, CreditPolicy{SignupBonusMicrocredits: CreditScale, DefaultMultiplierBPS: 10_000}); err == nil {
		t.Fatal("administrator could restore signup bonus")
	}
	pending, err := svc.publicCreditPolicy(first)
	if err != nil || pending.PendingMicrocredits != 200_000 {
		t.Fatalf("first day pending=%+v err=%v", pending, err)
	}
	account, err := svc.repo.CreditAccount(first.ID)
	if err != nil || account.AvailableMicrocredits != 0 {
		t.Fatalf("unclaimed balance=%+v err=%v", account, err)
	}
	account, claimed, err := svc.CheckinCredits(first)
	if err != nil || !claimed || account.AvailableMicrocredits != 200_000 {
		t.Fatalf("first claim=%+v claimed=%v err=%v", account, claimed, err)
	}
	pending, err = svc.publicCreditPolicy(first)
	if err != nil || pending.PendingMicrocredits != 0 || !pending.CheckedInToday {
		t.Fatalf("refresh=%+v err=%v", pending, err)
	}
	now = time.Date(2026, 10, 19, 12, 0, 0, 0, beijingTime)
	pending, err = svc.publicCreditPolicy(late)
	if err != nil || pending.PendingMicrocredits != 200_000 {
		t.Fatalf("only today's credit is claimable=%+v err=%v", pending, err)
	}
	now = now.AddDate(0, 0, 1)
	pending, err = svc.publicCreditPolicy(late)
	if err != nil || pending.PendingMicrocredits != 200_000 || pending.OldestExpiresAt == nil || pending.OldestExpiresAt.Format("2006-01-02") != "2026-10-21" {
		t.Fatalf("today's credit expires next midnight=%+v err=%v", pending, err)
	}
	account, err = svc.repo.CreditAccount(first.ID)
	if err != nil || account.AvailableMicrocredits != 200_000 {
		t.Fatalf("claimed credits expired: %+v err=%v", account, err)
	}
	account, claimed, err = svc.CheckinCredits(late)
	if err != nil || !claimed || account.AvailableMicrocredits != 200_000 {
		t.Fatalf("today-only claim=%+v claimed=%v err=%v", account, claimed, err)
	}
	account, claimed, err = svc.CheckinCredits(late)
	if err != nil || claimed || account.AvailableMicrocredits != 200_000 {
		t.Fatalf("repeat claim=%+v claimed=%v err=%v", account, claimed, err)
	}
	var entries int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", late.ID).Count(&entries).Error; err != nil || entries != 1 {
		t.Fatalf("late ledger entries=%d err=%v", entries, err)
	}
}
