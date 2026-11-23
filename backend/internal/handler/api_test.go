package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
)

func TestRegisterCanvasAPIExposesOpenAPIAndProjects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterCanvasAPI(router.Group("/api"), &service.Service{})

	wanted := map[string]bool{
		"GET /api/openapi.yaml":                                             false,
		"GET /api/auth/settings":                                            false,
		"POST /api/auth/login":                                              false,
		"POST /api/auth/register":                                           false,
		"GET /api/admin/settings/turnstile":                                 false,
		"PATCH /api/admin/settings/turnstile":                               false,
		"GET /api/workbench/tools":                                          false,
		"GET /api/workbench/tasks":                                          false,
		"POST /api/workbench/tasks":                                         false,
		"GET /api/projects":                                                 false,
		"GET /api/teams":                                                    false,
		"GET /api/teams/credit-overview":                                    false,
		"POST /api/teams/:teamId/groups":                                    false,
		"POST /api/team-invitations/:id/accept":                             false,
		"GET /api/teams/:teamId/wallet":                                     false,
		"POST /api/teams/:teamId/asset-publications":                        false,
		"POST /api/teams/:teamId/workspace/tasks/quote":                     false,
		"PATCH /api/teams/:teamId/workspace/canvas-projects/:id/operations": false,
		"GET /api/teams/:teamId/workspace/assets":                           false,
		"POST /api/tasks":                                                   false,
		"POST /api/tasks/:id/recover-media":                                 false,
		"GET /api/resources":                                                false,
		"GET /api/skills/presets":                                           false,
		"GET /api/agent/skills/usage":                                       false,
		"POST /api/ai/system/:channelId/*path":                              false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if strings.HasPrefix(route.Path, "/api/ai/mxpage/") {
			t.Errorf("retired ecommerce Agent route is still registered: %s", key)
		}
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
		}
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/ecommerce/drafts", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("retired ecommerce Agent drafts status=%d, want 404", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/ai/mxpage/channel-1/chat/completions", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("retired ecommerce Agent bridge status=%d, want 404", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/openapi.yaml", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "openapi: 3.0.3") || !strings.Contains(recorder.Body.String(), "url: /api") {
		t.Fatalf("openapi.yaml status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var spec struct {
		Paths map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(recorder.Body.Bytes(), &spec); err != nil {
		t.Fatalf("openapi.yaml is invalid YAML: %v", err)
	}
	for _, path := range []string{"/agent/analyze", "/agent/recommend", "/agent/generate", "/agent/generate/stream"} {
		if _, ok := spec.Paths[path]; !ok {
			t.Errorf("OpenAPI path %s is missing", path)
		}
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/skills/presets", nil))
	if recorder.Code != http.StatusUnauthorized || strings.Contains(recorder.Body.String(), `"presets"`) {
		t.Fatalf("skills presets status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
