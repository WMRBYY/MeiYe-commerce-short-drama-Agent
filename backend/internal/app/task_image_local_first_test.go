package app

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"
)

func TestGeneratedPlatformImageStoresLocallyBeforeObjectUpload(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	picture := mediaTestPNG(t)
	name, err := s.stageInlineMedia(picture)
	if err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{ID: newID(), UserID: task.UserID, Kind: "image", Provider: "aliyun", Endpoint: "https://storage.example.invalid", Bucket: "platform", ObjectKey: "images/result.png", MimeType: "image/png", Size: int64(len(picture))}
	var cause error
	if _, err := s.taskMediaObjectWriter(task, s.mediaTempPath(name), &cause)(resource, "generated.png", bytes.NewReader(picture)); err != nil {
		t.Fatal(err)
	}
	if resource.Provider != "local" || cause != nil {
		t.Fatal("image blocked on remote storage")
	}
	got, err := os.ReadFile(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
	if err != nil || !bytes.Equal(got, picture) {
		t.Fatalf("local image not durable: %v", err)
	}
	var job model.ResourceOffloadJob
	if err := db.Where("resource_id = ?", resource.ID).First(&job).Error; err != nil {
		t.Fatal(err)
	}
	if job.TargetProvider != "aliyun" || job.TargetObjectKey != "images/result.png" || job.Status != model.ResourceOffloadStatusPending || job.LastError != "" {
		t.Fatalf("invalid background upload: %+v", job)
	}
}
