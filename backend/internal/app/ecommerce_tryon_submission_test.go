package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

func TestEcommerceTryOnNewFunctionsSubmitAndReplay(t *testing.T) {
	for _, fn := range []string{"fine-outfit", "background", "scene", "enhance"} {
		t.Run(fn, func(t *testing.T) {
			s, db, detail := executionFixture(t)
			image := detail.Image
			image.Prompt = "preserve subject and reference details"
			image.Batch = &workbench.TaskBatch{ID: "tryon_" + fn + "_regression123", Index: 0, Count: 1}
			for _, id := range []string{"subject", "reference"} {
				if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
					t.Fatal(err)
				}
				image.References = append(image.References, workbench.TaskReference{ResourceID: id, Kind: "image", Role: "reference"})
			}
			state, _ := json.Marshal(map[string]any{"source": map[string]any{"fn": fn}})
			req := EcommerceBatchExecutionRequest{ID: image.Batch.ID, Kind: "tryon", ClientState: state}
			if _, err := s.StartEcommerceBatchExecution("user", req); err == nil {
				t.Fatal("empty batch accepted")
			}
			var count int64
			db.Model(&model.BillingOrder{}).Count(&count)
			if count != 0 {
				t.Fatalf("empty batch charged: %d", count)
			}
			req.Jobs = []EcommerceBatchJobRequest{{Key: "image-0", Request: image}}
			project, err := s.StartEcommerceBatchExecution("user", req)
			if err != nil {
				t.Fatal(err)
			}
			project = executionAdvance(t, s, project.ID)
			job := executionDraft(t, project).Execution.Jobs[0]
			if job.TaskID == "" {
				t.Fatal("accepted batch did not create an image task")
			}
			task, err := s.repo.Task(job.TaskID)
			if err != nil {
				t.Fatal(err)
			}
			var input struct {
				ReferenceImages []struct {
					StorageKey string `json:"storageKey"`
				} `json:"referenceImages"`
			}
			if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || len(input.ReferenceImages) != 2 || input.ReferenceImages[0].StorageKey != "resource:subject" || input.ReferenceImages[1].StorageKey != "resource:reference" {
				t.Fatalf("references lost: %s (%v)", task.InputJSON, err)
			}
			replay, err := s.StartEcommerceBatchExecution("user", req)
			if err != nil || replay.ID != project.ID {
				t.Fatalf("replay changed project: %v", err)
			}
			db.Model(&model.Task{}).Count(&count)
			if count != 1 {
				t.Fatalf("replay task count: %d", count)
			}
			db.Model(&model.BillingOrder{}).Count(&count)
			if count != 1 {
				t.Fatalf("replay billing count: %d", count)
			}
		})
	}
}
