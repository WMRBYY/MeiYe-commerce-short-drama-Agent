package database

import (
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
)

// The fixture is produced by the previous production binary's migration plan.
func TestV173UpgradeProduction75Fixture(t *testing.T) {
	fixture := os.Getenv("CANVAS_V173_SCHEMA75_FIXTURE")
	if fixture == "" {
		t.Skip("set CANVAS_V173_SCHEMA75_FIXTURE to the synthetic schema 75 database")
	}
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "production75.sqlite")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "sqlite", DSN: path})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || status.Current != 75 {
		t.Fatalf("fixture is not schema 75: %+v %v", status, err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, record := range before {
		var after schemaMigration
		if err := db.First(&after, record.Version).Error; err != nil || after != record {
			t.Fatalf("migration %d changed: %+v %v", record.Version, after, err)
		}
	}
	status, err = ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != 78 {
		t.Fatalf("schema not ready: %+v %v", status, err)
	}
	var user model.User
	if err := db.First(&user, "id = ?", "fixture-user").Error; err != nil || user.PasswordHash != "synthetic-hash" || user.AvatarURL != "/fixture.png" || user.UserGroup != "" {
		t.Fatalf("user changed: %+v %v", user, err)
	}
	var session model.AuthSession
	if err := db.First(&session, "id = ?", "fixture-session").Error; err != nil || session.TokenHash != "synthetic-session" {
		t.Fatalf("session changed: %+v %v", session, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "fixture-user").Error; err != nil || account.AvailableMicrocredits != 450000 || account.ReservedMicrocredits != 50000 {
		t.Fatalf("balance changed: %+v %v", account, err)
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "fixture-order").Error; err != nil || order.AmountMicrocredits != 50000 || order.Status != model.BillingStatusReserved {
		t.Fatalf("order changed: %+v %v", order, err)
	}
	var channelModel model.ChannelModel
	if err := db.First(&channelModel, "id = ?", "fixture-model").Error; err != nil || channelModel.PriceCurrency != "credits" || channelModel.UnitPriceMicrocredits != 50000 {
		t.Fatalf("model price changed: %+v %v", channelModel, err)
	}
	for _, table := range []any{&model.UserGroup{}, &model.UserGroupChannel{}, &model.AgentMemoryDocument{}, &model.AgentMemoryDocumentRevision{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table %T", table)
		}
	}
	if !db.Migrator().HasColumn(&model.DramaSegment{}, "ReferenceCastIDsJSON") {
		t.Fatal("production drama reference column missing")
	}
}

func TestV173UpgradePostgresProduction75Fixture(t *testing.T) {
	dsn := os.Getenv("CANVAS_V173_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("isolated fixture database not configured")
	}
	db, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	var name string
	if err := db.Raw("select current_database()").Scan(&name).Error; err != nil || name != "v173_upgrade_test" {
		t.Fatalf("unexpected database: %q %v", name, err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || status.Current != 75 {
		t.Fatalf("fixture is not schema 75: %+v %v", status, err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, record := range before {
		var after schemaMigration
		if err := db.First(&after, record.Version).Error; err != nil || after != record {
			t.Fatalf("migration %d changed: %+v %v", record.Version, after, err)
		}
	}
	status, err = ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != 78 {
		t.Fatalf("schema not ready: %+v %v", status, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "fixture-user").Error; err != nil || account.AvailableMicrocredits != 450000 || account.ReservedMicrocredits != 50000 {
		t.Fatalf("balance changed: %+v %v", account, err)
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "fixture-order").Error; err != nil || order.AmountMicrocredits != 50000 || order.Status != model.BillingStatusReserved {
		t.Fatalf("order changed: %+v %v", order, err)
	}
	var user model.User
	if err := db.First(&user, "id = ?", "fixture-user").Error; err != nil || user.PasswordHash != "synthetic-hash" || user.AvatarURL != "/fixture.png" || user.UserGroup != "" {
		t.Fatalf("user changed: %+v %v", user, err)
	}
	var session model.AuthSession
	if err := db.First(&session, "id = ?", "fixture-session").Error; err != nil || session.TokenHash != "synthetic-session" {
		t.Fatalf("session changed: %+v %v", session, err)
	}
	var channelModel model.ChannelModel
	if err := db.First(&channelModel, "id = ?", "fixture-model").Error; err != nil || channelModel.PriceCurrency != "credits" || channelModel.UnitPriceMicrocredits != 50000 {
		t.Fatalf("model price changed: %+v %v", channelModel, err)
	}
	for _, table := range []any{&model.UserGroup{}, &model.UserGroupChannel{}, &model.AgentMemoryDocument{}, &model.AgentMemoryDocumentRevision{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table %T", table)
		}
	}
	if !db.Migrator().HasColumn(&model.DramaSegment{}, "ReferenceCastIDsJSON") {
		t.Fatal("production drama reference column missing")
	}
}
