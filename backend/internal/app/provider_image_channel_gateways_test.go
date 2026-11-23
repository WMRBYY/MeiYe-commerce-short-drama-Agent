package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestNezhaGateImageJob(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var submitted map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing provider authorization")
		}
		switch r.URL.Path {
		case "/v1/images/generations":
			if r.Method != http.MethodPost {
				t.Errorf("submit method = %s", r.Method)
			}
			if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
				t.Errorf("decode submit: %v", err)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"img-test","status":"queued"}`))
		case "/v1/images/jobs/img-test":
			_, _ = w.Write([]byte(`{"id":"img-test","status":"succeeded","data":[{"url":"https://img.example.test/output.png"}]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "image", Prompt: "a cup", Config: providerConfig{
		BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "gpt-image-2.5-flare", Size: "16:9", Quality: "2k",
	}}
	result, err := runNezhaGateImageTask(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if submitted["size"] != "16:9" || submitted["resolution"] != "2K" || submitted["model"] != "gpt-image-2.5-flare" {
		t.Fatalf("submit body = %#v", submitted)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != "https://img.example.test/output.png" {
		t.Fatalf("images = %#v", result["images"])
	}
}

func TestNezhaGateImageFailure(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/images/generations":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"img-failed","status":"queued"}`))
		case "/v1/images/jobs/img-failed":
			_, _ = w.Write([]byte(`{"id":"img-failed","status":"failed","error":{"message":"upstream quota exhausted"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "image", Prompt: "a cup", Config: providerConfig{
		BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "gpt-image-2", Size: "1:1", Quality: "1k",
	}}
	_, err := runNezhaGateImageTask(context.Background(), input)
	if err == nil || !strings.Contains(err.Error(), "额度不足") {
		t.Fatalf("failed job returned %v, want a quota failure instead of processing", err)
	}
}

func TestNezhaGateImageValidationAndReferences(t *testing.T) {
	for _, size := range []string{"abc", "0:1", "1024x0"} {
		_, err := nezhaGateImageBody(canvasGenerationInput{Prompt: "cup", Config: providerConfig{Size: size}})
		if err == nil {
			t.Errorf("size %q accepted", size)
		}
	}
	input := canvasGenerationInput{Prompt: "edit", ReferenceImages: []providerMedia{{URL: "https://example.test/ref.png"}}, Config: providerConfig{Model: "gpt-image-2", Quality: "1k"}}
	body, err := nezhaGateImageBody(input)
	if err != nil || body["image"] != "https://example.test/ref.png" {
		t.Fatalf("reference body = %#v, err = %v", body, err)
	}
	if body["images"] != nil {
		t.Fatalf("single reference should use image, got %#v", body)
	}
	input.Config.Size = "2752x1536"
	input.Config.Quality = "auto"
	body, err = nezhaGateImageBody(input)
	if err != nil || body["resolution"] != "2K" {
		t.Fatalf("pixel tier body = %#v, err = %v", body, err)
	}
}

func TestPearAPIImageRoutesAndRatios(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var submitted map[string]any
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
			t.Errorf("decode body: %v", err)
		}
		_, _ = w.Write([]byte(`{"created":1,"data":[{"url":"https://img.example.test/pear.png"}]}`))
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "image", Prompt: "a pear", Config: providerConfig{
		BaseURL: server.URL, APIKey: "test-key", Model: "nano-banana-pro-2k", Size: "1824x1024", Count: "1",
	}}
	result, err := runPearAPIImageTask(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if requestPath != "/v1/images/generations" || submitted["aspect_ratio"] != "16:9" || submitted["model"] != "nano-banana-pro-2k" || submitted["task_type"] != "sync" {
		t.Fatalf("path = %q, body = %#v", requestPath, submitted)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != "https://img.example.test/pear.png" {
		t.Fatalf("images = %#v", result["images"])
	}
	input.ReferenceImages = []providerMedia{{URL: "https://example.test/ref.png"}}
	_, err = runPearAPIImageTask(context.Background(), input)
	if err != nil || requestPath != "/v1/images/edits" || submitted["image"] != "https://example.test/ref.png" {
		t.Fatalf("edit path = %q, body = %#v, err = %v", requestPath, submitted, err)
	}
	for _, size := range []string{"1024x333", "4:9"} {
		if _, err := pearAPIAspectRatio(size); err == nil {
			t.Errorf("unsupported ratio %q accepted", size)
		}
	}
}

func TestGatewayImageAdapterSelection(t *testing.T) {
	nezha := canvasGenerationInput{Mode: "image", Config: providerConfig{BaseURL: "https://service-01b31036.example.invalid/v1", InterfaceType: string(model.ChannelInterfaceOpenAIImage), Model: "gpt-image-2"}}
	for _, modelID := range []string{"gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "nano-banana-2", "nano-banana-pro", "nano-banana-2.1", "grok-imagine-image", "grok-imagine-image-quality"} {
		nezha.Config.Model = modelID
		if !isNezhaGateImage(nezha) {
			t.Fatalf("NezhaGate image adapter not selected for %s", modelID)
		}
	}
	nezha.Config.Model = "nano-banana-2"
	nezha.Config.BaseURL = "https://other.example/v1"
	if isNezhaGateImage(nezha) {
		t.Fatal("NezhaGate adapter selected for another host")
	}
	pear := canvasGenerationInput{Mode: "image", Config: providerConfig{BaseURL: "https://service-27d2a128.example.invalid", InterfaceType: string(model.ChannelInterfaceGeminiImage), Model: "nano-banana-pro-1k"}}
	if !isPearAPIImage(pear) {
		t.Fatal("PearAPI image adapter not selected")
	}
	pear.Config.Model = "nano-banana-2"
	if isPearAPIImage(pear) {
		t.Fatal("PearAPI adapter selected for unrelated model")
	}
}

func TestNezhaGateNonGPTImageOmitsQuality(t *testing.T) {
	for _, modelID := range []string{"nano-banana-2", "grok-imagine-image"} {
		body, err := nezhaGateImageBody(canvasGenerationInput{Prompt: "a cup", Config: providerConfig{Model: modelID, Size: "1:1", Quality: "low"}})
		if err != nil {
			t.Fatal(err)
		}
		if _, exists := body["quality"]; exists {
			t.Fatalf("%s received unsupported quality: %#v", modelID, body)
		}
		if body["resolution"] != "1K" || body["size"] != "1:1" {
			t.Fatalf("%s request lost tier or ratio: %#v", modelID, body)
		}
		if _, err := nezhaGateImageBody(canvasGenerationInput{Prompt: "a cup", Config: providerConfig{Model: modelID, Count: "2"}}); err == nil {
			t.Fatalf("%s accepted a count that its job API cannot deliver", modelID)
		}
	}
}
