package app

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

func TestInspirationVideoCDNURLStaysInLicensedCatalogPrefix(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: "aliyun", Endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
		Bucket: "private-bucket", PathPrefix: "private/v1", CDNBaseURL: "https://media.example.com",
		AccessKeyID: "test-id", AccessKeySecret: "test-secret",
		Delivery: storage.DeliverySettings{CDNAuthMode: "aliyun_a", CDNPrimaryKey: "testcdnkey123", CDNURLTTLSeconds: 300, RequireCDN: true},
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	value, err := svc.InspirationVideoCDNURL(digest)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host != "media.example.com" || parsed.Path != "/private/v1/inspirations/seedance/"+digest+".mp4" || parsed.Query().Get("auth_key") == "" {
		t.Fatalf("unexpected catalog CDN URL: %q (%v)", value, err)
	}
	for _, invalid := range []string{"../users/owner/image", strings.Repeat("A", 64), strings.Repeat("z", 64)} {
		if _, err := svc.InspirationVideoCDNURL(invalid); err == nil {
			t.Fatalf("accepted invalid digest %q", invalid)
		}
	}
}
