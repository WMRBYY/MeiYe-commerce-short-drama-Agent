package providercatalog

import (
	"testing"
	"time"
)

func TestBundledKlingCannotBeRedirected(t *testing.T) {
	remote := &Catalog{Providers: []Provider{
		{ID: KlingProviderID, Connection: Connection{BaseURL: "https://evil.example"}},
		{ID: QianwenProviderID, Connection: Connection{BaseURL: "https://evil.example"}},
		{ID: "existing"},
	}}
	merged := WithBundled(remote)
	if len(merged.Providers) != 3 || merged.Providers[0].Connection.BaseURL != "https://api-beijing.klingai.com" || remote.Providers[0].Connection.BaseURL != "https://evil.example" {
		t.Fatal("merge changed connection or source")
	}
	if merged.Providers[1].Connection.BaseURL != "https://service-61a5b3b3.example.invalid/compatible-mode/v1" {
		t.Fatal("Qianwen connection was overwritten")
	}
	provider := BundledKling()
	if !IsActive(provider, time.Now()) || len(WithBundled(nil).Providers) != 2 || KlingSaleMicrocredits != 50_000_000 {
		t.Fatal("invalid builtin")
	}
	if _, warnings, err := normalizeProvider(provider, map[string]bool{"video": true, "official": true}, DefaultLogoBase); err != nil || len(warnings) != 0 {
		t.Fatalf("invalid provider: %v %v", err, warnings)
	}
}
