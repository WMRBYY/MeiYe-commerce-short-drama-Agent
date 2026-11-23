package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceImageRetriesConfirmedTextReplyOnce(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII="
	const textReply = `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","type":"image_generation_error","param":null,"message":"目前无法在此对话中直接生成或编辑图片。可以帮你整理最终生图提示词。"}}`
	const originalPrompt = "保留商品外形，按原方案制作第 9 张详情图。"
	for _, tc := range []struct {
		name      string
		body      string
		status    int
		commerce  bool
		recover   bool
		wantCalls int32
	}{
		{"recovers same page", textReply, 400, true, true, 2},
		{"stops after second text reply", textReply, 400, true, false, 2},
		{"gateway timeout", textReply, 524, true, false, 1},
		{"non ecommerce", textReply, 400, false, false, 1},
		{"moderation", `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","message":"内容安全检查未通过，无法在此对话中生成图片。"}}`, 400, true, false, 1},
		{"parameter failure", `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","message":"参考图片格式不支持"}}`, 400, true, false, 1},
		{"accepted task", `{"error":{"code":"upstream_text_reply","task_id":"provider-task","message":"无法在对话中生成图片"}}`, 400, true, false, 1},
		{"usage returned", `{"error":{"code":"upstream_text_reply","message":"无法在对话中生成图片"},"usage":{"input_tokens":50}}`, 400, true, false, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempt := calls.Add(1)
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Errorf("multipart request: %v", err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				defer r.MultipartForm.RemoveAll()
				prompt := r.FormValue("prompt")
				if r.URL.Path != "/v1/images/edits" || r.FormValue("model") != "gpt-image-2.6-flare" || r.FormValue("n") != "1" || !strings.HasSuffix(prompt, originalPrompt) || strings.HasPrefix(prompt, ecommerceImageOutputInstruction) != (attempt == 2) {
					t.Errorf("request changed page, model, or image mode: %s %q", r.URL.Path, prompt)
				}
				photo, _, err := r.FormFile("image")
				if err != nil {
					t.Errorf("missing reference image: %v", err)
				} else {
					data, readErr := io.ReadAll(photo)
					_ = photo.Close()
					if readErr != nil || len(data) == 0 {
						t.Errorf("empty reference image: %v", readErr)
					}
				}
				w.Header().Set("Content-Type", "application/json")
				if attempt == 1 || !tc.recover {
					w.WriteHeader(tc.status)
					_, _ = io.WriteString(w, tc.body)
					return
				}
				_, _ = io.WriteString(w, `{"data":[{"b64_json":"`+png+`"}]}`)
			}))
			defer server.Close()
			input := canvasGenerationInput{
				Mode: "image", Prompt: originalPrompt,
				Config:          providerConfig{BaseURL: server.URL + "/v1", APIKey: "test", Model: "gpt-image-2.6-flare", Count: "1", InterfaceType: string(model.ChannelInterfaceOpenAIImage)},
				ReferenceImages: []providerMedia{{DataURL: "data:image/png;base64," + png, Name: "product.png"}},
			}
			if tc.commerce {
				input.Metadata = map[string]any{"source": "workbench", "workbenchKind": "image", "ecommerceProjectId": "project"}
			}
			ctx := withProtocolRegistry(context.Background(), loadOfficialFallbackRegistry())
			result, err := runImageTask(ctx, input)
			if calls.Load() != tc.wantCalls {
				t.Fatalf("got %d calls, want %d (err=%v)", calls.Load(), tc.wantCalls, err)
			}
			if tc.recover {
				if err != nil || result["images"] == nil {
					t.Fatalf("missing recovered image: %v", err)
				}
			} else if err == nil || (tc.wantCalls == 2 && !strings.Contains(err.Error(), "可单独重试")) {
				t.Fatalf("missing terminal error: %v", err)
			}
		})
	}
}
