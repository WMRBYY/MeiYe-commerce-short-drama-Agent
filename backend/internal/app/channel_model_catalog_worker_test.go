package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestChannelCatalogRejectsMalformedAndIncompletePages(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	response := `{"data":[{"id":"alpha"}]}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
	defer upstream.Close()
	svc, _ := newChannelModelTestService(t)
	actor := &model.User{ID: "admin"}
	input := ChannelModelsRequest{BaseURL: upstream.URL + "/v1", APIKey: "test", APIFormat: "openai"}
	if _, err := svc.FetchChannelModelCatalog(context.Background(), actor, input); err != nil {
		t.Fatal(err)
	}
	response = `{"message":"temporarily unavailable"}`
	if _, err := svc.FetchChannelModelCatalog(context.Background(), actor, input); err == nil {
		t.Fatal("missing data array was accepted")
	}
	response = `{"data":null}`
	if _, err := svc.FetchChannelModelCatalog(context.Background(), actor, input); err == nil {
		t.Fatal("null data array was accepted")
	}
}

func TestChannelCatalogFetchesAllGeminiPages(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("pageToken") == "second" {
			_, _ = w.Write([]byte(`{"models":[{"name":"models/beta"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"models":[{"name":"models/alpha"}],"nextPageToken":"second"}`))
	}))
	defer upstream.Close()
	svc, _ := newChannelModelTestService(t)
	items, err := svc.FetchChannelModelCatalog(context.Background(), &model.User{ID: "admin"}, ChannelModelsRequest{
		BaseURL: upstream.URL, APIKey: "test", APIFormat: "gemini",
	})
	if err != nil || len(items) != 2 || items[0].ID != "alpha" || items[1].ID != "beta" {
		t.Fatalf("catalog = %#v, error = %v", items, err)
	}
}

func TestChannelCatalogDisablesOnlyPreviouslySeenMissingModel(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	channel := model.ModelChannel{ID: "channel-1", Scope: model.ChannelScopeSystem, Enabled: true, ModelsJSON: `["alpha","beta"]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	models := []model.ChannelModel{
		{ID: "alpha", ChannelID: channel.ID, ModelKey: "alpha", ProviderModelKey: "alpha", Enabled: true, PriceVersion: 1},
		{ID: "beta", ChannelID: channel.ID, ModelKey: "beta", ProviderModelKey: "beta", Enabled: true, PriceVersion: 1},
		{ID: "alias", ChannelID: channel.ID, ModelKey: "alias", ProviderModelKey: "unlisted-alias", Enabled: true, PriceVersion: 1},
	}
	if err := db.Create(&models).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	checks := []struct {
		at       time.Time
		catalog  map[string]bool
		wantGone int
	}{
		{now, map[string]bool{"alpha": true, "beta": true}, 0},
		{now.Add(6 * time.Hour), map[string]bool{"alpha": true}, 0},
		{now.Add(7 * time.Hour), map[string]bool{"alpha": true}, 0},
		{now.Add(12 * time.Hour), map[string]bool{"alpha": true}, 1},
	}
	for _, check := range checks {
		disabled, err := svc.repo.ReconcileChannelModelCatalog(channel.ID, check.catalog, check.at)
		if err != nil || len(disabled) != check.wantGone {
			t.Fatalf("disabled = %#v, error = %v, want %d", disabled, err, check.wantGone)
		}
	}
	var beta, alias model.ChannelModel
	if err := db.First(&beta, "id = ?", "beta").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&alias, "id = ?", "alias").Error; err != nil {
		t.Fatal(err)
	}
	if beta.Enabled || beta.UpstreamRemovedAt == nil || beta.PriceVersion != 2 || !alias.Enabled {
		t.Fatalf("beta = %#v, alias = %#v", beta, alias)
	}
	var refreshed model.ModelChannel
	if err := db.First(&refreshed, "id = ?", channel.ID).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(refreshed.ModelsJSON, "beta") || !strings.Contains(refreshed.ModelsJSON, "alpha") {
		t.Fatalf("models_json = %s", refreshed.ModelsJSON)
	}
}
