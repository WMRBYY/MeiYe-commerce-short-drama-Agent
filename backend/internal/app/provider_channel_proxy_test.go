package app

import (
	"context"
	"testing"
)

func TestWithChannelProxyCarriesResolvedChannelProxy(t *testing.T) {
	if got, _ := withChannelProxy(context.Background(), providerConfig{}).Value(providerProxyURLKey{}).(string); got != "" {
		t.Fatalf("empty config set proxy %q", got)
	}
	cfg := providerConfig{proxyURL: "http://user:pass@proxy.example:3128"}
	if got, _ := withChannelProxy(context.Background(), cfg).Value(providerProxyURLKey{}).(string); got != cfg.proxyURL {
		t.Fatalf("proxy = %q", got)
	}
}
