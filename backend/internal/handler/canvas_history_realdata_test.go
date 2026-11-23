package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Exercises the authenticated HTTP history routes against an isolated restore of
// production data. Every write, including the session and restored canvas, rolls back.
func TestIsolatedProductionCanvasHistoryHTTP(t *testing.T) {
	dsn := os.Getenv("MEIYEAI_ISOLATED_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires an isolated restored production database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()

	var snapshot model.CanvasSnapshot
	if err := tx.Order("created_at desc").First(&snapshot).Error; err != nil {
		t.Fatal(err)
	}
	var project model.CanvasProject
	if err := tx.First(&project, "id = ? AND user_id = ?", snapshot.CanvasID, snapshot.UserID).Error; err != nil {
		t.Fatal(err)
	}
	var user model.User
	if err := tx.First(&user, "id = ?", snapshot.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Status != model.UserStatusActive {
		t.Skip("historical canvas owner is no longer active")
	}

	sessionID := "phase2-history-test"
	token := "isolated-history-token"
	if err := tx.Create(&model.AuthSession{ID: sessionID, UserID: user.ID, TokenHash: auth.HashToken(token), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(tx), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	defer func() { runtimeService = previous }()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), svc)
	base := "/api/canvas-projects/" + snapshot.CanvasID + "/history"
	call := func(method, path, body string, authorized bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if authorized {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: sessionID + "." + token})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	if response := call(http.MethodGet, base, "", false); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized history status=%d", response.Code)
	}
	list := call(http.MethodGet, base, "", true)
	if list.Code != http.StatusOK {
		t.Fatalf("history list status=%d body=%s", list.Code, list.Body.String())
	}
	var listed struct {
		Data struct {
			Snapshots []struct {
				ID string `json:"id"`
			} `json:"snapshots"`
		} `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil || len(listed.Data.Snapshots) == 0 {
		t.Fatalf("existing history list invalid: %v", err)
	}
	entryID := listed.Data.Snapshots[0].ID
	preview := call(http.MethodGet, base+"/"+entryID, "", true)
	if preview.Code != http.StatusOK || !strings.Contains(preview.Body.String(), `"nodes"`) {
		t.Fatalf("historical preview status=%d", preview.Code)
	}
	restorePath := base + "/" + entryID + "/restore"
	restored := call(http.MethodPost, restorePath, fmt.Sprintf(`{"revision":%d}`, project.Revision), true)
	if restored.Code != http.StatusOK {
		t.Fatalf("restore status=%d body=%s", restored.Code, restored.Body.String())
	}
	var updated model.CanvasProject
	if err := tx.First(&updated, "id = ?", project.ID).Error; err != nil || updated.Revision != project.Revision+1 {
		t.Fatalf("restore revision=%d error=%v", updated.Revision, err)
	}
	stale := call(http.MethodPost, restorePath, fmt.Sprintf(`{"revision":%d}`, project.Revision), true)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale revision status=%d body=%s", stale.Code, stale.Body.String())
	}
}
