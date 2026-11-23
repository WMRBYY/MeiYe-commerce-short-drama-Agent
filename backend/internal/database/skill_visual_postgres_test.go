package database

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPostgresSkillVisualMetadataPreservesLegacySkill(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQL.Close()
	schema := fmt.Sprintf("skill_visual_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	defer base.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`)
	testDSN, err := postgresDSNWithSearchPath(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer dbSQL.Close()
	if err := db.Exec(`CREATE TABLE skills (id text PRIMARY KEY, instruction text NOT NULL, current_version_id text NOT NULL)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO skills (id, instruction, current_version_id) VALUES ('original', 'keep this prompt', 'v1')`).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := migrateSkillVisualMetadata(db); err != nil {
			t.Fatal(err)
		}
	}
	var record struct {
		ID                 string
		Instruction        string
		CurrentVersionID   string
		DisplayCoverURL    string
		DisplayTagline     string
		DisplayCoverSource string
	}
	if err := db.Raw(`SELECT id, instruction, current_version_id, display_cover_url, display_tagline, display_cover_source FROM skills WHERE id = 'original'`).Scan(&record).Error; err != nil {
		t.Fatal(err)
	}
	if record.ID != "original" || record.Instruction != "keep this prompt" || record.CurrentVersionID != "v1" || record.DisplayCoverURL != "" || record.DisplayTagline != "" || record.DisplayCoverSource != "" {
		t.Fatalf("legacy skill changed: %+v", record)
	}
}
