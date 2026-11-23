// One-off maintenance tool: create workbench generation tasks for an existing user from a JSON spec,
// through the normal Service.CreateWorkbenchTask path (admission, billing reservation, provider routing).
// It never starts generation workers; the running backend's dispatcher picks the queued tasks up.
// Used for controlled A/B comparisons (same references, different prompts / models).
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"

	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

type specItem struct {
	Label string                     `json:"label"`
	Input service.WorkbenchTaskInput `json:"input"`
}

func main() {
	userID := flag.String("user", "", "existing user ID that owns and pays for the tasks")
	specPath := flag.String("spec", "", "JSON file: [{\"label\":\"A\",\"input\":{...workbench task input...}}]")
	flag.Parse()
	if *userID == "" || *specPath == "" {
		log.Fatal("-user and -spec are required")
	}
	if os.Getenv("DATABASE_URL") == "" && os.Getenv("CANVAS_BACKEND_DATA_DIR") == "" {
		log.Fatal("explicit database location required")
	}
	raw, err := os.ReadFile(*specPath)
	if err != nil {
		log.Fatal(err)
	}
	var items []specItem
	if err := json.Unmarshal(raw, &items); err != nil {
		log.Fatal(err)
	}
	if len(items) == 0 || len(items) > 4 {
		log.Fatal("spec must contain 1-4 tasks")
	}
	driver := os.Getenv("CANVAS_DATABASE_DRIVER")
	if driver == "" {
		driver = "sqlite"
	}
	dir := os.Getenv("CANVAS_BACKEND_DATA_DIR")
	db, err := database.Open(database.Config{Driver: driver, DSN: os.Getenv("DATABASE_URL"), DataDir: dir})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.RequireSchemaVersion(db); err != nil {
		log.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()
	repo := repository.New(db)
	if _, err := repo.User(*userID); err != nil {
		log.Fatalf("user not found: %v", err)
	}
	svc := service.New(repo, dir)
	defer svc.Close()
	out := json.NewEncoder(os.Stdout)
	for _, item := range items {
		task, err := svc.CreateWorkbenchTask(*userID, item.Input, "ab-test", "")
		if err != nil {
			_ = out.Encode(map[string]any{"label": item.Label, "error": err.Error()})
			continue
		}
		_ = out.Encode(map[string]any{"label": item.Label, "taskId": task.ID, "status": task.Status, "promptChars": len([]rune(item.Input.Prompt))})
	}
}
