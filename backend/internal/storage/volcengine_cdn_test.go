package storage

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testVolcengineCDNSetting(algorithm string) Settings {
	return Settings{
		Provider: "volcengine", Region: "cn-guangzhou", Endpoint: "https://tos-s3-cn-guangzhou.volces.com", Bucket: "meiyeai-assets",
		CDNBaseURL: "https://service-caf3fbd3.example.invalid", AccessKeyID: "AK", AccessKeySecret: "SK",
		Delivery: DeliverySettings{CDNAuthMode: CDNAuthVolcengineA, CDNPrimaryKey: "abc123def456", CDNURLTTLSeconds: 300, CDNAuthAlgorithm: algorithm},
	}
}

// 官方文档（docs/6454/1129831 与 docs/4/174054）给出的 A 类型示例：
// md5(/img/volcano.png-1644406401-2e1ca42a1bb248408fc9cf435e5af744-0-abc123def456)
// = 54959c1ec3448bf8e992554476248fab。
func TestVolcengineCDNASignatureMatchesOfficialExample(t *testing.T) {
	got, err := volcengineCDNASignature(VolcengineCDNAlgorithmMD5, "/img/volcano.png", "1644406401", "2e1ca42a1bb248408fc9cf435e5af744", "0", "abc123def456")
	if err != nil {
		t.Fatal(err)
	}
	if got != "54959c1ec3448bf8e992554476248fab" {
		t.Fatalf("signature = %s", got)
	}
	sha, err := volcengineCDNASignature(VolcengineCDNAlgorithmSHA256, "/img/volcano.png", "1644406401", "2e1ca42a1bb248408fc9cf435e5af744", "0", "abc123def456")
	want := sha256.Sum256([]byte("/img/volcano.png-1644406401-2e1ca42a1bb248408fc9cf435e5af744-0-abc123def456"))
	if err != nil || sha != hex.EncodeToString(want[:]) || len(sha) != 64 {
		t.Fatalf("sha256 signature = %s err=%v", sha, err)
	}
	if _, err := volcengineCDNASignature("sha1", "/a", "1", "r", "0", "abc123def456"); err == nil {
		t.Fatal("unsupported algorithm accepted")
	}
}

func parseVolcengineSign(t *testing.T, raw string, param string) (*url.URL, []string) {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(u.Query().Get(param), "-")
	if len(parts) != 4 {
		t.Fatalf("sign parameter malformed: %s", raw)
	}
	return u, parts
}

func TestSignedVolcengineCDNAURLBindsPathAndWindow(t *testing.T) {
	setting := testVolcengineCDNSetting(VolcengineCDNAlgorithmMD5)
	expires := time.Now().Add(200 * time.Second).Truncate(time.Second)
	key := "example-private/v1/users/u1/image/a.png"
	raw, err := SignedVolcengineCDNAURL(setting, key, expires)
	if err != nil {
		t.Fatal(err)
	}
	u, parts := parseVolcengineSign(t, raw, "sign")
	if u.Host != "service-caf3fbd3.example.invalid" || u.Path != "/"+key || len(u.Query()) != 1 {
		t.Fatalf("unexpected URL %s", raw)
	}
	if parts[0] != strconv.FormatInt(expires.Unix()-300, 10) {
		t.Fatalf("timestamp must be the start of the validity window: %s", parts[0])
	}
	if parts[2] != "0" || len(parts[1]) != volcengineCDNRandLength {
		t.Fatalf("uid/rand invalid: %v", parts)
	}
	sum := md5.Sum([]byte("/" + key + "-" + parts[0] + "-" + parts[1] + "-0-abc123def456"))
	if parts[3] != hex.EncodeToString(sum[:]) {
		t.Fatalf("hash mismatch: %s", raw)
	}
	again, _ := SignedVolcengineCDNAURL(setting, key, expires)
	if again != raw {
		t.Fatal("same object and window must produce a byte-identical URL for browser caching")
	}
	other, _ := SignedVolcengineCDNAURL(setting, "example-private/v1/users/u2/image/a.png", expires)
	if _, otherParts := parseVolcengineSign(t, other, "sign"); otherParts[3] == parts[3] {
		t.Fatal("signature must be bound to the object path")
	}
}

func TestSignedVolcengineCDNAURLUsesConfiguredParamAndSHA256(t *testing.T) {
	setting := testVolcengineCDNSetting("")
	setting.Delivery.CDNSignParam = "auth_key"
	raw, err := SignedVolcengineCDNAURL(setting, "p/a b.png", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	u, parts := parseVolcengineSign(t, raw, "auth_key")
	if u.EscapedPath() != "/p/a%20b.png" {
		t.Fatalf("path must be percent-encoded: %s", u.EscapedPath())
	}
	sum := sha256.Sum256([]byte("/p/a%20b.png-" + parts[0] + "-" + parts[1] + "-0-abc123def456"))
	if parts[3] != hex.EncodeToString(sum[:]) {
		t.Fatalf("default algorithm must be SHA-256 over the encoded URI: %s", raw)
	}
}

func TestSignedVolcengineCDNAURLFailsClosed(t *testing.T) {
	expires := time.Now().Add(time.Minute)
	for name, mutate := range map[string]func(*Settings){
		"wrong provider":  func(s *Settings) { s.Provider = "aliyun" },
		"wrong mode":      func(s *Settings) { s.Delivery.CDNAuthMode = CDNAuthAliyunA },
		"missing key":     func(s *Settings) { s.Delivery.CDNPrimaryKey = "" },
		"short key":       func(s *Settings) { s.Delivery.CDNPrimaryKey = "abc" },
		"bad param":       func(s *Settings) { s.Delivery.CDNSignParam = "x-tos-process" },
		"missing CDN":     func(s *Settings) { s.CDNBaseURL = "" },
		"bad algorithm":   func(s *Settings) { s.Delivery.CDNAuthAlgorithm = "sha1" },
		"ttl over limit":  func(s *Settings) { s.Delivery.CDNURLTTLSeconds = 7200 },
		"CDN with a path": func(s *Settings) { s.CDNBaseURL = "https://service-caf3fbd3.example.invalid/prefix" },
	} {
		setting := testVolcengineCDNSetting(VolcengineCDNAlgorithmSHA256)
		mutate(&setting)
		if raw, err := SignedVolcengineCDNAURL(setting, "a.png", expires); err == nil {
			t.Fatalf("%s: signed %s", name, raw)
		}
	}
	setting := testVolcengineCDNSetting(VolcengineCDNAlgorithmSHA256)
	if _, err := SignedVolcengineCDNAURL(setting, "a.png", time.Now().Add(-time.Second)); err == nil {
		t.Fatal("expired URL issued")
	}
	if _, err := SignedVolcengineCDNAURL(setting, "a.png", time.Now().Add(301*time.Second)); err == nil {
		t.Fatal("URL longer than the CDN validity window issued")
	}
	if _, err := SignCDNURL(Settings{Provider: "aliyun", CDNBaseURL: "https://service-caf3fbd3.example.invalid", Delivery: DeliverySettings{CDNAuthMode: CDNAuthVolcengineA, CDNPrimaryKey: "abc123def456"}}, "a.png", expires); err == nil {
		t.Fatal("Volcengine CDN auth must not sign non-TOS objects")
	}
}

func TestVolcengineCDNPreviewAndDownloadKeepSignature(t *testing.T) {
	setting := testVolcengineCDNSetting(VolcengineCDNAlgorithmSHA256)
	expires := time.Now().Add(time.Minute)
	plain, _ := SignedVolcengineCDNAURL(setting, "p/a.png", expires)
	preview, err := SignedCDNPreviewURL(setting, "p/a.png", expires, 320)
	if err != nil {
		t.Fatal(err)
	}
	pu, _ := url.Parse(preview)
	if pu.Query().Get("x-tos-process") != "image/resize,w_320/format,webp" || !strings.HasPrefix(preview, plain+"&") {
		t.Fatalf("preview URL = %s", preview)
	}
	if _, err := SignedCDNPreviewURL(setting, "p/a.png", expires, 100); err == nil {
		t.Fatal("arbitrary preview width accepted")
	}
	download, err := SignedCDNDownloadURL(setting, "p/a.png", expires, "成品.png")
	if err != nil {
		t.Fatal(err)
	}
	du, _ := url.Parse(download)
	if !strings.HasPrefix(du.Query().Get("response-content-disposition"), "attachment") || du.Query().Get("sign") == "" {
		t.Fatalf("download URL = %s", download)
	}
}

func TestVolcengineCDNInputValidation(t *testing.T) {
	for _, name := range []string{"sign", "auth_key", "a.b,c!d-e"} {
		if !ValidVolcengineCDNSignParam(name) {
			t.Fatalf("%q rejected", name)
		}
	}
	for _, name := range []string{"", "--", "a b", "x-tos-process", "Response-Content-Disposition", strings.Repeat("a", 101)} {
		if ValidVolcengineCDNSignParam(name) {
			t.Fatalf("%q accepted", name)
		}
	}
	if !ValidVolcengineCDNKey("Abc_123-!") || ValidVolcengineCDNKey("abc 123") || ValidVolcengineCDNKey("短密钥密钥密钥") || ValidVolcengineCDNKey(strings.Repeat("a", 121)) {
		t.Fatal("key validation mismatch")
	}
}
