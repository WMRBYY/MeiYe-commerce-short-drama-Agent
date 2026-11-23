package protocol

import (
	"context"
	"testing"
)

func apimartSeedanceAdapter(t *testing.T) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "apimart-seedance-2.yingce-plugin", "apimart-seedance-2")
}

func TestAPIMartSeedanceCreateAndPoll(t *testing.T) {
	adapter := apimartSeedanceAdapter(t)
	request := GenerationRequest{
		Model: "seedance-2.0", Prompt: "cat at sunset", Duration: 5, AspectRatio: "16:9", Resolution: "720p", GenerateAudio: true,
		Images: []MediaReference{{URL: "https://example.com/first.png", Role: "first_frame", Order: 1}, {URL: "https://example.com/last.png", Role: "last_frame", Order: 2}},
		ProviderOptions: map[string]map[string]any{"apimart-seedance-2": {"seed": 42, "return_last_frame": true}},
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/videos/generations" || body["model"] != "seedance-2.0" || body["size"] != "16:9" || body["duration"] != float64(5) || body["generate_audio"] != true || body["return_last_frame"] != true {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	if _, exists := body["image_urls"]; exists {
		t.Fatalf("role-aware request also sent image_urls: %#v", body)
	}
	roles, ok := body["image_with_roles"].([]any)
	if !ok || len(roles) != 2 || roles[0].(map[string]any)["role"] != "first_frame" || roles[1].(map[string]any)["role"] != "last_frame" {
		t.Fatalf("image_with_roles = %#v", body["image_with_roles"])
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task_42", Request: request})
	if err != nil || poll.Path != "/v1/tasks/task_42" {
		t.Fatalf("poll = %#v, err = %v", poll, err)
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"code":200,"data":[{"status":"submitted","task_id":"task_42"}]}`))
	if err != nil || created.TaskID != "task_42" || created.Status != StatusPending {
		t.Fatalf("created = %#v, err = %v", created, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_42"}, []byte(`{"code":200,"data":{"status":"completed","result":{"videos":[{"url":["https://cdn.example.com/video.mp4"]}],"images":[{"url":"https://cdn.example.com/last.png"}]}}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Videos) != 1 || completed.Result.Videos[0].URL != "https://cdn.example.com/video.mp4" || len(completed.Result.Images) != 1 || !completed.Result.Videos[0].Ephemeral {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
}

func TestAPIMartSeedanceRejectsUnsupportedVariantsAndMedia(t *testing.T) {
	adapter := apimartSeedanceAdapter(t)
	defaultSpec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "seedance-2.0", Prompt: "city"}})
	if err != nil {
		t.Fatal(err)
	}
	defaults := manifestTestBody(t, defaultSpec)
	if defaults["duration"] != float64(5) || defaults["size"] != "16:9" || defaults["resolution"] != "720p" {
		t.Fatalf("upstream defaults = %#v", defaults)
	}
	base := GenerationRequest{Model: "seedance-2.0-fast", Prompt: "city", Duration: 5, AspectRatio: "16:9", Resolution: "720p"}
	for _, mutate := range []func(*GenerationRequest){
		func(request *GenerationRequest) { request.Resolution = "4k" },
		func(request *GenerationRequest) { request.Duration = 16 },
		func(request *GenerationRequest) { request.Images = []MediaReference{{URL: "https://example.com/a.png", Role: "first_frame"}, {URL: "https://example.com/b.png"}} },
		func(request *GenerationRequest) { request.Images = []MediaReference{{URL: "https://example.com/mask.png", Role: "mask"}} },
		func(request *GenerationRequest) { request.Images = []MediaReference{{URL: "https://example.com/first.png", Role: "first_frame"}}; request.Audios = []MediaReference{{URL: "https://example.com/audio.wav"}} },
		func(request *GenerationRequest) { request.Audios = []MediaReference{{URL: "https://example.com/audio.wav"}} },
	} {
		request := base
		mutate(&request)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("unsupported Seedance request accepted: %#v", request)
		}
	}
}
