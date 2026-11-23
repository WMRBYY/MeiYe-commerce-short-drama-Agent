package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"
)

func TestShopClipSchemaMigration107(t *testing.T) {
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: filepath.Join(t.TempDir(), "clips.db")}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { sqlDB, _ := db.DB(); _ = sqlDB.Close() }()
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.ShopClipProject{}, &model.ShopClipResource{}, &model.ShopClipAttempt{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing clip table %T", table)
		}
	}
	p := model.ShopClipProject{ID: "clip", UserID: "user", RequestKey: "request", RequestHash: "hash", Status: "ready", PlanJSON: `{"version":1}`}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var got model.ShopClipProject
	if err := db.First(&got, "id = ?", p.ID).Error; err != nil || got.PlanJSON != p.PlanJSON {
		t.Fatalf("migration lost plan: %+v %v", got, err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}
