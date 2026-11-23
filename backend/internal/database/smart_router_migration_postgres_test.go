package database

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestSmartRouterPostgres55To57AdditiveMigration(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
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
	schemaName := fmt.Sprintf("smart_route_migration_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = base.Exec(`DROP SCHEMA IF EXISTS "` + schemaName + `" CASCADE`).Error }()
	testDSN, err := postgresDSNWithSearchPath(dsn, schemaName)
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
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "preserved-task", UserID: "user", Status: model.TaskStatusFailed, Model: "original-model"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"DELETE FROM schema_migrations WHERE version = 57",
		"DELETE FROM schema_migrations WHERE version = 56",
		"ALTER TABLE route_attempts DROP COLUMN submission_key, DROP COLUMN outbound_started_at, DROP COLUMN request_correlation_id, DROP COLUMN reconciliation_state, DROP COLUMN reconciliation_checks, DROP COLUMN reconcile_next_at, DROP COLUMN reconcile_deadline_at, DROP COLUMN reconcile_last_checked_at, DROP COLUMN reconciliation_evidence, DROP COLUMN reconciled_by, DROP COLUMN reconciled_at",
		"DROP TABLE smart_route_policies",
		"ALTER TABLE tasks DROP COLUMN smart_route_active, DROP COLUMN selected_execution_model_id, DROP COLUMN actual_execution_model_id, DROP COLUMN compatible_model_fallback",
		"ALTER TABLE route_attempts DROP COLUMN http_status, DROP COLUMN accepted_at",
		"ALTER TABLE api_call_logs DROP COLUMN route_attempt_id",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare version 55 shape: %s: %v", statement, err)
		}
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade version 55 to 57: %v", err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("repeat version 57 migration: %v", err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", "preserved-task").Error; err != nil {
		t.Fatal(err)
	}
	if task.Model != "original-model" || task.Status != model.TaskStatusFailed {
		t.Fatalf("existing task changed during additive migration: %+v", task)
	}
	if !db.Migrator().HasTable(&model.SmartRoutePolicy{}) || !db.Migrator().HasColumn(&model.RouteAttempt{}, "accepted_at") || !db.Migrator().HasColumn(&model.ApiCallLog{}, "route_attempt_id") || !db.Migrator().HasColumn(&model.RouteAttempt{}, "submission_key") || !db.Migrator().HasColumn(&model.RouteAttempt{}, "outbound_started_at") || !db.Migrator().HasColumn(&model.RouteAttempt{}, "reconciliation_state") {
		t.Fatal("version 56/57 schema additions missing")
	}
}
