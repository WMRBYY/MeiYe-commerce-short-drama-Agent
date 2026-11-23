package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// Real Node session + model bridge + worker + canvas writes. The provider is
// deterministic and local; this test consumes no paid upstream requests.
func TestCloudAgentOmniRuntimePlansAndConnects(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node unavailable")
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_OMNI_AUTO_ROLLOUT", "admin")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", Title: "omni runtime", PayloadJSON: `{"nodes":[]}`}
	doc, _ := creationDocument(canvas.PayloadJSON)
	writeArgs, _ := json.Marshal(map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "ops": []map[string]any{
		{"type": "add_node", "id": "omni-plan", "nodeType": "text", "title": "商品视觉策划", "content": "保留商品真实外观", "x": 100, "y": 100},
		{"type": "add_node", "id": "omni-image", "nodeType": "image", "title": "待生成商品海报", "x": 650, "y": 100},
		{"type": "connect_nodes", "id": "omni-edge", "fromNodeId": "omni-plan", "toNodeId": "omni-image"},
	}})
	tool := func(id, name, args string) map[string]any {
		return map[string]any{"id": id, "type": "function", "function": map[string]any{"name": name, "arguments": args}}
	}
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var message map[string]any
		switch calls.Add(1) {
		case 1:
			time.Sleep(500 * time.Millisecond)
			message = map[string]any{"content": "", "tool_calls": []any{tool("plan-1", "plan_update", `{"items":[{"id":"workflow","title":"创建策划和图片节点并连线","status":"doing"}]}`), tool("write-1", "canvas_apply_ops", string(writeArgs))}}
		case 2:
			message = map[string]any{"content": "策划与图片草稿节点已经连接；本次没有执行图片生成。"}
		default:
			message = map[string]any{"content": "策划与图片草稿节点已经连接；本次没有执行图片生成。"}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
	}))
	defer upstream.Close()
	s, db, _, _ := creationTestService(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	if err := db.Model(&model.User{}).Where("id = ?", "user").Updates(map[string]any{"username": "omni-runtime-admin", "role": model.UserRoleAdmin}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.PermissionMode = cloudAgentOmniMode
	req.Prompt = "创建商品海报策划和图片草稿节点并连接，不进行媒体生成"
	req.Budget.MaxGenerationTasks = 0
	quote, err := s.CloudAgentOmniQuote("user", req)
	if err != nil {
		t.Fatal(err)
	}
	req.OmniAuthorization = omniTestGrant(req)
	req.OmniAuthorization.EstimateHash = quote.Hash
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if calls.Load() == 0 {
		t.Fatal("runtime never submitted its first model step")
	}
	if err := s.SetCloudAgentOmniPaused("user", run.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetCloudAgentOmniPaused("user", run.ID, false); err != nil {
		t.Fatal(err)
	}
	final := waitCloudAgentStatus(t, s, run.ID, "completed")
	stored, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	result, _ := creationDocument(stored.PayloadJSON)
	if len(creationMaps(result["nodes"])) != 2 || len(creationMaps(result["connections"])) != 1 {
		t.Fatalf("workflow not written: %s", stored.PayloadJSON)
	}
	verifiedPlan := false
	for _, event := range final.Events {
		if event.Type == "approval_requested" {
			t.Fatal("omni requested per-node approval")
		}
		if event.Type == "plan_updated" && event.Payload["source"] == "verified_result" {
			verifiedPlan = true
		}
	}
	if !verifiedPlan {
		t.Fatal("verified canvas write did not publish a plan update")
	}
	if calls.Load() != 2 {
		t.Fatalf("unexpected model steps: %d", calls.Load())
	}
}
