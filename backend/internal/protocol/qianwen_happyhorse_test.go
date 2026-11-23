package protocol

import (
	"context"
	"testing"
)

func TestQianwenHappyHorseRequestAndPoll(t *testing.T) {
	ctx := context.Background()
	adapter := officialPackageAdapter(t, "qianwenai-happyhorse-video.yingce-plugin", "qianwenai-happyhorse-video")
	for _, test := range []struct {
		model, imageRole string
	}{
		{"happyhorse-1.1-t2v", ""},
		{"happyhorse-1.1-i2v", "first_frame"},
		{"happyhorse-1.1-r2v", "reference_image"},
	} {
		t.Run(test.model, func(t *testing.T) {
			request := GenerationRequest{Model: test.model, Prompt: "A running cat", AspectRatio: "16:9", Resolution: "720p", Duration: 5}
			if test.imageRole != "" {
				request.Images = []MediaReference{{Kind: "image", URL: "https://example.com/cat.png"}}
			}
			spec, err := adapter.BuildCreate(ctx, RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			if !spec.OriginPath || spec.Path != "/api/v1/services/aigc/video-generation/video-synthesis" || spec.Headers["X-DashScope-Async"] != "enable" {
				t.Fatalf("invalid upstream submission: %#v", spec)
			}
			body := manifestTestBody(t, spec)
			input := body["input"].(map[string]any)
			parameters := body["parameters"].(map[string]any)
			if body["model"] != test.model || parameters["resolution"] != "720P" || parameters["duration"] != float64(5) {
				t.Fatalf("invalid body: %#v", body)
			}
			if test.imageRole == "" && input["media"] != nil {
				t.Fatalf("unexpected input media: %#v", input)
			}
			if test.imageRole != "" && input["media"].([]any)[0].(map[string]any)["type"] != test.imageRole {
				t.Fatalf("invalid input media: %#v", input)
			}
			if test.imageRole == "first_frame" && parameters["ratio"] != nil {
				t.Fatalf("first-frame ratio must come from the image: %#v", parameters)
			}
		})
	}
	created, err := adapter.ParseCreate(ctx, []byte(`{"output":{"task_id":"upstream-id","task_status":"PENDING"}}`))
	if err != nil || created.TaskID != "upstream-id" || created.Status != StatusPending {
		t.Fatalf("invalid task: %#v, %v", created, err)
	}
	poll := PollContext{TaskID: created.TaskID}
	spec, err := adapter.BuildPoll(ctx, poll)
	if err != nil || spec.Path != "/api/v1/tasks/upstream-id" || !spec.OriginPath {
		t.Fatalf("invalid polling request: %#v, %v", spec, err)
	}
	result, err := adapter.ParsePoll(ctx, poll, []byte(`{"output":{"task_status":"SUCCEEDED","video_url":"https://example.com/result.mp4"}}`))
	if err != nil || result.Status != StatusSucceeded || len(result.Result.Videos) != 1 || !result.Result.Videos[0].Ephemeral {
		t.Fatalf("invalid result: %#v, %v", result, err)
	}
}
