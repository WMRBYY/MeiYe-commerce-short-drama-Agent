package protocol

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestGeminiMultimodalTextPackage(t *testing.T) {
	a := officialPackageAdapter(t, "google-gemini-multimodal-text.yingce-plugin", "gemini-multimodal-text")
	r := GenerationRequest{Model: "gemini-test", Capability: CapabilityText, Prompt: "Read the subtitle", Instructions: "Be precise",
		Messages: []Message{{Role: "user", Content: "Earlier question"}, {Role: "assistant", Content: "Earlier answer"}},
		Images:   []MediaReference{{DataURL: "data:image/png;base64,aW1hZ2U="}},
		Videos:   []MediaReference{{DataURL: "data:video/webm;base64,dmlkZW8="}, {URL: "https://files.example/video.mp4"}},
		Extra:    map[string]any{"max_output_tokens": 1234}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1beta/models/gemini-test:generateContent" || spec.Auth.Type != "google-api-key" {
		t.Fatalf("spec = %#v", spec)
	}
	data, _ := json.Marshal(spec.Body)
	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	contents := body["contents"].([]any)
	if len(contents) != 3 || contents[1].(map[string]any)["role"] != "model" {
		t.Fatalf("history = %s", data)
	}
	parts := contents[2].(map[string]any)["parts"].([]any)
	if len(parts) != 4 {
		t.Fatalf("parts = %s", data)
	}
	if parts[0].(map[string]any)["text"] != "Read the subtitle" {
		t.Fatalf("prompt = %s", data)
	}
	inline := parts[1].(map[string]any)["inlineData"].(map[string]any)
	if inline["mimeType"] != "image/png" || inline["data"] != "aW1hZ2U=" {
		t.Fatalf("image = %s", data)
	}
	inline = parts[2].(map[string]any)["inlineData"].(map[string]any)
	if inline["mimeType"] != "video/webm" || inline["data"] != "dmlkZW8=" {
		t.Fatalf("video = %s", data)
	}
	file := parts[3].(map[string]any)["fileData"].(map[string]any)
	if file["fileUri"] != "https://files.example/video.mp4" || file["mimeType"] != "video/mp4" {
		t.Fatalf("file = %s", data)
	}
	if body["generationConfig"].(map[string]any)["maxOutputTokens"] != float64(1234) || body["systemInstruction"] == nil {
		t.Fatalf("settings = %s", data)
	}
	result, err := a.ParseCreate(context.Background(), []byte(`{"candidates":[{"content":{"parts":[{"text":"private reasoning","thought":true},{"text":"subtitle"},{"text":"answer"}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3,"totalTokenCount":15}}`))
	if err != nil || result.Result == nil || !strings.Contains(result.Result.Text, "subtitle") || strings.Contains(result.Result.Text, "private") {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestGeminiMultimodalTextPlainAndMessageMedia(t *testing.T) {
	a := officialPackageAdapter(t, "google-gemini-multimodal-text.yingce-plugin", "gemini-multimodal-text")
	for _, content := range []any{"hello", []any{map[string]any{"type": "text", "text": "listen"}, map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": "data:audio/wav;base64,YQ=="}}}} {
		spec, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "gemini-test", Messages: []Message{{Role: "user", Content: content}}}})
		if err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(spec.Body)
		if strings.Contains(string(data), `"text":[`) || strings.Contains(string(data), `"fileUri":"data:`) {
			t.Fatalf("invalid content: %s", data)
		}
	}
	if result, err := a.ParseCreate(context.Background(), []byte(`{"error":{"code":400,"message":"invalid media"}}`)); err == nil && result.Status != StatusFailed {
		t.Fatalf("error became success: %#v", result)
	}
}
