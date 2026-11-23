package workbench

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestEnsureBuiltinCatalogPublishesImageAndVideoPresets(t *testing.T) {
	svc, db, _ := newWorkbenchTest(t)
	if err := svc.EnsureBuiltinCatalog(); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{KindImage, KindVideo} {
		tools, err := svc.PublicTools(kind)
		if err != nil {
			t.Fatal(err)
		}
		if len(tools) == 0 {
			t.Fatalf("no builtin %s tools", kind)
		}
		for _, tool := range tools {
			if len(tool.Presets) != 3 {
				t.Fatalf("tool %s has %d public presets, want 3", tool.ID, len(tool.Presets))
			}
			for _, preset := range tool.Presets {
				if preset.ToolID != tool.ID || preset.PromptTemplate == "" || !preset.Enabled {
					t.Fatalf("unusable public preset: %#v", preset)
				}
			}
		}
	}
	var count int64
	if err := db.Model(&model.WorkbenchTool{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 118 {
		t.Fatalf("tool count=%d, want 118", count)
	}
	var presetCount int64
	if err := db.Model(&model.WorkbenchPreset{}).Count(&presetCount).Error; err != nil {
		t.Fatal(err)
	}
	if presetCount != 354 {
		t.Fatalf("preset count=%d, want 354", presetCount)
	}
}

func TestEnsureBuiltinCatalogIsRepeatableAndPreservesAdminState(t *testing.T) {
	svc, db, _ := newWorkbenchTest(t)
	seedTools, seedPresets, err := builtinCatalog()
	if err != nil {
		t.Fatal(err)
	}
	editedTool := seedTools[0]
	editedTool.Name = "管理员自定义名称"
	editedTool.Enabled = false
	editedTool.Version = 9
	editedPreset := seedPresets[0]
	editedPreset.Name = "管理员自定义预设"
	editedPreset.PromptTemplate = "管理员自己的提示词"
	editedPreset.Enabled = false
	editedPreset.Version = 6
	customTool := seedTools[1]
	customTool.ID = "meiyeai-custom-workbench-tool"
	customTool.Name = "MeiYeAI 自定义工具"
	customTool.Version = 4
	customPreset := seedPresets[3]
	customPreset.ID = "meiyeai-custom-workbench-preset"
	customPreset.ToolID = customTool.ID
	customPreset.PromptTemplate = "MeiYeAI 自定义提示词"
	customPreset.Version = 3
	if err := db.Create(&editedTool).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&editedPreset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&customTool).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&customPreset).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinCatalog(); err != nil {
		t.Fatal(err)
	}
	var firstTools, firstPresets int64
	if err := db.Model(&model.WorkbenchTool{}).Count(&firstTools).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkbenchPreset{}).Count(&firstPresets).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinCatalog(); err != nil {
		t.Fatal(err)
	}
	var secondTools, secondPresets int64
	if err := db.Model(&model.WorkbenchTool{}).Count(&secondTools).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkbenchPreset{}).Count(&secondPresets).Error; err != nil {
		t.Fatal(err)
	}
	if firstTools != secondTools || firstPresets != secondPresets {
		t.Fatalf("repeat seed changed counts: tools %d/%d presets %d/%d", firstTools, secondTools, firstPresets, secondPresets)
	}
	if firstTools != 119 || firstPresets != 355 {
		t.Fatalf("seed lost custom records or duplicated builtins: tools=%d presets=%d", firstTools, firstPresets)
	}
	var gotTool model.WorkbenchTool
	if err := db.First(&gotTool, "id = ?", editedTool.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotTool.Name != editedTool.Name || gotTool.Enabled != editedTool.Enabled || gotTool.Version != editedTool.Version {
		t.Fatalf("admin tool changed: %#v", gotTool)
	}
	var gotPreset model.WorkbenchPreset
	if err := db.First(&gotPreset, "id = ?", editedPreset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotPreset.Name != editedPreset.Name || gotPreset.PromptTemplate != editedPreset.PromptTemplate || gotPreset.Enabled != editedPreset.Enabled || gotPreset.Version != editedPreset.Version {
		t.Fatalf("admin preset changed: %#v", gotPreset)
	}
	var gotCustomTool model.WorkbenchTool
	if err := db.First(&gotCustomTool, "id = ?", customTool.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotCustomTool.Name != customTool.Name || gotCustomTool.Version != customTool.Version {
		t.Fatalf("custom tool changed: %#v", gotCustomTool)
	}
	var gotCustomPreset model.WorkbenchPreset
	if err := db.First(&gotCustomPreset, "id = ?", customPreset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotCustomPreset.PromptTemplate != customPreset.PromptTemplate || gotCustomPreset.Version != customPreset.Version {
		t.Fatalf("custom preset changed: %#v", gotCustomPreset)
	}
}
