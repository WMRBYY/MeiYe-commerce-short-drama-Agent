package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestAPIMartGPTImage2RoutesOnlyAPIMart(t *testing.T) {
	input := canvasGenerationInput{Mode: "image", Config: providerConfig{InterfaceType: string(model.ChannelInterfaceOpenAIImage), Model: "gpt-image-2-ext", BaseURL: "https://service-3347642c.example.invalid/v1"}}
	if !isAPIMartGPTImage2(input) {
		t.Fatal("APIMart GPT-Image-2 must use its async adapter")
	}
	input.Config.BaseURL = "https://other.example.com/v1"
	if isAPIMartGPTImage2(input) {
		t.Fatal("other providers must retain their configured image protocol")
	}
}

func TestAPIMartGPTImage2RequestUsesResolutionAndNoVersion(t *testing.T) {
	for _, resolution := range []string{"1k", "2k", "4k"} {
		body, err := apimartGPTImage2RequestBody(canvasGenerationInput{Prompt: "cat", Config: providerConfig{Model: "gpt-image-2-ext", Size: "1024x1824", ImageResolution: resolution, Count: "1"}})
		if err != nil || body["resolution"] != resolution || body["size"] != "1024x1824" || body["version"] != nil || body["n"] != 1 {
			t.Fatalf("resolution=%s body=%#v err=%v", resolution, body, err)
		}
	}
	if _, err := apimartGPTImage2RequestBody(canvasGenerationInput{Prompt: "cat", Config: providerConfig{ImageResolution: "8k"}}); err == nil {
		t.Fatal("unsupported resolution accepted")
	}
}

func TestAPIMartGPTImage2SubmitsPollsAndDownloads(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	creates, polls, downloads := 0, 0, 0
	image, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=")
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/images/generations":
			creates++
			if r.Header.Get("Idempotency-Key") == "" || r.Header.Get("X-APIMart-Response-Version") != "" {
				t.Error("unexpected submission headers")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["size"] != "1024x1824" || body["resolution"] != "1k" || body["version"] != nil {
				t.Errorf("unexpected request: %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":[{"status":"submitted","task_id":"task-1"}]}`))
		case "GET /v1/tasks/task-1":
			polls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"status":"completed","result":{"images":[{"url":["` + server.URL + `/image.png"]}]}}}`))
		case "GET /image.png":
			downloads++
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(image)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := runAPIMartGPTImage2Task(ctx, canvasGenerationInput{Mode: "image", Prompt: "cat", Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test", Model: "gpt-image-2-ext", Size: "1024x1824", ImageResolution: "1k"}})
	if err != nil {
		t.Fatal(err)
	}
	images, _ := result["images"].([]map[string]string)
	if creates != 1 || polls != 1 || downloads != 1 || len(images) != 1 || !strings.HasPrefix(images[0]["dataUrl"], "data:image/png;base64,") {
		t.Fatalf("creates=%d polls=%d downloads=%d result=%#v", creates, polls, downloads, result)
	}
}

func TestAPIMartImageCreateLogCapturesArrayTaskID(t *testing.T) {
	log := model.ApiCallLog{Capability: "image", RequestKind: "create", Path: "/v1/images/generations", UpstreamURL: "https://service-3347642c.example.invalid/v1/images/generations"}
	var payload map[string]any
	if err := json.Unmarshal([]byte(`{"code":200,"data":[{"status":"submitted","task_id":"task-1"}]}`), &payload); err != nil {
		t.Fatal(err)
	}
	(*Service)(nil).enrichAPICallLogPayload(&log, payload)
	if log.ProviderRequestID != "task-1" {
		t.Fatalf("provider request ID = %q", log.ProviderRequestID)
	}
}
