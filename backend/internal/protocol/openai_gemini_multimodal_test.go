package protocol

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenAIGeminiMultimodalPackage(t *testing.T) {
	a := officialPackageAdapter(t, "openai-gemini-multimodal.yingce-plugin", "openai-gemini-multimodal")
	if a.Metadata().RequiresPublicMediaURLs {
		t.Fatal("images must be inlined, not required as public URLs")
	}
	r := GenerationRequest{Model: "gemini-3-flash", Capability: CapabilityText, Prompt: "描述画面", Instructions: "简洁",
		Images: []MediaReference{{DataURL: "data:image/png;base64,aW1hZ2U="}},
		Videos: []MediaReference{{URL: "https://files.example/video.mp4"}}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: r})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/chat/completions" || spec.Auth.Type != "bearer" {
		t.Fatalf("spec = %#v", spec)
	}
	data, _ := json.Marshal(spec.Body)
	body := string(data)
	for _, want := range []string{`"model":"gemini-3-flash"`, `"role":"system"`, `"image_url":{"url":"data:image/png;base64,aW1hZ2U="}`, `"video_url":{"url":"https://files.example/video.mp4"}`, `"stream":false`} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %s in %s", want, body)
		}
	}
	result, err := a.ParseCreate(context.Background(), []byte(`{"choices":[{"message":{"content":"一只猫"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}`))
	if err != nil || result.Result == nil || result.Result.Text != "一只猫" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}
