package protocol

import (
	"context"
	"net/url"
	"testing"
)

func TestTopViewKlingUsesDocumentedDisplayName(t *testing.T) {
	a := officialPackageAdapter(t, "topview.yingce-plugin", "topview-video")
	for _, name := range []string{"kling-4.0", " KLING-4.0 ", "Kling 4.0", "Kling V3"} {
		req, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: name, Prompt: "A paper boat", Duration: 3, Resolution: "720p", AspectRatio: "16:9"}})
		if err != nil {
			t.Fatal(err)
		}
		expected := "Kling 4.0"
		if name == "Kling V3" {
			expected = name
		}
		if body := manifestTestBody(t, req); body["model"] != expected {
			t.Fatalf("model %q: %#v", name, body)
		}
	}
}

func TestTopViewKlingVideoReferenceUsesOmniDisplayName(t *testing.T) {
	a := officialPackageAdapter(t, "topview.yingce-plugin", "topview-video")
	for _, name := range []string{"kling-4.0", "Kling 4.0", "kling-v4-omni", "Kling 4.0 Omni"} {
		req, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: name, Prompt: "Replace the product in @视频1 using @图片1", Duration: 20, AspectRatio: "16:9", Resolution: "720p", Videos: []MediaReference{{Kind: "video", URL: "https://media.example/reference.mp4", Metadata: map[string]any{MediaUploadIDKey: "video-file"}}}, Images: []MediaReference{{Kind: "image", Role: "reference_image", URL: "https://media.example/product.png", Metadata: map[string]any{MediaUploadIDKey: "image-file"}}}}})
		if err != nil {
			t.Fatal(err)
		}
		if req.Path != "/v1/common_task/omni_reference/task/submit" || manifestTestBody(t, req)["model"] != "Kling 4.0 Omni" {
			t.Fatalf("wrong video-edit request: %#v", req)
		}
	}
}

// 原片编辑：TopView 的 Seedance 判为视频编辑时只接受 duration=-1；宿主通过 providerOptions 覆盖，普通请求仍发正整数。
func TestTopViewSeedanceEditDurationFollowsProviderOption(t *testing.T) {
	a := officialPackageAdapter(t, "topview.yingce-plugin", "topview-video")
	video := []MediaReference{{Kind: "video", URL: "https://media.example/clip.mp4", Metadata: map[string]any{MediaUploadIDKey: "video-file"}}}
	for _, tc := range []struct {
		options map[string]map[string]any
		want    float64
	}{
		{nil, 5},
		{map[string]map[string]any{"topview-video": {"duration": -1}}, -1},
	} {
		req, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "Seedance 2.5", Prompt: "以 @视频1 为底只替换商品", Duration: 5, AspectRatio: "9:16", Videos: video, ProviderOptions: tc.options}})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, req)
		if req.Path != "/v1/common_task/omni_reference/task/submit" || body["duration"] != tc.want {
			t.Fatalf("options %v: path %s duration %#v", tc.options, req.Path, body["duration"])
		}
	}
}

func TestTopViewSubmitSuccessWithoutMediaContinuesPolling(t *testing.T) {
	ctx := context.Background()
	for _, provider := range []string{"topview-video", "topview-image", "topview-tts"} {
		t.Run(provider, func(t *testing.T) {
			a := officialPackageAdapter(t, "topview.yingce-plugin", provider)
			body := []byte(`{"code":"200","result":{"status":"success","taskId":"accepted-task","errorMsg":null}}`)
			created, err := a.ParseCreate(ctx, body)
			if err != nil || created.Status != StatusPending || created.TaskID == "" || created.Message != "" {
				t.Fatalf("accepted submission = %#v, %v", created, err)
			}
			poll, err := a.BuildPoll(ctx, PollContext{TaskID: created.TaskID})
			if err != nil || url.Values(poll.Query).Get("taskId") != "accepted-task" {
				t.Fatalf("poll = %#v, %v", poll, err)
			}
			missing, err := a.ParsePoll(ctx, PollContext{TaskID: created.TaskID}, body)
			if err != nil || missing.Status != StatusFailed || missing.Message == "" {
				t.Fatalf("missing final output = %#v, %v", missing, err)
			}
			failed, err := a.ParseCreate(ctx, []byte(`{"code":"4004","message":"Task not found"}`))
			if err != nil || failed.Status != StatusFailed {
				t.Fatalf("business failure = %#v, %v", failed, err)
			}
		})
	}
}

func TestTopViewVideoPollReturnsDownloadableResult(t *testing.T) {
	a := officialPackageAdapter(t, "topview.yingce-plugin", "topview-video")
	ctx := context.Background()
	for _, id := range []string{"t2v:accepted-task", "i2v:accepted-task", "omni:accepted-task"} {
		result, err := a.ParsePoll(ctx, PollContext{TaskID: id}, []byte(`{"code":"200","result":{"taskId":"accepted-task","status":"success","videos":[{"status":"success","filePath":"https://cdn.example/finished.mp4"}]}}`))
		if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || !result.Result.Videos[0].Ephemeral {
			t.Fatalf("video result = %#v, %v", result, err)
		}
	}
}
