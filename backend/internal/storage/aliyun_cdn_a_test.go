package storage

import (
	"strings"
	"testing"
	"time"
)

func TestAliyunCDNASigningMatchesOfficialExample(t *testing.T) {
	got, err := SignAliyunCDNAAt("http://domain.example.com", "video/standard/test.mp4", "aliyuncdnexp1234", 1444435200)
	if err != nil {
		t.Fatal(err)
	}
	want := "http://domain.example.com/video/standard/test.mp4?auth_key=1444435200-0-0-23bf85053008f5c0e791667a313e28ce"
	if got != want {
		t.Fatalf("Aliyun CDN A vector mismatch: got %q", got)
	}
}

func TestAliyunCDNASigningFailsClosed(t *testing.T) {
	setting := Settings{Provider: "aliyun", CDNBaseURL: "https://media.example.com", Delivery: DeliverySettings{CDNAuthMode: "aliyun_a", CDNURLTTLSeconds: 300}}
	if _, err := SignCDNURL(setting, "private/test.png", time.Now().Add(300*time.Second)); err == nil {
		t.Fatal("missing CDN key must not yield an unsigned URL")
	}
	setting.Delivery.CDNPrimaryKey = "sample-key"
	url, err := SignCDNURL(setting, "private/test.png", time.Now().Add(300*time.Second))
	if err != nil || !strings.HasPrefix(url, "https://media.example.com/private/test.png?auth_key=") || strings.Contains(url, "sample-key") {
		t.Fatalf("signed CDN URL missing or leaked key: %v", err)
	}
}
