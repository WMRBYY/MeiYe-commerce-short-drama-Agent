package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"yingce/backend/internal/app"
	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
)

func main() {
	action := flag.String("action", "inspect", "inspect, migrate or rollback")
	resourceID := flag.String("resource-id", "", "one resource ID")
	userID := flag.String("user-id", "", "resource owner ID")
	backupDir := flag.String("backup-dir", "", "independent backup directory")
	manifestPath := flag.String("manifest", "", "one-resource JSON manifest")
	apply := flag.Bool("apply", false, "required for migrate and rollback")
	flag.Parse()
	if strings.TrimSpace(os.Getenv("CANVAS_BACKEND_DATA_DIR")) == "" || strings.TrimSpace(os.Getenv("CANVAS_DATABASE_DRIVER")) == "" {
		fatal(errors.New("必须显式指定 CANVAS_BACKEND_DATA_DIR 和 CANVAS_DATABASE_DRIVER"))
	}
	if strings.EqualFold(os.Getenv("CANVAS_DATABASE_DRIVER"), "postgres") && strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		fatal(errors.New("PostgreSQL 模式必须显式指定 DATABASE_URL"))
	}
	if *resourceID == "" || *userID == "" {
		fatal(errors.New("必须指定单个 --resource-id 和 --user-id"))
	}
	if *action != "inspect" && !*apply {
		fatal(errors.New("迁移和回滚必须显式指定 --apply"))
	}
	if *action != "inspect" && *manifestPath == "" {
		fatal(errors.New("迁移和回滚必须指定 --manifest"))
	}
	db, err := database.Open(database.Config{Driver: os.Getenv("CANVAS_DATABASE_DRIVER"), DSN: os.Getenv("DATABASE_URL"), DataDir: os.Getenv("CANVAS_BACKEND_DATA_DIR")})
	if err != nil {
		fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		fatal(err)
	}
	defer conn.Close()
	if err := database.RequireSchemaVersion(db); err != nil {
		fatal(err)
	}
	svc := app.New(repository.New(db), os.Getenv("CANVAS_BACKEND_DATA_DIR"))
	var entry *app.LocalResourceMigration
	switch *action {
	case "inspect":
		entry, err = svc.InspectLocalResourceForPrivateOSS(*userID, *resourceID)
	case "migrate":
		if *backupDir == "" {
			fatal(errors.New("迁移必须指定独立 --backup-dir"))
		}
		entry, err = svc.MigrateLocalResourceToPrivateOSS(*userID, *resourceID, *backupDir, *manifestPath)
	case "rollback":
		encoded, readErr := os.ReadFile(*manifestPath)
		if readErr != nil {
			fatal(readErr)
		}
		entry = &app.LocalResourceMigration{}
		if jsonErr := json.Unmarshal(encoded, entry); jsonErr != nil {
			fatal(jsonErr)
		}
		if entry.ResourceID != *resourceID || entry.UserID != *userID {
			fatal(errors.New("清单与指定资源或所有者不匹配"))
		}
		err = svc.RollbackPrivateOSSMigration(*entry)
		if err == nil {
			entry.State = "rolled_back"
			err = app.SaveLocalResourceMigrationManifest(*manifestPath, *entry)
		}
	default:
		fatal(errors.New("无效 action"))
	}
	if err != nil {
		fatal(err)
	}
	encoded, err := json.Marshal(entry)
	if err != nil {
		fatal(err)
	}
	fmt.Println(string(encoded))
}

func fatal(err error) {
	// Driver/OSS errors can embed URLs or credentials. The CLI emits only the
	// operation status; detailed diagnostics stay with the operator locally.
	fmt.Fprintln(os.Stderr, "operation failed (see local diagnostics; no credentials printed)")
	_ = err
	os.Exit(1)
}
