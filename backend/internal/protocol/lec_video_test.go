package protocol

import (
	"context"
	"encoding/json"
	"testing"
)

func TestLecVideoUsesDocumentedJsonContract(t *testing.T) {
	adapter, ok := Builtins().Get("lec-video")
	if !ok {
		t.Fatal("Lec API video protocol missing")
	}
	request := GenerationRequest{
		Model: "lec-vp-seedance-2-5-m2", Prompt: "cinematic scene", Duration: 30,
		AspectRatio: "9:16", Resolution: "1080p",
		Images: []MediaReference{{URL: "https://cdn.example/ref.jpg"}},
		Videos: []MediaReference{{URL: "https://cdn.example/ref.mp4"}},
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3"}},
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Path != "/v1/videos" || create.ContentType != "application/json" {
		t.Fatalf("create request = %#v", create)
	}
	encoded, err := json.Marshal(create.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	if body["duration"] != float64(30) || body["aspect_ratio"] != "9:16" || body["resolution"] != "1080p" {
		t.Fatalf("Lec API output fields = %#v", body)
	}
	for key, want := range map[string]string{"images": request.Images[0].URL, "videos": request.Videos[0].URL, "audios": request.Audios[0].URL} {
		values, ok := body[key].([]any)
		if !ok || len(values) != 1 || values[0] != want {
			t.Fatalf("Lec API %s = %#v", key, body[key])
		}
	}
	for _, unexpected := range []string{"seconds", "image_urls", "video_urls", "audio_urls", "input", "parameters"} {
		if _, ok := body[unexpected]; ok {
			t.Fatalf("unexpected %s in Lec API body", unexpected)
		}
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"video-1","status":"queued"}`))
	if err != nil || created.TaskID != "video-1" || created.Status != StatusPending {
		t.Fatalf("create result = %#v, %v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Path != "/v1/videos/video-1" {
		t.Fatalf("poll request = %#v, %v", poll, err)
	}
	request.Audios[0].URL = "data:audio/mpeg;base64,AA=="
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("Lec API data URL should fail before submission")
	}
}
