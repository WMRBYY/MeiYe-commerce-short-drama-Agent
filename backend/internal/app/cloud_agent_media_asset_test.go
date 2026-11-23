package app

import (
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCloudAgentCompletionRegistersMissingGeneratedAsset(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	resource := model.Resource{ID: newID(), UserID: task.UserID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "generated", MimeType: "image/png", Size: 80, Width: 2, Height: 3}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	result, _ := json.Marshal(map[string]any{"images": []any{map[string]any{"storageKey": "resource:" + resource.ID, "dataUrl": resourceFileURL(resource.ID)}}})
	task.ProjectID, task.Status, task.ResultJSON = "image-canvas", model.TaskStatusSucceeded, string(result)
	if err := db.Save(task).Error; err != nil {
		t.Fatal(err)
	}
	doc := map[string]any{"id": task.ProjectID, "title": "画布", "revision": 1, "createdAt": time.Now(), "updatedAt": time.Now(), "nodes": []any{map[string]any{"id": "image-node", "type": "image", "title": "图片", "position": map[string]int{"x": 0, "y": 0}, "width": 320, "height": 240, "metadata": map[string]any{"taskId": task.ID, "status": "loading"}}}, "connections": []any{}, "chatSessions": []any{}, "activeChatId": nil, "viewport": map[string]int{"x": 0, "y": 0, "k": 1}, "directorScenes": []any{}}
	raw, _ := json.Marshal(doc)
	canvas := model.CanvasProject{ID: task.ProjectID, UserID: task.UserID, Title: "画布", PayloadJSON: string(raw)}
	if err := s.repo.UpsertCanvasProject(&canvas); err != nil {
		t.Fatal(err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := completeCloudAgentMediaNode(s.repo, task.UserID, canvas.ID, "image-node", task, policy); err != nil {
			t.Fatal(err)
		}
	}
	assets, err := s.repo.Assets(task.UserID)
	if err != nil || len(assets) != 1 || assets[0].ID != generationMediaAssetID(task.ID, 0) {
		t.Fatalf("generated asset registration: count=%d err=%v", len(assets), err)
	}
	written, err := s.repo.CanvasProjectForUser(task.UserID, canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	writtenDoc, err := creationDocument(written.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	meta := creationMaps(writtenDoc["nodes"])[0]["metadata"].(map[string]any)
	if meta["status"] != "success" || meta["assetId"] != assets[0].ID {
		t.Fatalf("completed node missing generated asset binding: %#v", meta)
	}
}
