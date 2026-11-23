package assets

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound/outboundtest"
	"yingce/backend/internal/storage"
)

func testVolcengineResource(mime string, size int64) *model.Resource {
	kind := "image"
	if strings.HasPrefix(mime, "video/") {
		kind = "video"
	}
	return &model.Resource{
		ID: "resource-tos", UserID: "user-1", Provider: "volcengine", Endpoint: "https://tos-s3-cn-guangzhou.volces.com", Bucket: "meiyeai-assets",
		ObjectKey: "example-private/v1/users/user-1/image/a.png", Status: model.ResourceStatusReady, Kind: kind, MimeType: mime, Size: size, ETag: "etag",
	}
}

func testVolcengineSetting(mode string) storage.Settings {
	return storage.Settings{
		Provider: "volcengine", Region: "cn-guangzhou", Endpoint: "https://tos-s3-cn-guangzhou.volces.com", Bucket: "meiyeai-assets",
		CDNBaseURL: "https://service-caf3fbd3.example.invalid", AccessKeyID: "AK", AccessKeySecret: "SK", PathPrefix: "example-private/v1",
		Delivery: storage.DeliverySettings{CDNAuthMode: mode, CDNPrimaryKey: "cdnkey123456", CDNURLTTLSeconds: 1800, CDNAuthAlgorithm: "sha256"},
	}
}

func noPlatformURL(ResourceVariant, time.Time) (string, error) {
	return "https://canvas.example/api/resources/resource-tos/file", nil
}

func TestVolcengineSignedCDNDeliveryPolicy(t *testing.T) {
	outboundtest.PublicDNS(t, "tos-s3-cn-guangzhou.volces.com")
	now := time.Now().UTC()
	setting := testVolcengineSetting(storage.CDNAuthVolcengineA)

	display, err := ResolveAccess(testVolcengineResource("image/png", 8*1024*1024), setting, AccessOptions{Purpose: PurposeDisplay}, now, noPlatformURL)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(display.URL)
	if display.Delivery != DeliveryCDN || u.Host != "service-caf3fbd3.example.invalid" || u.Path != "/example-private/v1/users/user-1/image/a.png" || u.Query().Get("sign") == "" {
		t.Fatalf("display = %+v", display)
	}
	if strings.Contains(display.URL, "X-Amz-") || strings.Contains(display.URL, "volces.com") {
		t.Fatalf("CDN URL must not carry TOS SigV4 or the origin host: %s", display.URL)
	}
	if display.ExpiresAt == nil || display.ExpiresAt.After(now.Add(1800*time.Second)) || display.ExpiresAt.Before(now.Add(1350*time.Second)) {
		t.Fatalf("expiry must follow the CDN TTL window: %v", display.ExpiresAt)
	}

	_, err = ResolveAccess(testVolcengineResource("image/jpeg", 8*1024*1024), setting, AccessOptions{Purpose: PurposeDisplay, Variant: VariantThumbnailSmall}, now, noPlatformURL)
	if err == nil || errorReason(err) != "resource_thumbnail_unavailable" {
		t.Fatalf("thumbnail must fail closed without a local copy: %v", err)
	}
	thumbnailResource := testVolcengineResource("image/jpeg", 8*1024*1024)
	thumbnailResource.ThumbnailStatus = model.ThumbnailStatusReady
	thumbnailResource.ThumbnailMimeType = "image/jpeg"
	thumb, err := ResolveAccess(thumbnailResource, setting, AccessOptions{Purpose: PurposeDisplay, Variant: VariantThumbnailSmall}, now, noPlatformURL)
	if err != nil || thumb.ActualVariant != VariantThumbnailSmall || thumb.Delivery != DeliveryLocal || thumb.URL != "https://canvas.example/api/resources/resource-tos/file" {
		t.Fatalf("local thumbnail = %+v err=%v", thumb, err)
	}

	download, err := ResolveAccess(testVolcengineResource("image/png", 1024), setting, AccessOptions{Purpose: PurposeDownload, DownloadName: "a.png"}, now, noPlatformURL)
	if err != nil || download.Delivery != DeliveryCDN || !strings.Contains(download.URL, "response-content-disposition=attachment") {
		t.Fatalf("download = %+v err=%v", download, err)
	}

	video, err := ResolveAccess(testVolcengineResource("video/mp4", 1024), setting, AccessOptions{Purpose: PurposeDisplay, Variant: VariantPlayback}, now, noPlatformURL)
	if err != nil || video.Delivery != DeliveryCDN || video.ActualVariant != VariantOriginal || !strings.HasPrefix(video.URL, "https://service-caf3fbd3.example.invalid/") {
		t.Fatalf("video = %+v err=%v", video, err)
	}

	provider, err := ResolveAccess(testVolcengineResource("image/png", 1024), setting, AccessOptions{Purpose: PurposeProvider}, now, noPlatformURL)
	if err != nil || provider.Delivery != DeliveryOrigin || !strings.Contains(provider.URL, "meiyeai-assets.tos-s3-cn-guangzhou.volces.com") {
		t.Fatalf("server-side provider input must keep the TOS presigned origin: %+v err=%v", provider, err)
	}
}

func TestVolcengineWithoutCDNAuthKeepsSignedOrigin(t *testing.T) {
	outboundtest.PublicDNS(t, "tos-s3-cn-guangzhou.volces.com")
	access, err := ResolveAccess(testVolcengineResource("image/png", 1024), testVolcengineSetting(""), AccessOptions{Purpose: PurposeDisplay}, time.Now().UTC(), noPlatformURL)
	if err != nil {
		t.Fatal(err)
	}
	if access.Delivery != DeliveryOrigin || access.FallbackReason != "cdn_auth_unconfigured" || !strings.Contains(access.URL, "meiyeai-assets.tos-s3-cn-guangzhou.volces.com") {
		t.Fatalf("未配置 CDN 鉴权时必须继续使用 TOS 预签名源站，不能把私有对象暴露为公开 CDN: %+v", access)
	}
	if _, err := ResolveAccess(testVolcengineResource("image/png", 1024), testVolcengineSetting(storage.CDNAuthAliyunA), AccessOptions{Purpose: PurposeDisplay}, time.Now().UTC(), noPlatformURL); err == nil {
		t.Fatal("aliyun_a must not sign Volcengine objects")
	}
}
