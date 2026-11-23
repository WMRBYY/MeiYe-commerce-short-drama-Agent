package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

func TestPrivateAliyunNativeImageVideoAndUploadStorage(t *testing.T) {
	svc := newResourceTestService(t)
	setting := ossSettingValue{Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "private-test", PathPrefix: "example-private/v1", AccessKeyID: "test-id", AccessKeySecret: "test-secret", Delivery: storage.DeliverySettings{PrivateMediaProxy: true}}
	encoded, _ := json.Marshal(setting)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	originalPut := putOSSObject
	t.Cleanup(func() { putOSSObject = originalPut })
	var uploads []string
	putOSSObject = func(_ storage.Settings, key, _ string, _ int64, reader io.Reader) (string, error) {
		if _, err := io.Copy(io.Discard, reader); err != nil {
			return "", err
		}
		uploads = append(uploads, key)
		return "isolated-etag", nil
	}
	for _, media := range []struct{ mime, kind string }{{"image/png", "image"}, {"video/mp4", "video"}} {
		payload := []byte("isolated-" + media.kind)
		result, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{"dataUrl": "data:" + media.mime + ";base64," + base64.StdEncoding.EncodeToString(payload)})
		if err != nil {
			t.Fatal(err)
		}
		id, _ := result["resourceId"].(string)
		resource, err := svc.repo.Resource(id)
		if err != nil || resource.Provider != aliyunOSSProvider || resource.Kind != media.kind || !strings.HasPrefix(resource.ObjectKey, "example-private/v1/users/user-1/") {
			t.Fatalf("generated %s = %#v, %v", media.kind, resource, err)
		}
		if result["url"] != resourceFileURL(id) {
			t.Fatalf("generated URL = %#v", result)
		}
	}
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kZkAAAAASUVORK5CYII=")
	upload, err := svc.UploadResourceFile("user-1", "test.png", int64(len(png)), "image", 1, 1, 0, bytes.NewReader(png))
	if err != nil || upload.Provider != aliyunOSSProvider || upload.Status != model.ResourceStatusReady {
		t.Fatalf("user upload = %#v, %v", upload, err)
	}
	if len(uploads) != 3 {
		t.Fatalf("OSS uploads = %d, want generated image, generated video and user image", len(uploads))
	}
}

func TestPrivateAliyunResourceAccessKeepsOwnerAndAuthenticatedURL(t *testing.T) {
	svc, _ := newResourceFallbackTestService(t)
	setting := ossSettingValue{Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "private-test", AccessKeyID: "test-id", AccessKeySecret: "test-secret", Delivery: storage.DeliverySettings{PrivateMediaProxy: true}}
	encoded, _ := json.Marshal(setting)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{ID: newID(), UserID: "owner-1", Kind: "image", Status: model.ResourceStatusReady, Provider: aliyunOSSProvider, Endpoint: setting.Endpoint, Bucket: setting.Bucket, ObjectKey: "private/users/owner-1/image.png", MimeType: "image/png", Size: 3}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	result, err := svc.ResourceAccessBatch(resource.UserID, []ResourceAccessRequest{{ResourceID: resource.ID, AccessOptions: ResourceAccessOptions{Purpose: assets.PurposeDisplay}}})
	if err != nil || len(result) != 1 || result[0].Access == nil {
		t.Fatalf("owner access = %#v, %v", result, err)
	}
	access := result[0].Access
	if access.Delivery != assets.DeliveryProxy || !strings.HasPrefix(access.URL, "/api/resources/"+resource.ID+"/file") || strings.Contains(access.URL, "OSSAccessKeyId") {
		t.Fatalf("private access descriptor = %#v", access)
	}
	other, err := svc.ResourceAccessBatch("other-user", []ResourceAccessRequest{{ResourceID: resource.ID}})
	if err != nil || len(other) != 1 || other[0].Access != nil {
		t.Fatalf("cross-user access = %#v, %v", other, err)
	}
	if _, err := svc.ResourceAccessBatch("", []ResourceAccessRequest{{ResourceID: resource.ID}}); err == nil {
		t.Fatal("anonymous access was accepted")
	}
	expired := strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10)
	signature, err := svc.signPublicResource(resource.ID+"\n"+string(assets.VariantOriginal), expired)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PreparePublicResourceDelivery(resource.ID, expired, signature, ResourceAccessOptions{Variant: assets.VariantOriginal}, ""); err == nil {
		t.Fatal("expired bearer link was accepted")
	}
}

func TestLocalResourceMigrationVerifiesAndRollsBackWithoutDeletingBytes(t *testing.T) {
	svc, _ := newResourceFallbackTestService(t)
	setting := ossSettingValue{Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "private-test", PathPrefix: "example-private/v1", AccessKeyID: "test-id", AccessKeySecret: "test-secret", StorageLocationID: newID(), Delivery: storage.DeliverySettings{PrivateMediaProxy: true}}
	encoded, _ := json.Marshal(setting)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	locationValue := setting
	locationValue.StorageLocationID = ""
	locationJSON, _ := json.Marshal(locationValue)
	if err := svc.repo.CreateStorageLocation(&model.StorageLocation{ID: setting.StorageLocationID, Scope: "platform", Provider: aliyunOSSProvider, ValueJSON: string(locationJSON)}); err != nil {
		t.Fatal(err)
	}
	body := []byte("isolated nonproduction video bytes")
	resource := &model.Resource{ID: newID(), UserID: "owner-1", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/owner-1/video/test.mp4", MimeType: "video/mp4", Size: int64(len(body)), PlaybackStatus: model.PlaybackStatusReady, PlaybackObjectKey: "test-playback.mp4"}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	local := filepath.Join(svc.dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
	if err := os.MkdirAll(filepath.Dir(local), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(local, body, 0o640); err != nil {
		t.Fatal(err)
	}
	playbackPath := filepath.Join(svc.dataDir, playbackDirName, resource.PlaybackObjectKey)
	if err := os.MkdirAll(filepath.Dir(playbackPath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(playbackPath, []byte("isolated h264 playback"), 0o640); err != nil {
		t.Fatal(err)
	}
	originalPut, originalGet := putOSSObject, getOriginOSSObjectRange
	t.Cleanup(func() { putOSSObject, getOriginOSSObjectRange = originalPut, originalGet })
	var uploaded []byte
	putOSSObject = func(_ storage.Settings, _ string, _ string, _ int64, reader io.Reader) (string, error) {
		uploaded, _ = io.ReadAll(reader)
		return "test-etag", nil
	}
	getOriginOSSObjectRange = func(_ storage.Settings, _ string, _ string) (*storage.ObjectStream, error) {
		return &storage.ObjectStream{Body: io.NopCloser(bytes.NewReader(uploaded)), StatusCode: http.StatusOK}, nil
	}
	manifest := filepath.Join(t.TempDir(), "resource.json")
	entry, err := svc.MigrateLocalResourceToPrivateOSS(resource.UserID, resource.ID, t.TempDir(), manifest)
	if err != nil {
		t.Fatal(err)
	}
	if entry.State != "committed" || !bytes.Equal(uploaded, body) {
		t.Fatalf("migration = %#v", entry)
	}
	if entry.PlaybackKey != resource.PlaybackObjectKey || entry.PlaybackBackup == "" {
		t.Fatalf("playback backup missing: %#v", entry)
	}
	migrated, err := svc.repo.Resource(resource.ID)
	if err != nil || migrated.Provider != aliyunOSSProvider || migrated.ID != resource.ID || migrated.PlaybackObjectKey != resource.PlaybackObjectKey {
		t.Fatalf("migrated resource = %#v, %v", migrated, err)
	}
	if access, err := assets.ResolveAccess(migrated, setting, assets.AccessOptions{Variant: assets.VariantPlayback}, migrated.CreatedAt.AddDate(1, 0, 0), func(assets.ResourceVariant, time.Time) (string, error) {
		return "/api/resources/" + migrated.ID + "/file", nil
	}); err != nil || access.ActualVariant != assets.VariantPlayback {
		t.Fatalf("historical playback = %#v, %v", access, err)
	}
	playback, err := svc.OpenResourcePlaybackRange(resource.UserID, resource.ID)
	if err != nil {
		t.Fatal(err)
	}
	playbackBytes, _ := io.ReadAll(playback.Body)
	playback.Body.Close()
	if string(playbackBytes) != "isolated h264 playback" {
		t.Fatalf("historical playback bytes = %q", playbackBytes)
	}
	if err := svc.RollbackPrivateOSSMigration(*entry); err != nil {
		t.Fatal(err)
	}
	rolledBack, _ := svc.repo.Resource(resource.ID)
	if rolledBack.Provider != "local" || rolledBack.ObjectKey != resource.ObjectKey {
		t.Fatalf("rollback = %#v", rolledBack)
	}
	if _, err := os.Stat(local); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(entry.BackupPath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(entry.PlaybackBackup); err != nil {
		t.Fatal(err)
	}
}
