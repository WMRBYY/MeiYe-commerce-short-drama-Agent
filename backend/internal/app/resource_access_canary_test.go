package app

import (
	"testing"

	"yingce/backend/internal/storage"
)

func TestApplyCDNCanaryScopesOnlySelectedDomainAndOwner(t *testing.T) {
	t.Setenv("CANVAS_CDN_CANARY_BASE_URL", "https://service-32b21ee7.example.invalid")
	t.Setenv("CANVAS_CDN_CANARY_USER_IDS", "user-a, user-b")
	setting := ossSettingValue{
		Provider:   aliyunOSSProvider,
		Endpoint:   "https://oss-cn-hangzhou.aliyuncs.com",
		CDNBaseURL: "https://service-32b21ee7.example.invalid",
		Delivery:   storage.DeliverySettings{CDNAuthMode: "aliyun_a", CDNPrimaryKey: "test-key", RequireCDN: true},
	}
	allowed := applyCDNCanary(setting, "user-b")
	if allowed.CDNBaseURL != setting.CDNBaseURL || allowed.Delivery.CDNAuthMode != "aliyun_a" || !allowed.Delivery.RequireCDN {
		t.Fatal("allowed owner lost CDN delivery")
	}
	other := applyCDNCanary(setting, "user-c")
	if other.CDNBaseURL != "" || other.Delivery.CDNAuthMode != "" || other.Delivery.RequireCDN {
		t.Fatal("unlisted owner received CDN delivery")
	}
	if !storage.PublicOrigin(storage.Settings{Provider: other.Provider, Endpoint: other.Endpoint}) {
		t.Fatal("unlisted owner lost current signed OSS origin delivery")
	}
	personal := setting
	personal.CDNBaseURL = "https://personal.example.com"
	if got := applyCDNCanary(personal, "user-c"); got.CDNBaseURL != personal.CDNBaseURL || got.Delivery.CDNAuthMode != "aliyun_a" {
		t.Fatal("canary altered an unrelated CDN domain")
	}
}
