package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/storage"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMissingOSSSettingsReturnNormalizedDefaults(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}

	platformSetting, err := svc.AdminOSSSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	assertDefaultOSSSetting(t, platformSetting)

	userSetting, err := svc.UserOSSSetting(&model.User{ID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	assertDefaultOSSSetting(t, userSetting)
}

func TestAliyunCDNKeysStayEncryptedAndBlankEditPreservesThem(t *testing.T) {
	svc := &Service{dataDir: t.TempDir()}
	current := ossSettingValue{Provider: aliyunOSSProvider, Delivery: storage.DeliverySettings{CDNAuthMode: "aliyun_a", CDNPrimaryKey: "Primary123", CDNBackupKey: "Backup123", CDNURLTTLSeconds: 300}}
	next, err := ossSettingFromRequest(OSSSettingRequest{Provider: aliyunOSSProvider, CDNAuthMode: "public", CDNURLTTLSeconds: 300}, current)
	if err != nil {
		t.Fatal(err)
	}
	if next.Delivery.CDNPrimaryKey != "Primary123" || next.Delivery.CDNBackupKey != "Backup123" {
		t.Fatal("blank unrelated edit cleared a configured CDN key")
	}
	stored, err := svc.encryptOSSSettingSecrets(next)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "Primary123") || strings.Contains(string(encoded), "Backup123") {
		t.Fatal("CDN key stored in clear text")
	}
	if _, err := svc.decryptOSSSettingSecrets(&stored); err != nil || stored.Delivery.CDNPrimaryKey != "Primary123" || stored.Delivery.CDNBackupKey != "Backup123" {
		t.Fatal("CDN key decryption failed")
	}
}

func assertDefaultOSSSetting(t *testing.T, value *PublicOSSSetting) {
	t.Helper()
	if value.Provider != aliyunOSSProvider || value.PathPrefix != defaultOSSPathPrefix || value.S3Preset != "custom" {
		t.Fatalf("default OSS setting = %+v", value)
	}
}
