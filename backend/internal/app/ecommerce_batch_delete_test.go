package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestDeleteEcommerceBatch(t *testing.T) {
	for _, scenario := range []string{"completed", "running", "reconciling", "foreign", "stale", "rollback"} {
		t.Run(scenario, func(t *testing.T) {
			svc, db, _ := newResourceDeletionTestService(t)
			project := model.EcommerceProject{ID: "batch-project", UserID: "user-1", Revision: 3, DraftJSON: `{"references":[{"resourceId":"uploaded-resource"}]}`, PlanJSON: `{"productSummary":"原方案","images":[{"id":"current-image","taskId":"current-task"},{"id":"failed-image","taskId":"failed-task"}],"previousImages":[{"id":"old-image","taskId":"old-task","assetId":"old-asset"}]}`}
			status := model.TaskStatusSucceeded
			if scenario == "running" {
				status = model.TaskStatusRunning
			}
			if scenario == "reconciling" {
				status = model.TaskStatusReconciling
			}
			records := []any{&project,
				&model.Task{ID: "current-task", UserID: "user-1", Status: status, InputJSON: `{}`},
				&model.Task{ID: "failed-task", UserID: "user-1", Status: model.TaskStatusFailed, InputJSON: `{}`},
				&model.Task{ID: "old-task", UserID: "user-1", Status: model.TaskStatusSucceeded, InputJSON: `{}`},
				&model.Asset{ID: "current-asset", UserID: "user-1", PayloadJSON: `{"metadata":{"taskId":"current-task"},"data":{"storageKey":"resource:current-resource"}}`},
				&model.Resource{ID: "current-resource", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "unsupported-test-provider", ObjectKey: "current.png"},
				&model.Asset{ID: "old-asset", UserID: "user-1", PayloadJSON: `{"metadata":{"taskId":"old-task"}}`},
				&model.Resource{ID: "uploaded-resource", UserID: "user-1", Status: model.ResourceStatusReady},
			}
			for _, record := range records {
				if err := db.Create(record).Error; err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "rollback" {
				if err := db.Exec(`CREATE TRIGGER reject_batch_update BEFORE UPDATE ON ecommerce_projects BEGIN SELECT RAISE(ABORT, 'injected failure'); END`).Error; err != nil {
					t.Fatal(err)
				}
			}
			user, revision := "user-1", int64(3)
			if scenario == "foreign" {
				user = "user-2"
			}
			if scenario == "stale" {
				revision = 2
			}
			saved, ids, err := svc.DeleteEcommerceBatch(user, project.ID, revision)
			success := scenario == "completed"
			if (err == nil) != success {
				t.Fatalf("scenario=%s error=%v", scenario, err)
			}
			want := int64(1)
			if success {
				want = 0
				if len(ids) != 1 || ids[0] != "current-asset" {
					t.Fatalf("deleted assets=%v", ids)
				}
				var plan struct {
					Images         []json.RawMessage `json:"images"`
					PreviousImages []json.RawMessage `json:"previousImages"`
				}
				if json.Unmarshal([]byte(saved.PlanJSON), &plan) != nil || len(plan.Images) != 0 || len(plan.PreviousImages) != 1 || saved.Revision != 4 {
					t.Fatalf("saved project=%+v", saved)
				}
			}
			for _, check := range []struct {
				record any
				id     string
				count  int64
			}{
				{&model.Task{}, "current-task", want}, {&model.Task{}, "failed-task", want}, {&model.Asset{}, "current-asset", want}, {&model.Resource{}, "current-resource", want},
				{&model.Task{}, "old-task", 1}, {&model.Asset{}, "old-asset", 1}, {&model.Resource{}, "uploaded-resource", 1},
			} {
				var count int64
				if err := db.Model(check.record).Where("id = ?", check.id).Count(&count).Error; err != nil || count != check.count {
					t.Fatalf("%s count=%d want=%d error=%v", check.id, count, check.count, err)
				}
			}
			stored, err := svc.repo.EcommerceProject("user-1", project.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !success && stored.PlanJSON != project.PlanJSON {
				t.Fatal("failed deletion changed the plan")
			}
		})
	}
}
