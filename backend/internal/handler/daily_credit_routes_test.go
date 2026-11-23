package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestDailyCreditHTTPAuthenticationServerAmountAndLedger(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:daily-credit-http?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME NOT NULL)").Error; err != nil {
		t.Fatal(err)
	}
	beijing := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(beijing)
	activation := time.Date(now.Year(), now.Month(), now.Day()-1, 12, 0, 0, 0, beijing)
	if err := db.Exec("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", 50, activation).Error; err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "daily-http-user", Username: "daily-http-user", Email: "daily@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: activation}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: user.ID, UserID: user.ID, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	call := func(authenticated bool, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if authenticated {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "daily-http-user.test-token"})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	if response := call(false, http.MethodPost, "/api/wallet/checkin", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous claim: %d %s", response.Code, response.Body.String())
	}
	if response := call(true, http.MethodGet, "/api/wallet", ""); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"pendingMicrocredits":200000`) || !strings.Contains(response.Body.String(), `"oldestExpiresAt":`) {
		t.Fatalf("pending wallet: %d %s", response.Code, response.Body.String())
	}
	response := call(true, http.MethodPost, "/api/wallet/checkin", `{"amountMicrocredits":999000000}`)
	if response.Code != http.StatusOK {
		t.Fatalf("claim: %d %s", response.Code, response.Body.String())
	}
	if response := call(true, http.MethodPost, "/api/wallet/checkin", ""); response.Code != http.StatusConflict {
		t.Fatalf("duplicate: %d %s", response.Code, response.Body.String())
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	var entries []model.CreditLedgerEntry
	if err := db.Where("user_id = ? AND type = ?", user.ID, model.CreditLedgerCheckinBonus).Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 200_000 || len(entries) != 1 {
		t.Fatalf("server amount: balance=%d ledger=%d", account.AvailableMicrocredits, len(entries))
	}
	response = call(true, http.MethodGet, "/api/wallet", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"pendingMicrocredits":0`) || !strings.Contains(response.Body.String(), `"checkedInToday":true`) {
		t.Fatalf("wallet state: %d %s", response.Code, response.Body.String())
	}
}
