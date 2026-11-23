package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/workbench"
)

func TestEcommerceBatchExecutionContinuesOfflineWithAnchor(t *testing.T) {
	s, db, detail := executionFixture(t)
	image := detail.Image
	image.Prompt = "商品图片"
	image.Batch = &workbench.TaskBatch{ID: "tryon_multi-model_abc1234567", Index: 0, Count: 2}
	second := image
	second.Batch = &workbench.TaskBatch{ID: image.Batch.ID, Index: 1, Count: 2}
	req := EcommerceBatchExecutionRequest{ID: image.Batch.ID, Kind: "tryon", Title: "换装测试", ClientState: json.RawMessage(`{"source":{"fn":"multi-model"}}`), Jobs: []EcommerceBatchJobRequest{{Key: "lead", Request: image}, {Key: "follow", Request: second, DependsOn: "lead", AnchorAt: "first"}}}
	p, err := s.StartEcommerceBatchExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	p = executionAdvance(t, s, p.ID)
	first := executionDraft(t, p).Execution.Jobs[0].TaskID
	if first == "" {
		t.Fatalf("no lead: %s", p.DraftJSON)
	}
	p = executionAdvance(t, s, p.ID)
	if executionDraft(t, p).Execution.Jobs[1].TaskID != "" {
		t.Fatal("follow submitted before anchor")
	}
	if err := db.Create(&model.Resource{ID: "anchor", UserID: "user", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("id = ?", first).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"images":[{"storageKey":"resource:anchor"}]}`})
	restarted := &Service{repo: repository.New(db), dataDir: s.dataDir}
	p = executionAdvance(t, restarted, p.ID)
	follow := executionDraft(t, p).Execution.Jobs[1].TaskID
	if follow == "" {
		t.Fatalf("no follow after restart: %s", p.DraftJSON)
	}
	task, err := s.repo.Task(follow)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		ReferenceImages []struct {
			StorageKey string `json:"storageKey"`
		} `json:"referenceImages"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || len(input.ReferenceImages) != 1 || input.ReferenceImages[0].StorageKey != "resource:anchor" {
		t.Fatalf("anchor lost: %s %v", task.InputJSON, err)
	}
	duplicate, err := s.StartEcommerceBatchExecution("user", req)
	if err != nil || duplicate.ID != p.ID {
		t.Fatalf("duplicate: %v", err)
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 2 {
		t.Fatalf("duplicate tasks: %d", count)
	}
}

func TestEcommerceBatchExecutionUsesConfiguredAnalysis(t *testing.T) {
	s, db, detail := executionFixture(t)
	image := detail.Image
	image.Prompt = "【本张拍摄】旧场景"
	image.Batch = &workbench.TaskBatch{ID: "tryon_outfit_abc1234567", Index: 0, Count: 1}
	planning := creationTextRequest()
	planning.Input["metadata"] = map[string]any{"tryonFunction": "outfit"}
	req := EcommerceBatchExecutionRequest{ID: image.Batch.ID, Kind: "tryon", Title: "分析测试", ClientState: json.RawMessage(`{"source":{"fn":"outfit"}}`), Planning: &planning, Jobs: []EcommerceBatchJobRequest{{Key: "image", Request: image}}}
	p, err := s.StartEcommerceBatchExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	p = executionAdvance(t, s, p.ID)
	run := executionDraft(t, p).Execution
	if run.PlanningTaskID == "" {
		t.Fatalf("analysis missing: %s", p.DraftJSON)
	}
	result, _ := json.Marshal(map[string]any{"text": `{"shots":[{"scene":"窗边","pose":"自然站立","camera":"平视","lighting":"自然光"}]}`})
	db.Model(&model.Task{}).Where("id = ?", run.PlanningTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)})
	p = executionAdvance(t, s, p.ID)
	p = executionAdvance(t, s, p.ID)
	if executionDraft(t, p).Execution.Jobs[0].TaskID == "" {
		t.Fatalf("analysis did not continue: %s", p.DraftJSON)
	}
}

func TestTaskSubmissionReceiptSurvivesCompletionAndRejectsChangedIntent(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	req := creationTextRequest()
	req.ClientSubmissionID = "stable-client-submission"
	first, err := s.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.Task(first.ID)
	db.Model(&model.Task{}).Where("id = ?", first.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "input_json": publicTaskInputJSON(stored.InputJSON)})
	second, err := s.CreateTask("user", req)
	if err != nil || second.ID != first.ID {
		t.Fatalf("lost terminal receipt: %v", err)
	}
	req.Prompt = "changed"
	if _, err = s.CreateTask("user", req); err == nil {
		t.Fatal("changed request accepted")
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 1 {
		t.Fatal("duplicate billed task")
	}
}
