package canvas

import (
	"encoding/json"
	"os"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Run only against an isolated restore of the production backup. The outer
// transaction is rolled back, including the test restore and its new snapshot.
func TestIsolatedProductionCanvasHistoryRestore(t *testing.T) {
	dsn := os.Getenv("MEIYEAI_ISOLATED_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires an isolated restored production database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	var snapshot model.CanvasSnapshot
	if err := tx.Order("created_at desc").First(&snapshot).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(tx), nil)
	project, err := svc.scopedCanvasHistoryProject(snapshot.UserID, snapshot.CanvasID)
	if err != nil {
		t.Fatal(err)
	}
	before, err := svc.CanvasHistory(snapshot.UserID, snapshot.CanvasID)
	if err != nil || len(before.Snapshots) == 0 {
		t.Fatalf("existing production history unavailable: %v", err)
	}
	selected := before.Snapshots[0]
	preview, err := svc.CanvasHistorySnapshot(snapshot.UserID, snapshot.CanvasID, selected.ID)
	if err != nil || !json.Valid([]byte(preview.PayloadJSON)) {
		t.Fatalf("existing production history payload invalid: %v", err)
	}
	restored, err := svc.RestoreCanvasHistory(snapshot.UserID, snapshot.CanvasID, selected.ID, &project.Revision)
	if err != nil || restored.Revision != project.Revision+1 {
		t.Fatalf("historical restore failed: revision=%d err=%v", restored.Revision, err)
	}
	after, err := svc.CanvasHistory(snapshot.UserID, snapshot.CanvasID)
	if err != nil || after.CurrentRevision != restored.Revision {
		t.Fatalf("historical restore not persisted in transaction: %v", err)
	}
	rawRestored, err := svc.UserCanvasProject(snapshot.UserID, snapshot.CanvasID)
	if err != nil {
		t.Fatal(err)
	}
	var restoredProject map[string]json.RawMessage
	if err := json.Unmarshal(rawRestored, &restoredProject); err != nil {
		t.Fatal(err)
	}
	var oldProject map[string]json.RawMessage
	if err := json.Unmarshal([]byte(preview.PayloadJSON), &oldProject); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"nodes", "connections"} {
		if string(restoredProject[field]) != string(oldProject[field]) {
			t.Errorf("restored %s differs from historical content", field)
		}
	}
}
