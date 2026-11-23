package protocol

import (
	"context"
	"testing"
)

func apimartMusicAdapter(t *testing.T, id string) Adapter {
	t.Helper()
	return officialPackageAdapter(t, id+".yingce-plugin", id)
}

func TestAPIMartFlowMusicContract(t *testing.T) {
	adapter := apimartMusicAdapter(t, "apimart-flowmusic")
	request := GenerationRequest{Model: "flowmusic", Prompt: "soft piano", ProviderOptions: map[string]map[string]any{
		"apimart-flowmusic": {"version": "lyria-3.5", "lyrics": "[Verse] Hello", "title": "Hello", "bpm": "120", "length": 60, "seed": "42"},
	}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/music/generations" || body["model"] != "flowmusic" || body["sound_prompt"] != "soft piano" || body["version"] != "lyria-3.5" || body["lyrics"] != "[Verse] Hello" || body["length"] != float64(60) {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	for _, field := range []string{"input", "voice", "response_format"} {
		if _, ok := body[field]; ok {
			t.Fatalf("unexpected %s in music request: %#v", field, body)
		}
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task_42", Request: request})
	if err != nil || poll.Path != "/v1/music/tasks/task_42" {
		t.Fatalf("poll = %#v, err = %v", poll, err)
	}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "flowmusic"}}); err == nil {
		t.Fatal("empty sound_prompt and lyrics accepted")
	}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "flowmusic", Prompt: "song", ProviderOptions: map[string]map[string]any{"apimart-flowmusic": {"length": 241}}}}); err == nil {
		t.Fatal("unsupported length accepted")
	}
	assertAPIMartMusicResponse(t, adapter)
}

func TestAPIMartSunoContract(t *testing.T) {
	adapter := apimartMusicAdapter(t, "apimart-suno")
	request := GenerationRequest{Model: "suno", Prompt: "[Verse] Hello", ProviderOptions: map[string]map[string]any{
		"apimart-suno": {"custom": true, "instrumental": false, "version": "v6", "title": "Hello", "style": "pop", "vocal_gender": "Female", "style_weight": 0.6, "audio_format": "wav", "duration": 120},
	}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/music/generations" || body["model"] != "suno" || body["prompt"] != "[Verse] Hello" || body["custom"] != true || body["version"] != "v6" || body["style"] != "pop" || body["duration"] != float64(120) {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	customModel := GenerationRequest{Model: "suno", Prompt: "instrumental", ProviderOptions: map[string]map[string]any{"apimart-suno": {"custom_model_id": "11111111-1111-1111-1111-111111111111"}}}
	customSpec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: customModel})
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := manifestTestBody(t, customSpec)["version"]; exists {
		t.Fatal("custom model request sent a public version")
	}
	for _, invalid := range []GenerationRequest{
		{Model: "suno"},
		{Model: "suno", Prompt: "song", ProviderOptions: map[string]map[string]any{"apimart-suno": {"version": "v5"}}},
		{Model: "suno", Prompt: "song", ProviderOptions: map[string]map[string]any{"apimart-suno": {"duration": 120}}},
		{Model: "suno", Prompt: "song", ProviderOptions: map[string]map[string]any{"apimart-suno": {"max_mode": true}}},
	} {
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: invalid}); err == nil {
			t.Fatalf("invalid Suno request accepted: %#v", invalid)
		}
	}
	assertAPIMartMusicResponse(t, adapter)
}

func assertAPIMartMusicResponse(t *testing.T, adapter Adapter) {
	t.Helper()
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"code":200,"data":[{"status":"submitted","task_id":"task_42"}]}`))
	if err != nil || created.TaskID != "task_42" || created.Status != StatusPending || created.Result != nil {
		t.Fatalf("create = %#v, err = %v", created, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_42"}, []byte(`{"code":200,"data":{"id":"task_42","status":"completed","result":{"music":[{"clip_id":"clip_1","audio_url":"https://cdn.example.com/song.mp3"}]}}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Audios) != 1 || completed.Result.Audios[0].URL != "https://cdn.example.com/song.mp3" || !completed.Result.Audios[0].Ephemeral {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_42"}, []byte(`{"code":200,"data":{"status":"failed","error":{"code":"moderation_failed","message":"blocked prompt"}}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "blocked prompt" || failed.Result != nil {
		t.Fatalf("failed = %#v, err = %v", failed, err)
	}
}
