package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestTaskImagePreviewStagedBeforeSavingAndOwnership(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	picture := mediaTestPNG(t)
	name, err := s.stageInlineMedia(picture)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: name, MIMEType: "image/png"}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenTaskImagePreview(context.Background(), "other-user", task.ID); err == nil {
		t.Fatal("foreign preview was accessible")
	}
	stream, err := s.OpenTaskImagePreview(context.Background(), task.UserID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	got, err := io.ReadAll(stream.Body)
	if err != nil || string(got) != string(picture) {
		t.Fatalf("preview mismatch: %v", err)
	}
	saved, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Status != model.TaskStatusRunning || saved.MediaStage != "upload" {
		t.Fatal("preview changed task state")
	}
	if taskForOutput(*saved).PreviewURL == "" || taskSummaryForOutput(*saved).PreviewURL == "" {
		t.Fatal("saving preview missing from task projections")
	}
	saved.MediaStage = "completed"
	if taskSavingImagePreview(*saved) != "" {
		t.Fatal("completed task still advertises temporary preview")
	}
}

func TestTaskImagePreviewDoesNotRefetchUpstreamWhileDownloading(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db := newMediaRecoveryTestService(t)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		_, _ = w.Write(mediaTestPNG(t))
	}))
	defer server.Close()
	task := seedMediaTask(t, db, providerConfig{BaseURL: server.URL})
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{Reference: protocol.MediaReference{URL: server.URL + "/result?token=private"}}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "download"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(taskSummaryForOutput(*task).PreviewURL, "private") {
		t.Fatal("source leaked")
	}
	if _, err := s.OpenTaskImagePreview(context.Background(), task.UserID, task.ID); !errors.Is(err, errTaskPreviewNotReady) {
		t.Fatalf("downloading preview should report not ready, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("preview re-fetched upstream %d times", requests)
	}
}

func TestTaskImagePreviewDownscalesLargeStagedImage(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 3840, 2160))); err != nil {
		t.Fatal(err)
	}
	name, err := s.stageInlineMedia(encoded.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: name, MIMEType: "image/png"}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		stream, err := s.OpenTaskImagePreview(context.Background(), task.UserID, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(stream.Body)
		stream.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		config, _, err := image.DecodeConfig(bytes.NewReader(got))
		if err != nil || config.Width != taskPreviewMaxEdge || config.Height != 720 {
			t.Fatalf("preview not downscaled: %dx%d %v", config.Width, config.Height, err)
		}
	}
}

func TestTaskImagePreviewAfterStagingHandoff(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	picture := mediaTestPNG(t)
	name, err := s.stageInlineMedia(picture)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: name, MIMEType: "image/png"}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.materializeTaskMedia(context.Background(), task, providerConfig{}, checkpoint); err != nil {
		t.Fatal(err)
	}
	if checkpoint.Items[0].TempName != "" || checkpoint.Items[0].ResourceID == "" {
		t.Fatal("handoff did not complete")
	}
	stream, err := s.OpenTaskImagePreview(context.Background(), task.UserID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	got, err := io.ReadAll(stream.Body)
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(got))
	if err != nil || config.Width != 2 || config.Height != 3 {
		t.Fatalf("handoff lost pixels: %d bytes, %v", len(got), err)
	}
}
