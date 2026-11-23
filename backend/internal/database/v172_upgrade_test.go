package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestV172UpgradePreservesProduction72LedgerAndRows(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:v172-production72-upgrade?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.ReferralCommission{}, &model.ReferralBinding{}, &model.ReferralProfile{}} {
		if err := db.Migrator().DropTable(table); err != nil {
			t.Fatal(err)
		}
	}
	for _, field := range []struct {
		model any
		name  string
	}{{&model.User{}, "IsPromoter"}, {&model.DramaEpisode{}, "SourceFormat"}, {&model.DramaSegment{}, "ReferenceCastIDsJSON"}} {
		if err := db.Migrator().DropColumn(field.model, field.name); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version > ?", 72).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO users (id, username, display_name, avatar_url, profile_name_edited) VALUES (?, ?, ?, ?, ?)", "existing-v172", "existing-v172", "Existing", "/existing-avatar.png", true).Error; err != nil {
		t.Fatal(err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, record := range before {
		var after schemaMigration
		if err := db.First(&after, record.Version).Error; err != nil || after != record {
			t.Fatalf("existing migration %d changed: %#v, %v", record.Version, after, err)
		}
	}
	var ledger72 schemaMigration
	if err := db.First(&ledger72, 72).Error; err != nil || ledger72.Name != "ecommerce_agent_runs" || ledger72.Checksum != "sha256:ecommerce-agent-runs-v72-20261027" {
		t.Fatalf("production v72 ledger changed: %#v, %v", ledger72, err)
	}
	var user model.User
	if err := db.First(&user, "id = ?", "existing-v172").Error; err != nil || user.IsPromoter || user.AvatarURL != "/existing-avatar.png" || !user.ProfileNameEdited {
		t.Fatalf("existing user changed: %#v, %v", user, err)
	}
	for _, table := range []any{&model.ReferralProfile{}, &model.ReferralBinding{}, &model.ReferralCommission{}, &model.EcommerceAgentRun{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table %T", table)
		}
	}
	if !db.Migrator().HasColumn(&model.DramaEpisode{}, "SourceFormat") || !db.Migrator().HasColumn(&model.DramaSegment{}, "ReferenceCastIDsJSON") {
		t.Fatal("missing upstream drama columns")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema not ready: %#v, %v", status, err)
	}
}
