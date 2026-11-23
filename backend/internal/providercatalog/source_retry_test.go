package providercatalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewSourceUsesBundledCatalogWhenRemoteURLIsUnset(t *testing.T) {
	t.Setenv("CANVAS_PROVIDER_CATALOG_URL", "")
	t.Setenv("CANVAS_PROVIDER_CATALOG_LOGO_BASE", "")
	t.Setenv("CANVAS_PROVIDER_CATALOG_DISABLED", "")

	snapshot := NewSource("", http.DefaultClient).Get(context.Background())
	if snapshot.State != SourceDisabled || snapshot.Catalog != nil {
		t.Fatalf("default source = %#v, want disabled without a remote catalog", snapshot)
	}
	bundled := WithBundled(snapshot.Catalog)
	if len(bundled.Providers) != 2 {
		t.Fatalf("bundled providers = %d, want 2", len(bundled.Providers))
	}
}

func TestNewSourceReadsConfiguredRemoteURL(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(Catalog{SchemaVersion: SchemaVersion, UpdatedAt: "2026-11-23T00:00:00Z"})
	}))
	defer server.Close()
	t.Setenv("CANVAS_PROVIDER_CATALOG_URL", server.URL)
	t.Setenv("CANVAS_PROVIDER_CATALOG_LOGO_BASE", "")
	t.Setenv("CANVAS_PROVIDER_CATALOG_DISABLED", "")

	snapshot := NewSource("", server.Client()).Get(context.Background())
	if snapshot.State != SourceLive || snapshot.Catalog == nil || requests != 1 {
		t.Fatalf("configured source = %#v, requests = %d", snapshot, requests)
	}
}

func TestCachedReadsDoNotWaitForRefresh(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()
	now := time.Now()
	source := NewSourceForTest(server.URL, "", server.Client(), "", func() time.Time { return now })
	source.loaded = true
	source.snapshot = Snapshot{Catalog: &Catalog{SchemaVersion: 1}, FetchedAt: now.Add(-time.Hour), ETag: "v1", State: SourceCache}
	result := source.Get(context.Background())
	if result.Catalog == nil {
		t.Fatal("cached catalog missing")
	}
	<-started
	read := make(chan Snapshot, 1)
	go func() { read <- source.Get(context.Background()) }()
	select {
	case cached := <-read:
		if cached.Catalog == nil {
			t.Error("cached catalog missing during refresh")
		}
	case <-time.After(time.Second):
		t.Error("cached read blocked by network refresh")
	}
	source.mu.Lock()
	done := source.inflight
	source.mu.Unlock()
	close(release)
	<-done
}

func TestFailedGetBacksOffAndExplicitRefreshRetries(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(http.StatusBadGateway) }))
	defer server.Close()
	now := time.Now()
	source := NewSourceForTest(server.URL, "", server.Client(), "", func() time.Time { return now })
	source.Get(context.Background())
	source.Get(context.Background())
	if calls != 1 {
		t.Fatalf("failed Get retried without cooldown: %d", calls)
	}
	source.Refresh(context.Background())
	if calls != 2 {
		t.Fatalf("explicit refresh did not retry: %d", calls)
	}
	now = now.Add(31 * time.Second)
	source.Get(context.Background())
	if calls != 3 {
		t.Fatalf("Get did not retry after cooldown: %d", calls)
	}
}
