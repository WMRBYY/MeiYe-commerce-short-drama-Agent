package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPersonalSettingsRoutesRejectRegularUsers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "regular", Username: "regular", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "regular-session", UserID: "regular", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	api := router.Group("/api")
	RegisterUserDataRoutes(api, svc)
	RegisterDiagnosticsRoutes(api, svc)
	RegisterChannelModelRoutes(api, svc)
	RegisterCustomRelayRoutes(api, svc)
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/settings/oss"},
		{http.MethodPatch, "/api/settings/oss"},
		{http.MethodPost, "/api/settings/oss/test"},
		{http.MethodPost, "/api/diagnostics/preview"},
		{http.MethodPost, "/api/diagnostics/export"},
		{http.MethodPost, "/api/ai/models"},
		{http.MethodPost, "/api/ai/custom"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "regular-session.test-token"})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Errorf("%s %s: status = %d, body = %s", route.method, route.path, response.Code, response.Body.String())
		}
	}
}
