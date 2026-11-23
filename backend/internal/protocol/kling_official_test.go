package protocol

import (
	"context"
	"testing"
)

func TestKlingOfficialLifecycle(t *testing.T) {
	a := officialPackageAdapter(t, "kling-official.yingce-plugin", "kling-official")
	ctx := context.Background()
	req := GenerationRequest{Model: "kling-3.0", Prompt: "一只猫", Duration: 5, Resolution: "720p", AspectRatio: "16:9"}
	create, err := a.BuildCreate(ctx, RequestContext{Request: req})
	if err != nil || create.Path != "/text-to-video/kling-3.0" {
		t.Fatalf("create=%#v err=%v", create, err)
	}
	body := manifestTestBody(t, create)
	settings := body["settings"].(map[string]any)
	if body["prompt"] != req.Prompt || settings["duration"] != float64(5) || settings["audio"] != "off" {
		t.Fatalf("body=%#v", body)
	}
	req.Images = []MediaReference{{URL: "https://cdn.example/first.png", Role: "first_frame"}, {URL: "https://cdn.example/last.png", Role: "last_frame", Order: 1}}
	create, err = a.BuildCreate(ctx, RequestContext{Request: req})
	if err != nil || create.Path != "/image-to-video/kling-3.0" {
		t.Fatalf("image create=%#v err=%v", create, err)
	}
	body = manifestTestBody(t, create)
	contents, ok := body["contents"].([]any)
	if !ok || len(contents) != 3 || contents[1].(map[string]any)["url"] != req.Images[0].URL {
		t.Fatalf("contents=%#v", body)
	}
	if _, ok := body["settings"].(map[string]any)["aspect_ratio"]; ok {
		t.Fatal("image request must omit aspect_ratio")
	}
	req.Images[0].Role = "reference_image"
	if _, err := a.BuildCreate(ctx, RequestContext{Request: req}); err == nil {
		t.Fatal("unsupported reference accepted")
	}
	created, err := a.ParseCreate(ctx, []byte(`{"code":0,"data":{"id":"task-1","status":"submitted"}}`))
	if err != nil || created.TaskID != "task-1" || created.Status != StatusPending {
		t.Fatalf("created=%#v err=%v", created, err)
	}
	pollCtx := PollContext{TaskID: created.TaskID}
	poll, err := a.BuildPoll(ctx, pollCtx)
	if err != nil || poll.Path != "/tasks" || len(poll.Query["task_ids"]) != 1 || poll.Query["task_ids"][0] != "task-1" {
		t.Fatalf("poll=%#v err=%v", poll, err)
	}
	for _, tc := range []struct {
		body   string
		status Status
	}{
		{`{"code":0,"data":[{"id":"task-1","status":"processing"}]}`, StatusProcessing},
		{`{"code":0,"data":[{"id":"other","status":"succeeded","outputs":[{"type":"video","url":"https://wrong.example/v.mp4"}]},{"id":"task-1","status":"succeeded","outputs":[{"type":"video","url":"https://cdn.example/v.mp4"}]}]}`, StatusSucceeded},
		{`{"code":0,"data":[{"id":"task-1","status":"failed","message":"content rejected"}]}`, StatusFailed},
		{`{"code":0,"data":[{"id":"task-1","status":"succeeded","outputs":[]}]}`, StatusFailed},
		{`{"code":1000,"message":"invalid key"}`, StatusFailed},
	} {
		result, err := a.ParsePoll(ctx, pollCtx, []byte(tc.body))
		if err != nil || result.Status != tc.status {
			t.Fatalf("result=%#v err=%v body=%s", result, err, tc.body)
		}
		if tc.status == StatusSucceeded && (result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://cdn.example/v.mp4" || !result.Result.Videos[0].Ephemeral) {
			t.Fatalf("video=%#v", result)
		}
	}
}
