package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/providercatalog"
)

func TestKlingCatalogBuildPriceAndUnknownCost(t *testing.T) {
	svc, _ := newChannelModelTestService(t)
	provider := providercatalog.BundledKling()
	view := svc.providerCatalogItem(provider, 0)
	if !view.Models[0].Supported {
		t.Fatalf("unsupported: %#v", view.Models[0])
	}
	item, tiers, err := svc.buildCatalogChannelModel(&model.ModelChannel{ID: "test"}, provider.Models[0], 3000, 0)
	if err != nil {
		t.Fatal(err)
	}
	if item.Protocol != "kling-official" || len(tiers) != 1 || tiers[0].UnitPriceMicrocredits != 50_000_000 || tiers[0].BillingMode != "per_second" || tiers[0].CostPricing.Configured {
		t.Fatalf("price=%#v", tiers)
	}
}

func TestKlingVerificationErrorsDistinguishRegionAndNetwork(t *testing.T) {
	for _, tc := range []struct {
		status     int
		body, hint string
	}{
		{401, `{"code":1002,"message":"secret-key"}`, "北京区未找到"},
		{401, `{"code":1000}`, "可灵拒绝"},
		{403, `{}`, "账户查询权限"},
		{429, `{}`, "过于频繁"},
		{503, `{"message":"secret-key"}`, "不代表 API Key 无效"},
	} {
		err := klingCatalogVerifyError(tc.status, []byte(tc.body))
		if err == nil || !strings.Contains(err.Error(), tc.hint) || strings.Contains(err.Error(), "secret-key") {
			t.Fatalf("status=%d err=%v", tc.status, err)
		}
	}
}

func TestKlingKeyVerificationIsReadOnly(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	response := `{"code":0,"data":{"code":0,"resource_pack_subscribe_infos":[]}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/account/costs" || r.Header.Get("Authorization") != "Bearer secret" || r.URL.Query().Get("start_time") == "" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
	defer server.Close()
	provider := providercatalog.BundledKling()
	provider.Connection.BaseURL = server.URL
	result, err := verifyKlingCatalogKey(context.Background(), provider, "secret")
	if err != nil || len(result.AvailableModels) != 1 {
		t.Fatalf("verify=%#v err=%v", result, err)
	}
	for _, invalid := range []string{`{"code":1000}`, `{"code":0,"data":{"code":1000}}`, `{}`, `not json`} {
		response = invalid
		if _, err := verifyKlingCatalogKey(context.Background(), provider, "secret"); err == nil {
			t.Fatalf("accepted %s", invalid)
		}
	}
}
