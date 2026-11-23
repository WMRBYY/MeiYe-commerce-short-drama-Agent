package canvas

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// Exercise the real transactional write, guard, receipt and reload path. A
// resource upload finishing after writeback must be retryable without another
// generation request, receipt, node or revision.
func TestGeneratedVideoMissingPreviewRollbackAndReplay(t *testing.T) {
	s := newCanvasOperationTestService(t)
	for _, row := range []any{
		&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`},
		&model.Resource{ID: "video", UserID: "user", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "video.mp4"},
		&model.Asset{ID: "asset", UserID: "user", PayloadJSON: `{"data":{"storageKey":"resource:video"}}`},
	} {
		if err := s.repo.Create(row); err != nil {
			t.Fatal(err)
		}
	}
	request := CanvasOperationsRequest{MutationID: "completed-task-writeback", Operations: []CanvasOperation{{Type: "create_node", Node: json.RawMessage(`{"id":"result","type":"video","position":{"x":13,"y":29},"metadata":{"assetId":"asset","storageKey":"resource:video","prompt":"keep prompt","taskId":"already-paid","videoPreview":{"storageKey":"resource:preview"}}}`)}}}
	_, err := s.ApplyUserCanvasOperations("user", "canvas", request)
	var rejected *kernel.AppError
	if !errors.As(err, &rejected) || rejected.Reason != kernel.ReasonCanvasResourcesMissing {
		t.Fatalf("missing preview must fail: %v", err)
	}
	stored, err := s.UserCanvasProject("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(stored), "already-paid") || !strings.Contains(string(stored), `"revision":1`) {
		t.Fatalf("rejected write mutated canvas: %#v", stored)
	}
	if err := s.repo.Create(&model.Resource{ID: "preview", UserID: "user", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "preview.png"}); err != nil {
		t.Fatal(err)
	}
	first, err := s.ApplyUserCanvasOperations("user", "canvas", request)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.ApplyUserCanvasOperations("user", "canvas", request)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != 2 || replay.Revision != first.Revision {
		t.Fatalf("non-idempotent replay: %#v %#v", first, replay)
	}
	stored, err = s.UserCanvasProject("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []json.RawMessage `json:"nodes"`
	}
	if err = json.Unmarshal(stored, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Nodes) != 1 || !strings.Contains(string(doc.Nodes[0]), "keep prompt") || !strings.Contains(string(doc.Nodes[0]), `"x":13`) {
		t.Fatalf("reload lost result/layout: %s", string(stored))
	}
}
