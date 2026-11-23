package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

func TestInheritMatchingPlatformCDN(t *testing.T) {
	resource := &model.Resource{Provider: "aliyun", Endpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "private-media", ObjectKey: "private/v1/users/a/image.png"}
	personal := ossSettingValue{Provider: "aliyun", Endpoint: resource.Endpoint, Bucket: resource.Bucket, CDNBaseURL: "https://media.example.com", AccessKeyID: "personal-id", AccessKeySecret: "personal-secret"}
	platform := ossSettingValue{Enabled: true, Provider: "aliyun", Endpoint: resource.Endpoint, Bucket: resource.Bucket, PathPrefix: "private/v1", CDNBaseURL: "https://media.example.com", Delivery: storage.DeliverySettings{CDNAuthMode: "aliyun_a", CDNPrimaryKey: "platform-key", RequireCDN: true, CDNURLTTLSeconds: 300}}
	got := inheritMatchingPlatformCDN(personal, platform, resource)
	if got.Delivery.CDNAuthMode != "aliyun_a" || got.Delivery.CDNPrimaryKey != "platform-key" || got.Delivery.CDNURLTTLSeconds != 300 || got.AccessKeyID != "personal-id" || got.AccessKeySecret != "personal-secret" {
		t.Fatal("same-location private media did not inherit CDN while preserving personal OSS credentials")
	}
	for name, mutate := range map[string]func(*ossSettingValue, *model.Resource){
		"other bucket": func(_ *ossSettingValue, r *model.Resource) { r.Bucket = "other" },
		"outside prefix": func(_ *ossSettingValue, r *model.Resource) { r.ObjectKey = "other/image.png" },
		"different CDN": func(s *ossSettingValue, _ *model.Resource) { s.CDNBaseURL = "https://personal.example.com" },
		"private proxy": func(s *ossSettingValue, _ *model.Resource) { s.Delivery.PrivateMediaProxy = true },
	} {
		t.Run(name, func(t *testing.T) {
			s, r := personal, *resource
			mutate(&s, &r)
			if actual := inheritMatchingPlatformCDN(s, platform, &r); actual.Delivery.CDNAuthMode != "" || actual.Delivery.CDNPrimaryKey != "" {
				t.Fatal("unrelated personal media received platform CDN credentials")
			}
		})
	}
}
