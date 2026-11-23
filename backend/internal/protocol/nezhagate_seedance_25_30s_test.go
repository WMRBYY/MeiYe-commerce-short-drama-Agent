package protocol

import (
	"context"
	"strings"
	"testing"
)

func nezhaSeedance30sAdapter(t *testing.T) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "nezhagate-seedance-25-30s.yingce-plugin", "nezhagate-seedance-25-30s")
}

func TestNezhaSeedance30sCreatePollAndResult(t *testing.T) {
	adapter := nezhaSeedance30sAdapter(t)
	request := GenerationRequest{
		Model: "seedance-2.5-30s", Prompt: "@Image1 的人物走向 @Image2 的街道", Duration: 30,
		Resolution: "720P", AspectRatio: "9:16", GenerateAudio: false,
		Images: []MediaReference{{URL: "https://example.com/second.png", Role: "reference_image", Order: 2}, {URL: "https://example.com/first.png", Role: "reference_image", Order: 1}},
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/videos/generations" || body["model"] != request.Model || body["duration"] != float64(30) || body["resolution"] != "720P" || body["size"] != "9:16" {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	images, ok := body["images"].([]any)
	if !ok || len(images) != 2 || images[0] != "https://example.com/first.png" || images[1] != "https://example.com/second.png" {
		t.Fatalf("ordered images = %#v", body["images"])
	}
	for _, field := range []string{"audio", "videos", "audios", "n", "callback_url", "seed", "watermark"} {
		if _, exists := body[field]; exists {
			t.Fatalf("unsupported %s forwarded: %#v", field, body)
		}
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "img_42", Request: request})
	if err != nil || poll.Path != "/v1/videos/jobs/img_42" {
		t.Fatalf("poll = %#v, err = %v", poll, err)
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"img_42","object":"video.generation.job","status":"queued","model":"seedance-2.5-30s"}`))
	if err != nil || created.TaskID != "img_42" || created.Status != StatusPending {
		t.Fatalf("created = %#v, err = %v", created, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "img_42"}, []byte(`{"id":"img_42","status":"succeeded","data":[{"url":"https://service-45922b33.example.invalid/i/result.mp4"}],"usage":{"clips":1}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Videos) != 1 || completed.Result.Videos[0].URL != "https://service-45922b33.example.invalid/i/result.mp4" || !completed.Result.Videos[0].Ephemeral {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "img_42"}, []byte(`{"id":"img_42","status":"failed","error":{"code":"content_policy","message":"rejected"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "rejected" {
		t.Fatalf("failed = %#v, err = %v", failed, err)
	}
}

func TestNezhaSeedance30sRejectsUnsupportedInputs(t *testing.T) {
	adapter := nezhaSeedance30sAdapter(t)
	base := GenerationRequest{Model: "seedance-2.5-30s", Prompt: "city", Duration: 30, Resolution: "720P", AspectRatio: "16:9"}
	defaultSpec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: base.Model, Prompt: base.Prompt}})
	if err != nil {
		t.Fatal(err)
	}
	defaults := manifestTestBody(t, defaultSpec)
	if defaults["duration"] != float64(30) || defaults["resolution"] != "720P" || defaults["size"] != "16:9" {
		t.Fatalf("defaults = %#v", defaults)
	}
	for _, mutate := range []func(*GenerationRequest){
		func(r *GenerationRequest) { r.Model = "seedance-2.0" },
		func(r *GenerationRequest) { r.Prompt = " " },
		func(r *GenerationRequest) { r.Prompt = strings.Repeat("中", 1667) },
		func(r *GenerationRequest) { r.Duration = 15 },
		func(r *GenerationRequest) { r.Resolution = "1080P" },
		func(r *GenerationRequest) { r.AspectRatio = "21:9" },
		func(r *GenerationRequest) { r.Images = make([]MediaReference, 10) },
		func(r *GenerationRequest) { r.Images = []MediaReference{{URL: "https://example.com/first.png", Role: "first_frame"}} },
		func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "https://example.com/video.mp4"}} },
		func(r *GenerationRequest) { r.Audios = []MediaReference{{URL: "https://example.com/audio.mp3"}} },
		func(r *GenerationRequest) { r.Output.Count = 2 },
	} {
		request := base
		mutate(&request)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("unsupported request accepted: %#v", request)
		}
	}
	base.Prompt = strings.Repeat("中", 1666) + "ab"
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: base}); err != nil {
		t.Fatalf("5000-byte prompt rejected: %v", err)
	}
}
