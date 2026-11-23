package protocol

import (
	"context"
	"testing"
)

func apimartMidjourneyAdapter(t *testing.T) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "apimart-midjourney.yingce-plugin", "apimart-midjourney")
}

func TestAPIMartMidjourneyImagineRequest(t *testing.T) {
	adapter := apimartMidjourneyAdapter(t)
	request := GenerationRequest{
		Model: "midjourney", Prompt: "a quiet garden", AspectRatio: "16:9", Quality: "2", ImageCount: 1,
		Images: []MediaReference{
			{URL: "https://example.com/second.png", Role: "edit_source", Order: 2},
			{URL: "https://example.com/first.png", Role: "edit_source", Order: 1},
		},
		ProviderOptions: map[string]map[string]any{"apimart-midjourney": {
			"version": "8.2", "speed": "fast", "stylize": 750, "chaos": 10, "negative_prompt": "blurry",
		}},
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Method != "POST" || spec.Path != "/v1/midjourney/generations" || body["version"] != "8.2" || body["speed"] != "fast" || body["size"] != "16:9" || body["quality"] != "2" || body["stylize"] != float64(750) || body["chaos"] != float64(10) {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	images, ok := body["image_urls"].([]any)
	if !ok || len(images) != 2 || images[0] != "https://example.com/first.png" || images[1] != "https://example.com/second.png" {
		t.Fatalf("image_urls = %#v", body["image_urls"])
	}
	for _, key := range []string{"model", "images", "n", "async", "response_format", "reference", "resolution"} {
		if _, exists := body[key]; exists {
			t.Fatalf("unexpected %s in APIMart request: %#v", key, body)
		}
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task_42", Request: request})
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/tasks/task_42" {
		t.Fatalf("poll = %#v, err = %v", poll, err)
	}
}

func TestAPIMartMidjourneyDefaultsAndValidation(t *testing.T) {
	adapter := apimartMidjourneyAdapter(t)
	defaultRequest := GenerationRequest{Model: "midjourney", Prompt: "portrait", AspectRatio: "auto", Quality: "auto"}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: defaultRequest})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["version"] != "8.2" {
		t.Fatalf("default version = %#v", body["version"])
	}
	for _, key := range []string{"size", "quality", "speed", "image_urls"} {
		if _, exists := body[key]; exists {
			t.Fatalf("default request unexpectedly contains %s: %#v", key, body)
		}
	}
	tooMany := make([]MediaReference, 21)
	for index := range tooMany {
		tooMany[index] = MediaReference{URL: "https://example.com/ref.png"}
	}
	for _, test := range []struct {
		name    string
		request GenerationRequest
	}{
		{"wrong model", GenerationRequest{Model: "midjourney-1k", Prompt: "portrait"}},
		{"missing prompt", GenerationRequest{Model: "midjourney", Prompt: " "}},
		{"multiple tasks", GenerationRequest{Model: "midjourney", Prompt: "portrait", ImageCount: 2}},
		{"too many images", GenerationRequest{Model: "midjourney", Prompt: "portrait", Images: tooMany}},
		{"mask", GenerationRequest{Model: "midjourney", Prompt: "portrait", Images: []MediaReference{{URL: "https://example.com/mask.png", Role: "mask"}}}},
		{"invalid speed", GenerationRequest{Model: "midjourney", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"apimart-midjourney": {"speed": "ultra"}}}},
		{"invalid quality", GenerationRequest{Model: "midjourney", Prompt: "portrait", Quality: "high"}},
		{"HD on v7", GenerationRequest{Model: "midjourney", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"apimart-midjourney": {"version": "7", "hd": true}}}},
		{"Niji on v8", GenerationRequest{Model: "midjourney", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"apimart-midjourney": {"niji": true}}}},
		{"v6 without Niji", GenerationRequest{Model: "midjourney", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"apimart-midjourney": {"version": "6"}}}},
		{"stylize range", GenerationRequest{Model: "midjourney", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"apimart-midjourney": {"stylize": 1001}}}},
		{"repeat range", GenerationRequest{Model: "midjourney", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"apimart-midjourney": {"repeat": 1}}}},
		{"image weight requires reference", GenerationRequest{Model: "midjourney", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"apimart-midjourney": {"iw": 2}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: test.request}); err == nil {
				t.Fatal("unsupported APIMart input was accepted")
			}
		})
	}
}

func TestAPIMartMidjourneyTaskAndMediaResponse(t *testing.T) {
	adapter := apimartMidjourneyAdapter(t)
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"code":200,"data":[{"status":"submitted","task_id":"task_42"}]}`))
	if err != nil || created.TaskID != "task_42" || created.Status != StatusPending || created.Result != nil {
		t.Fatalf("create = %#v, err = %v", created, err)
	}
	request := PollContext{TaskID: "task_42"}
	completed, err := adapter.ParsePoll(context.Background(), request, []byte(`{"status":"completed","result":{"images":[{"url":"https://cdn.example.com/1.png"},{"url":"https://cdn.example.com/2.png"},{"url":"https://cdn.example.com/3.png"},{"url":"https://cdn.example.com/4.png"}]}}`))
	if err != nil || completed.TaskID != "task_42" || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Images) != 4 {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
	for _, image := range completed.Result.Images {
		if !image.Ephemeral {
			t.Fatal("APIMart result URL must be persisted by the host")
		}
	}
	failed, err := adapter.ParsePoll(context.Background(), request, []byte(`{"status":"failed","fail_reason":"Banned prompt detected"}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "Banned prompt detected" || failed.Result != nil {
		t.Fatalf("failed = %#v, err = %v", failed, err)
	}
}

func TestAPIMartTaskMediaURLArray(t *testing.T) {
	adapter := apimartMidjourneyAdapter(t)
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_42"}, []byte(`{"code":200,"data":{"status":"completed","result":{"images":[{"url":["https://cdn.example.com/a.png","https://cdn.example.com/b.png"]}]}}}`))
	if err != nil || completed.Result == nil || len(completed.Result.Images) != 2 || completed.Result.Images[0].URL != "https://cdn.example.com/a.png" || completed.Result.Images[1].URL != "https://cdn.example.com/b.png" {
		t.Fatalf("APIMart URL array result = %#v, err = %v", completed, err)
	}
}
