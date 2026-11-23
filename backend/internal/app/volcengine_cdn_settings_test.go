package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

func volcengineCDNRequest() OSSSettingRequest {
	return OSSSettingRequest{
		Enabled: true, Provider: volcengineProvider, Region: "cn-guangzhou", Endpoint: "https://tos-s3-cn-guangzhou.volces.com",
		Bucket: "meiyeai-assets", AccessKeyID: "AK", AccessKeySecret: "SK", PathPrefix: "example-private/v1",
		CDNBaseURL: "https://service-caf3fbd3.example.invalid", CDNAuthMode: storage.CDNAuthVolcengineA, CDNPrimaryKey: "cdnkey123456", CDNURLTTLSeconds: 1800,
	}
}

func TestVolcengineCDNSettingValidation(t *testing.T) {
	next, err := ossSettingFromRequest(volcengineCDNRequest(), ossSettingValue{})
	if err != nil {
		t.Fatal(err)
	}
	if next.Delivery.CDNSignParam != "sign" || next.Delivery.CDNAuthAlgorithm != "sha256" || next.Delivery.CDNURLTTLSeconds != 1800 {
		t.Fatalf("defaults = %+v", next.Delivery)
	}
	for name, mutate := range map[string]func(*OSSSettingRequest){
		"aliyun provider": func(r *OSSSettingRequest) {
			r.Provider = aliyunOSSProvider
			r.Endpoint = "https://oss-cn-hangzhou.aliyuncs.com"
		},
		"missing CDN":      func(r *OSSSettingRequest) { r.CDNBaseURL = "" },
		"missing key":      func(r *OSSSettingRequest) { r.CDNPrimaryKey = "" },
		"short key":        func(r *OSSSettingRequest) { r.CDNPrimaryKey = "abc" },
		"bad algorithm":    func(r *OSSSettingRequest) { r.CDNAuthAlgorithm = "sha1" },
		"bad sign param":   func(r *OSSSettingRequest) { r.CDNSignParam = "x-tos-process" },
		"ttl out of range": func(r *OSSSettingRequest) { r.CDNURLTTLSeconds = 7200 },
	} {
		req := volcengineCDNRequest()
		mutate(&req)
		if _, err := ossSettingFromRequest(req, ossSettingValue{}); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	// 七牛签名仍只能用于七牛：火山 TOS 配置七牛模式时 SignCDNURL 必须失败而不是返回无效地址。
	if _, err := storage.SignCDNURL(storage.Settings{Provider: volcengineProvider, CDNBaseURL: "https://service-caf3fbd3.example.invalid", Delivery: storage.DeliverySettings{CDNAuthMode: "qiniu"}}, "a.png", nowPlusMinute()); err == nil {
		t.Fatal("qiniu signing accepted for TOS")
	}
	// 留空主 KEY 表示沿用已保存的 KEY。
	current := next
	req := volcengineCDNRequest()
	req.CDNPrimaryKey = ""
	kept, err := ossSettingFromRequest(req, current)
	if err != nil || kept.Delivery.CDNPrimaryKey != "cdnkey123456" {
		t.Fatalf("blank key must keep the saved key: %+v %v", kept.Delivery, err)
	}
	// 切回未配置时清除火山专用字段，测试摘要不受影响。
	req = volcengineCDNRequest()
	req.CDNAuthMode = ""
	plain, err := ossSettingFromRequest(req, current)
	if err != nil || plain.Delivery.CDNSignParam != "" || plain.Delivery.CDNAuthAlgorithm != "" {
		t.Fatalf("plain = %+v err=%v", plain.Delivery, err)
	}
	changed := next
	changed.Delivery.CDNAuthAlgorithm = "md5"
	if storageTestDigest(changed) == storageTestDigest(next) {
		t.Fatal("changing the CDN algorithm must require a new connection test")
	}
}

func TestVolcengineCDNCanaryLimitsOwners(t *testing.T) {
	t.Setenv("CANVAS_CDN_CANARY_BASE_URL", "https://service-caf3fbd3.example.invalid/")
	t.Setenv("CANVAS_CDN_CANARY_USER_IDS", "user-a, user-b")
	setting, err := ossSettingFromRequest(volcengineCDNRequest(), ossSettingValue{})
	if err != nil {
		t.Fatal(err)
	}
	if got := applyCDNCanary(setting, "user-a"); got.CDNBaseURL != "https://service-caf3fbd3.example.invalid" || got.Delivery.CDNAuthMode != storage.CDNAuthVolcengineA {
		t.Fatalf("canary owner lost CDN: %+v", got)
	}
	if got := applyCDNCanary(setting, "user-c"); got.CDNBaseURL != "" || got.Delivery.CDNAuthMode != "" || got.Delivery.RequireCDN {
		t.Fatalf("non-canary owner must keep the signed TOS origin: %+v", got)
	}
}

func TestPersonalTOSSettingInheritsPlatformVolcengineCDN(t *testing.T) {
	resource := &model.Resource{Provider: volcengineProvider, Endpoint: "https://tos-s3-cn-guangzhou.volces.com", Bucket: "meiyeai-assets", ObjectKey: "example-private/v1/users/a/image.png"}
	personal := ossSettingValue{Provider: volcengineProvider, Endpoint: resource.Endpoint, Bucket: resource.Bucket, AccessKeyID: "personal-id", AccessKeySecret: "personal-secret"}
	platform, err := ossSettingFromRequest(volcengineCDNRequest(), ossSettingValue{})
	if err != nil {
		t.Fatal(err)
	}
	platform.Delivery.RequireCDN = true
	got := inheritMatchingPlatformCDN(personal, platform, resource)
	if got.CDNBaseURL != "https://service-caf3fbd3.example.invalid" || got.Delivery.CDNAuthMode != storage.CDNAuthVolcengineA || got.AccessKeyID != "personal-id" {
		t.Fatalf("inherit = %+v", got)
	}
	other := *resource
	other.ObjectKey = "elsewhere/a.png"
	if got := inheritMatchingPlatformCDN(personal, platform, &other); got.CDNBaseURL != "" {
		t.Fatal("objects outside the platform prefix must not inherit the platform CDN")
	}
}

func nowPlusMinute() time.Time { return time.Now().Add(time.Minute) }
