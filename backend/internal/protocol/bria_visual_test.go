package protocol

import (
	"context"
	"strings"
	"testing"
)

func TestBriaVisualGenerationAndStatus(t *testing.T) {
	adapter := officialPackageAdapter(t, "bria-visual-api.yingce-plugin", "bria-v2-image-generate")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "/v2/image/generate", Prompt: "a blue cup", AspectRatio: "16:9",
		Images: []MediaReference{{DataURL: "data:image/png;base64,YWJj"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v2/image/generate" || spec.Auth.Type != "header" || spec.Auth.Header != "api_token" {
		t.Fatalf("Bria create spec = %#v", spec)
	}
	body := manifestTestBody(t, spec)
	if body["prompt"] != "a blue cup" || body["aspect_ratio"] != "16:9" || !strings.Contains(strings.TrimSpace(body["images"].([]any)[0].(string)), "YWJj") {
		t.Fatalf("Bria create body = %#v", body)
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"request_id":"bria-job-1","status_url":"https://engine.prod.bria-api.com/v2/status/bria-job-1"}`))
	if err != nil || created.TaskID != "bria-job-1" || created.Status != StatusPending {
		t.Fatalf("Bria create result = %#v, %v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Path != "/v2/status/bria-job-1" {
		t.Fatalf("Bria poll spec = %#v, %v", poll, err)
	}
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"request_id":"bria-job-1","status":"COMPLETED","result":{"image_url":"https://example.com/result.png","seed":42}}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].URL != "https://example.com/result.png" {
		t.Fatalf("Bria poll result = %#v, %v", result, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"request_id":"bria-job-1","status":"UNKNOWN","error":{"message":"expired"}}`))
	if err != nil || failed.Status != StatusFailed {
		t.Fatalf("Bria unknown status = %#v, %v", failed, err)
	}
}

func TestBriaVisualEditAndVideoPayloads(t *testing.T) {
	image := officialPackageAdapter(t, "bria-visual-api.yingce-plugin", "bria-v2-image-edit-remove-background")
	imageSpec, err := image.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Images: []MediaReference{{URL: "https://example.com/source.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if body := manifestTestBody(t, imageSpec); body["image"] != "https://example.com/source.png" {
		t.Fatalf("Bria image edit body = %#v", body)
	}
	video := officialPackageAdapter(t, "bria-visual-api.yingce-plugin", "bria-v2-video-edit-remove-background")
	videoSpec, err := video.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Videos: []MediaReference{{URL: "https://example.com/source.mp4"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if body := manifestTestBody(t, videoSpec); body["video"] != "https://example.com/source.mp4" {
		t.Fatalf("Bria video edit body = %#v", body)
	}
	for _, protocolID := range []string{"bria-v2-video-edit-replace-background", "bria-v2-video-edit-increase-resolution"} {
		adapter := officialPackageAdapter(t, "bria-visual-api.yingce-plugin", protocolID)
		if !adapter.Metadata().RequiresPublicMediaURLs {
			t.Fatalf("%s requires a public video URL", protocolID)
		}
	}
}

func TestBriaStructuredDataRemainsPendingUntilResult(t *testing.T) {
	adapter := officialPackageAdapter(t, "bria-visual-api.yingce-plugin", "bria-v2-structured-prompt-generate")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"request_id":"bria-data-1","status":"IN_PROGRESS"}`))
	if err != nil || created.Status != StatusProcessing || created.Result != nil {
		t.Fatalf("Bria data create = %#v, %v", created, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"request_id":"bria-data-1","status":"COMPLETED","result":{"structured_prompt":{"description":"blue cup"}}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || !strings.Contains(completed.Result.Text, `"blue cup"`) {
		t.Fatalf("Bria data result = %#v, %v", completed, err)
	}
}

func TestBriaSegmentationMaskResults(t *testing.T) {
	adapter := officialPackageAdapter(t, "bria-visual-api.yingce-plugin", "bria-v2-image-segment-all-masks")
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"request_id":"mask-1","result":{"masks":[{"id":1,"image_url":"https://example.com/mask.png"}]}}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].URL != "https://example.com/mask.png" {
		t.Fatalf("Bria segmentation masks = %#v, %v", result, err)
	}
}
