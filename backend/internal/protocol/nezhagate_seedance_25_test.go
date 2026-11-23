package protocol

import (
	"context"
	"strings"
	"testing"
)

func nezhaSeedance25Adapter(t *testing.T) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "nezhagate-seedance-25.yingce-plugin", "nezhagate-seedance-25")
}

func TestNezhaSeedance25CreatePollAndResult(t *testing.T) {
	adapter := nezhaSeedance25Adapter(t)
	request := GenerationRequest{
		Model: "seedance-2.5", Prompt: "@Image1 和 @Video1 的动作，配合 @Audio1", Duration: 17,
		Resolution: "1080P", AspectRatio: "9:16",
		Images: []MediaReference{{URL: "https://example.com/second.png", Order: 2}, {URL: "https://example.com/first.png", Order: 1}},
		Videos: []MediaReference{{URL: "https://example.com/motion.mp4", Order: 1}},
		Audios: []MediaReference{{URL: "https://example.com/voice.mp3", Order: 1}},
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/videos/generations" || body["model"] != request.Model || body["duration"] != float64(17) || body["resolution"] != "1080P" || body["size"] != "9:16" {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	images, ok := body["images"].([]any)
	if !ok || len(images) != 2 || images[0] != "https://example.com/first.png" || images[1] != "https://example.com/second.png" {
		t.Fatalf("images = %#v", body["images"])
	}
	if videos, ok := body["video_references"].([]any); !ok || len(videos) != 1 || videos[0] != "https://example.com/motion.mp4" {
		t.Fatalf("videos = %#v", body["video_references"])
	}
	if audios, ok := body["audio_reference"].([]any); !ok || len(audios) != 1 || audios[0] != "https://example.com/voice.mp3" {
		t.Fatalf("audios = %#v", body["audio_reference"])
	}
	for _, field := range []string{"audio", "n", "callback_url", "seed", "watermark"} {
		if _, exists := body[field]; exists {
			t.Fatalf("unsupported %s forwarded", field)
		}
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "img_25", Request: request})
	if err != nil || poll.Path != "/v1/videos/jobs/img_25" {
		t.Fatalf("poll = %#v, err = %v", poll, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "img_25"}, []byte(`{"id":"img_25","status":"succeeded","data":[{"url":"https://service-45922b33.example.invalid/i/video.mp4"}]}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Videos) != 1 || completed.Result.Videos[0].URL != "https://service-45922b33.example.invalid/i/video.mp4" {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
}

func TestNezhaSeedance25RejectsUnsupportedInputs(t *testing.T) {
	adapter := nezhaSeedance25Adapter(t)
	base := GenerationRequest{Model: "seedance-2.5", Prompt: "city", Duration: 4, Resolution: "720P", AspectRatio: "16:9"}
	for _, mutate := range []func(*GenerationRequest){
		func(r *GenerationRequest) { r.Model = "seedance-2.5-30s" },
		func(r *GenerationRequest) { r.Prompt = " " },
		func(r *GenerationRequest) { r.Prompt = strings.Repeat("中", 11001) },
		func(r *GenerationRequest) { r.Duration = 3 },
		func(r *GenerationRequest) { r.Duration = 31 },
		func(r *GenerationRequest) { r.Resolution = "4K" },
		func(r *GenerationRequest) { r.AspectRatio = "21:9" },
		func(r *GenerationRequest) { r.Images = make([]MediaReference, 31) },
		func(r *GenerationRequest) { r.Videos = make([]MediaReference, 11) },
		func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "https://example.com/a.mp4", Metadata: map[string]any{"bytes": 40 * 1024 * 1024}}, {URL: "https://example.com/b.mp4", Metadata: map[string]any{"bytes": 40 * 1024 * 1024}}, {URL: "https://example.com/c.mp4", Metadata: map[string]any{"bytes": 40 * 1024 * 1024}}} },
		func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "https://example.com/a.mp4", Metadata: map[string]any{"durationMs": 20000}}, {URL: "https://example.com/b.mp4", Metadata: map[string]any{"durationMs": 20000}}} },
		func(r *GenerationRequest) { r.Audios = make([]MediaReference, 11) },
		func(r *GenerationRequest) { r.Audios = []MediaReference{{URL: "https://example.com/voice.mp3"}} },
		func(r *GenerationRequest) { r.Images = []MediaReference{{URL: "https://example.com/image.png"}}; r.Audios = []MediaReference{{DataURL: "data:audio/mp3;base64,AAAA"}} },
		func(r *GenerationRequest) { r.Images = []MediaReference{{URL: "https://example.com/first.png", Role: "first_frame"}} },
		func(r *GenerationRequest) { r.Output.Count = 2 },
	} {
		request := base
		mutate(&request)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("unsupported request accepted: %#v", request)
		}
	}
	defaultSpec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: base.Model, Prompt: base.Prompt}})
	if err != nil {
		t.Fatal(err)
	}
	defaults := manifestTestBody(t, defaultSpec)
	if defaults["duration"] != float64(4) || defaults["resolution"] != "720P" || defaults["size"] != "16:9" {
		t.Fatalf("defaults = %#v", defaults)
	}
}
