package app

import (
	"context"
	"testing"
)

func TestReferencePreviewSaveAndClip(t *testing.T) {
	requireFFmpegTools(t)
	svc, _ := newVideoLinkTestService(t, videoLinkTestMedia(t))
	ctx := context.Background()
	preview, err := svc.ImportMediaReferenceWithProgress(ctx, "owner", MediaReferenceLinkInput{URL: "https://v.kuaishou.com/2Bd8Xx"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if preview.AssetID != "" || preview.Source.SizeBytes <= 0 {
		t.Fatalf("unexpected preview %+v", preview)
	}
	id, err := svc.SaveMediaReference("owner", preview.ResourceID, preview.Source)
	if err != nil {
		t.Fatal(err)
	}
	again, err := svc.SaveMediaReference("owner", preview.ResourceID, preview.Source)
	if err != nil || again != id {
		t.Fatalf("repeat save %q %v", again, err)
	}
	input := ReferenceClipInput{ResourceID: preview.ResourceID, StartMs: 720, EndMs: 4720}
	if _, err := svc.ClipMediaReference(ctx, "other", input, nil); err == nil {
		t.Fatal("accepted another user's video")
	}
	last := -1.
	clip, err := svc.ClipMediaReference(ctx, "owner", input, func(e VideoLinkEvent) {
		if e.Progress < last {
			t.Fatalf("progress decreased %v", e)
		}
		last = e.Progress
	})
	if err != nil {
		t.Fatal(err)
	}
	if last <= 0 || clip.ResourceID == preview.ResourceID || clip.Source.DurationMs < 3950 || clip.Source.DurationMs > 4050 || !clip.Source.HasAudio || clip.Source.Width != 320 || clip.Source.Height != 240 || clip.Source.SizeBytes <= 0 {
		t.Fatalf("invalid excerpt %+v progress %f", clip, last)
	}
	t.Logf("5 s -> %d ms, %dx%d, audio=%v, bytes=%d, encoding progress %.0f%%", clip.Source.DurationMs, clip.Source.Width, clip.Source.Height, clip.Source.HasAudio, clip.Source.SizeBytes, 100*last)
}
