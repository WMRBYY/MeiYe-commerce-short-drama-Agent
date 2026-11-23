package repository

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestYoruQuotaEnforcesCallsAndDailyWorstCaseCost(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:yoru-quota?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.YoruDailyQuota{}); err != nil {
		t.Fatal(err)
	}
	repo := &Repository{db: db}
	now := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	for i := 0; i < 2; i++ {
		ok, err := repo.ReserveYoruQuota("user", now, 3, 200, 100)
		if err != nil || !ok {
			t.Fatalf("reserve %d: %v %v", i, ok, err)
		}
	}
	if ok, err := repo.ReserveYoruQuota("user", now, 3, 200, 100); err != nil || ok {
		t.Fatalf("daily cost exceeded: %v %v", ok, err)
	}
	if err := repo.ReleaseYoruQuota("user", now, 100); err != nil {
		t.Fatal(err)
	}
	if ok, err := repo.ReserveYoruQuota("user", now, 3, 200, 100); err != nil || !ok {
		t.Fatalf("released quota unavailable: %v %v", ok, err)
	}
	if ok, err := repo.ReserveYoruQuota("user", now, 3, 300, 100); err != nil || !ok {
		t.Fatalf("third call unavailable: %v %v", ok, err)
	}
	if ok, err := repo.ReserveYoruQuota("user", now, 3, 400, 100); err != nil || ok {
		t.Fatalf("call count exceeded: %v %v", ok, err)
	}
}
