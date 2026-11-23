package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAPIMartExtImageRequestAndPoll(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	creates, polls := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/images/generations":
			creates++
			if r.Header.Get("Idempotency-Key") == "" || r.Header.Get("X-APIMart-Response-Version") != "2026-07-27" {
				t.Error("missing APIMart submission headers")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["size"] != "16:9" || body["resolution"] != "2K" || body["version"] != "flare" || body["n"] != float64(1) {
				t.Errorf("unexpected request body: %#v", body)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"code":202,"data":{"id":"task-1","status":"pending"}}`))
		case "GET /v1/tasks/task-1":
			polls++
			_, _ = w.Write([]byte(`{"code":200,"data":{"id":"task-1","status":"completed","result":{"images":[{"url":["https://example.com/result.png"]}]}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := runAPIMartExtImageTask(ctx, canvasGenerationInput{
		Mode: "image", Prompt: "a cup",
		Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "gpt-image-2.5-ext", Size: "1824x1024", Quality: "medium"},
	})
	if err != nil {
		t.Fatal(err)
	}
	images, _ := result["images"].([]map[string]string)
	if creates != 1 || polls != 1 || len(images) != 1 || images[0]["dataUrl"] != "https://example.com/result.png" {
		t.Fatalf("creates=%d polls=%d result=%#v", creates, polls, result)
	}
}

func TestAPIMartExtRejectsUnsupportedSizeBeforeSubmission(t *testing.T) {
	for _, size := range []string{"1000x900", "8:7", "broken"} {
		_, err := apimartExtRequestBody(canvasGenerationInput{Prompt: "a cup", Config: providerConfig{Model: "gpt-image-2.5-ext", Size: size}})
		if err == nil || (!strings.Contains(err.Error(), "比例") && !strings.Contains(err.Error(), "宽高比")) {
			t.Fatalf("size %q: %v", size, err)
		}
	}
	for _, count := range []string{"0", "5", "abc"} {
		_, err := apimartExtRequestBody(canvasGenerationInput{Prompt: "a cup", Config: providerConfig{Model: "gpt-image-2.5-ext", Size: "1:1", Count: count}})
		if err == nil || !strings.Contains(err.Error(), "1 至 4") {
			t.Fatalf("count %q: %v", count, err)
		}
	}
}

func TestAPIMartExtImageReferenceUsesSunburstAndTaskIDFormats(t *testing.T) {
	body, err := apimartExtRequestBody(canvasGenerationInput{
		Prompt: "edit", Config: providerConfig{Model: "gpt-image-2.5-ext", Size: "1:1", Quality: "high"},
		ReferenceImages: []providerMedia{{DataURL: "data:image/png;base64,AA=="}},
	})
	if err != nil || body["version"] != "sunburst" || body["resolution"] != "4K" {
		t.Fatalf("body=%#v err=%v", body, err)
	}
	if got := apimartExtTaskID(map[string]any{"data": []any{map[string]any{"task_id": "task-2"}}}); got != "task-2" {
		t.Fatalf("task ID = %q", got)
	}
}

func TestProviderPayloadBusinessFailureAcceptsHTTPStyleSuccessCode(t *testing.T) {
	for _, code := range []any{float64(200), float64(202), "200", "202"} {
		if _, _, failed := providerPayloadBusinessFailure(map[string]any{"code": code, "data": map[string]any{"id": "task-1"}}); failed {
			t.Fatalf("success code %v marked failed", code)
		}
	}
}
