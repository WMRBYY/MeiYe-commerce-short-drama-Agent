package main

import (
	"net/url"
	"os"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

// Run only with a freshly restored v53 production backup in the dedicated
// v1.6.8 test PostgreSQL container. The hostname/database guard prevents this
// audit from mutating a production or shared development database.
func TestV168SeedOnIsolatedProductionRestore(t *testing.T) {
	dsn := os.Getenv("MEIYEAI_V168_ISOLATED_DSN")
	if dsn == "" {
		t.Skip("isolated production backup DSN not provided")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || parsed.Hostname() != "meiyeai-v168-isolated-db" || parsed.Path != "/open_ai_canvas_v168" {
		t.Fatal("refusing seed audit outside the dedicated v1.6.8 restore")
	}
	db, err := database.Open(database.Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := database.RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	var before int64
	if err := db.Model(&model.WorkbenchTool{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before != 0 {
		t.Fatalf("expected fresh v53 restore with no workbench tools, found %d", before)
	}
	svc := service.New(repository.New(db), t.TempDir())
	defer svc.Close()
	if err := svc.EnsureBuiltinWorkbenchCatalog(); err != nil {
		t.Fatal(err)
	}
	var toolCount, presetCount int64
	if err := db.Model(&model.WorkbenchTool{}).Count(&toolCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkbenchPreset{}).Count(&presetCount).Error; err != nil {
		t.Fatal(err)
	}
	if toolCount != 118 || presetCount != 354 {
		t.Fatalf("builtin catalog incomplete: tools=%d presets=%d", toolCount, presetCount)
	}
	var edited model.WorkbenchTool
	if err := db.Order("id").First(&edited).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&edited).Updates(map[string]any{"name": "管理员保留名称", "enabled": false, "version": 9}).Error; err != nil {
		t.Fatal(err)
	}
	var editedPreset model.WorkbenchPreset
	if err := db.Where("tool_id = ?", edited.ID).Order("id").First(&editedPreset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&editedPreset).Updates(map[string]any{"prompt_template": "管理员保留提示词", "enabled": false, "version": 7}).Error; err != nil {
		t.Fatal(err)
	}
	custom := model.WorkbenchTool{ID: "v168-isolated-custom-tool", Kind: "image", Name: "MeiYeAI 自定义工具", Enabled: true, Version: 4}
	if err := db.Create(&custom).Error; err != nil {
		t.Fatal(err)
	}
	customPreset := model.WorkbenchPreset{ID: "v168-isolated-custom-preset", ToolID: custom.ID, Name: "自定义预设", PromptTemplate: "MeiYeAI 自定义提示词", Enabled: true, Version: 3}
	if err := db.Create(&customPreset).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinWorkbenchCatalog(); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkbenchTool{}).Count(&toolCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkbenchPreset{}).Count(&presetCount).Error; err != nil {
		t.Fatal(err)
	}
	if toolCount != 119 || presetCount != 355 {
		t.Fatalf("repeat seed changed catalog or custom records: tools=%d presets=%d", toolCount, presetCount)
	}
	var gotTool model.WorkbenchTool
	var gotPreset model.WorkbenchPreset
	var gotCustom model.WorkbenchTool
	if err := db.First(&gotTool, "id = ?", edited.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&gotPreset, "id = ?", editedPreset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&gotCustom, "id = ?", custom.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotTool.Name != "管理员保留名称" || gotTool.Enabled || gotTool.Version != 9 || gotPreset.PromptTemplate != "管理员保留提示词" || gotPreset.Enabled || gotPreset.Version != 7 || gotCustom.Version != 4 || gotCustom.Name != custom.Name {
		t.Fatal("repeat seed overwrote administrator state or a MeiYeAI custom tool")
	}
}
