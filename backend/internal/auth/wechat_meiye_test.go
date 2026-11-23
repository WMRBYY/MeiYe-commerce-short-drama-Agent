package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type weChatAvatarTestHost struct{ Host }

func (h weChatAvatarTestHost) StoreWeChatAvatar(_ context.Context, userID, _ string) (string, error) {
	return "/api/profile/avatars/" + userID + "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", nil
}

func newWeChatTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	t.Setenv("CANVAS_WECHAT_WEBSITE_LOGIN_ENABLED", "true")
	t.Setenv("CANVAS_WECHAT_WEBSITE_REGISTRATION_ENABLED", "true")
	t.Setenv("CANVAS_WECHAT_WEBSITE_APP_ID", "wx-test-site-app")
	t.Setenv("CANVAS_WECHAT_WEBSITE_APP_SECRET", "isolated-test-secret")
	t.Setenv("CANVAS_WECHAT_WEBSITE_REDIRECT_URI", "https://service-28ac86dd.example.invalid/api/auth/wechat/callback")
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	redisClient := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = redisClient.Close() })
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "wechat.db")+"?_busy_timeout=5000&_journal_mode=WAL"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserIdentity{}, &model.OAuthState{}, &model.AuthSession{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.LoginLog{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX idx_wechat_website_identity_user ON user_identities(user_id) WHERE provider = 'wechat_website'").Error; err != nil {
		t.Fatal(err)
	}
	admin := model.User{ID: "existing-admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/userinfo" {
			_ = json.NewEncoder(w).Encode(map[string]any{"openid": r.URL.Query().Get("openid"), "nickname": "微信测试用户", "headimgurl": "https://thirdwx.qlogo.cn/mmopen/test/0"})
			return
		}
		if r.URL.Query().Get("appid") != "wx-test-site-app" || r.URL.Query().Get("secret") != "isolated-test-secret" || r.URL.Query().Get("grant_type") != "authorization_code" {
			t.Error("unexpected token exchange parameters")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "test-access", "openid": r.URL.Query().Get("code"), "scope": "snsapi_login"})
	}))
	t.Cleanup(provider.Close)
	svc := New(repository.New(db), phoneTestHost{redis: redisClient}, nil)
	svc.wechatHTTPClient = provider.Client()
	svc.wechatTokenURL = provider.URL
	svc.wechatUserInfoURL = provider.URL + "/userinfo"
	svc.host = weChatAvatarTestHost{Host: svc.host}
	return svc, db
}

func weChatStateFromStart(t *testing.T, started *WeChatStart) string {
	t.Helper()
	target, err := url.Parse(started.URL)
	if err != nil {
		t.Fatal(err)
	}
	if target.Host != "open.weixin.qq.com" || target.Path != "/connect/qrconnect" || target.Query().Get("scope") != "snsapi_login" {
		t.Fatalf("unexpected website authorization URL: %s", target.Host+target.Path)
	}
	return target.Query().Get("state")
}

func TestWeChatWebsiteRegistrationSessionAndReplay(t *testing.T) {
	svc, db := newWeChatTestService(t)
	ctx := context.Background()
	started, err := svc.BeginWeChatLogin(ctx, "/canvas", "192.0.2.5")
	if err != nil {
		t.Fatal(err)
	}
	state := weChatStateFromStart(t, started)
	if _, err := svc.CompleteWeChatLogin(ctx, state, "openid-1", RandomToken(), "", "192.0.2.5"); err == nil {
		t.Fatal("copied callback URL was accepted without the initiating browser cookie")
	}
	result, err := svc.CompleteWeChatLogin(ctx, state, "openid-1", started.BrowserToken, "", "192.0.2.5")
	if err != nil || result.Session == nil || result.Session.User.Role != model.UserRoleUser || result.Next != "/canvas" {
		t.Fatalf("first authorization did not create an ordinary session: result=%+v err=%v", result, err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		updated, loadErr := svc.repo.User(result.Session.User.ID)
		if loadErr == nil && updated.DisplayName == "微信测试用户" && updated.AvatarURL != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("provider profile was not saved in the background")
		}
		time.Sleep(20 * time.Millisecond)
	}
	retry, err := svc.CompleteWeChatLogin(ctx, state, "openid-1", started.BrowserToken, "", "192.0.2.5")
	if err != nil || retry.Session == nil || retry.Session.User.ID != result.Session.User.ID {
		t.Fatalf("same-browser callback retry did not recover session: result=%+v err=%v", retry, err)
	}
	if _, err := svc.CompleteWeChatLogin(ctx, state, "other-code", started.BrowserToken, "", "192.0.2.5"); err == nil {
		t.Fatal("different authorization code reused an OAuth state")
	}
	manual := "自己设定"
	manualAvatar := "/api/profile/avatars/" + result.Session.User.ID + "/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg"
	if _, err := svc.repo.UpdateOwnProfile(result.Session.User.ID, &manual, &manualAvatar); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.OAuthState{}).Where("state_hash = ?", HashToken(state)).Update("used_at", time.Now().Add(-31*time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteWeChatLogin(ctx, state, "openid-1", started.BrowserToken, "", "192.0.2.5"); err == nil {
		t.Fatal("callback retry was accepted after its short recovery window")
	}
	var users, credits, identities int64
	db.Model(&model.User{}).Count(&users)
	db.Model(&model.CreditAccount{}).Count(&credits)
	db.Model(&model.UserIdentity{}).Count(&identities)
	if users != 2 || credits != 1 || identities != 1 {
		t.Fatalf("unexpected data counts users=%d credits=%d identities=%d", users, credits, identities)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", result.Session.User.ID).Error; err != nil || account.AvailableMicrocredits != 0 {
		t.Fatalf("new WeChat balance=%d err=%v", account.AvailableMicrocredits, err)
	}
	second, err := svc.BeginWeChatLogin(ctx, "/", "192.0.2.5")
	if err != nil {
		t.Fatal(err)
	}
	relogin, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, second), "openid-1", second.BrowserToken, "", "192.0.2.5")
	if err != nil || relogin.Session.User.ID != result.Session.User.ID {
		t.Fatalf("repeat authorization created another account: err=%v", err)
	}
	var ledgerCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", result.Session.User.ID).Count(&ledgerCount).Error; err != nil || ledgerCount != 0 {
		t.Fatalf("WeChat login awarded credits: ledger=%d err=%v", ledgerCount, err)
	}
	if relogin.Session.User.DisplayName != manual {
		t.Fatalf("manual nickname was overwritten: %q", relogin.Session.User.DisplayName)
	}
	if relogin.Session.User.AvatarURL != manualAvatar {
		t.Fatal("manual avatar was overwritten")
	}
}

func TestWeChatExistingPhoneUserNullAvatar(t *testing.T) {
	svc, db := newWeChatTestService(t)
	phoneUser := model.User{ID: "existing-phone", Username: "phone-user", Phone: "+8613800000000", DisplayName: "W", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&phoneUser).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE users SET avatar_url = NULL WHERE id = ?", phoneUser.ID).Error; err != nil {
		t.Fatal(err)
	}
	identity := model.UserIdentity{ID: "existing-phone-wechat", UserID: phoneUser.ID, Provider: weChatProvider, Subject: "wx-test-site-app:openid-phone"}
	if err := db.Create(&identity).Error; err != nil {
		t.Fatal(err)
	}
	started, err := svc.BeginWeChatLogin(context.Background(), "/", "192.0.2.20")
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.CompleteWeChatLogin(context.Background(), weChatStateFromStart(t, started), "openid-phone", started.BrowserToken, "", "192.0.2.20")
	if err != nil || result.Session == nil {
		t.Fatalf("existing account login failed: %v", err)
	}
	if result.Session.User.ID != phoneUser.ID || result.Session.User.Phone != phoneUser.Phone || result.Session.User.DisplayName != "W" {
		t.Fatal("existing phone account was replaced or its chosen name was overwritten")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		updated, loadErr := svc.repo.User(phoneUser.ID)
		if loadErr == nil && updated.AvatarURL != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("provider avatar was not persisted for an existing NULL avatar column")
		}
		time.Sleep(20 * time.Millisecond)
	}
	var count int64
	if err := db.Model(&model.User{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("duplicate user created: count=%d err=%v", count, err)
	}
}

func TestWeChatBindingRequiresFreshSessionAndNeverMerges(t *testing.T) {
	svc, db := newWeChatTestService(t)
	ctx := context.Background()
	now := time.Now()
	phoneUser := model.User{ID: "phone-user", Username: "phone-user", Phone: "+8613800000000", PhoneVerifiedAt: &now, Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&phoneUser).Error; err != nil {
		t.Fatal(err)
	}
	session, err := svc.createAuthSession(&phoneUser)
	if err != nil {
		t.Fatal(err)
	}
	started, err := svc.BeginWeChatBind(ctx, session.Session, "", "192.0.2.8")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, started), "openid-bound", started.BrowserToken, "", "192.0.2.8"); err == nil {
		t.Fatal("binding callback succeeded without the original session")
	}
	started, err = svc.BeginWeChatBind(ctx, session.Session, "", "192.0.2.8")
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := svc.BeginWeChatBind(ctx, session.Session, "", "192.0.2.8")
	if err != nil {
		t.Fatal(err)
	}
	bound, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, started), "openid-bound", started.BrowserToken, session.Session, "192.0.2.8")
	if err != nil || !bound.Bound || bound.Session != nil {
		t.Fatalf("binding failed or replaced the existing session: %+v %v", bound, err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		boundUser, loadErr := svc.repo.User(phoneUser.ID)
		if loadErr == nil && boundUser.DisplayName == "微信测试用户" && boundUser.AvatarURL != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("phone account profile was not filled on bind: %+v %v", boundUser, loadErr)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, err := svc.BeginWeChatBind(ctx, session.Session, "", "192.0.2.8"); err == nil {
		t.Fatal("bound account started a duplicate binding")
	}
	if _, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, duplicate), "openid-bound", duplicate.BrowserToken, session.Session, "192.0.2.8"); err == nil {
		t.Fatal("second pending binding completed after account was already bound")
	}
	other := model.User{ID: "other-phone-user", Username: "other-phone-user", Phone: "+8613900000000", PhoneVerifiedAt: &now, Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	otherSession, err := svc.createAuthSession(&other)
	if err != nil {
		t.Fatal(err)
	}
	conflict, err := svc.BeginWeChatBind(ctx, otherSession.Session, "", "192.0.2.9")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, conflict), "openid-bound", conflict.BrowserToken, otherSession.Session, "192.0.2.9"); err == nil {
		t.Fatal("another phone account captured an existing WeChat identity")
	}
	identity, err := svc.repo.UserIdentity(weChatProvider, "wx-test-site-app:openid-bound")
	if err != nil || identity.UserID != phoneUser.ID {
		t.Fatalf("binding moved an identity to another user: %+v %v", identity, err)
	}
}

func TestWeChatBindUnifiesExistingWeChatDataWithPhoneAccount(t *testing.T) {
	svc, db := newWeChatTestService(t)
	ctx := context.Background()
	firstStart, err := svc.BeginWeChatLogin(ctx, "/", "192.0.2.40")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, firstStart), "openid-existing", firstStart.BrowserToken, "", "192.0.2.40")
	if err != nil {
		t.Fatal(err)
	}
	sourceID := first.Session.User.ID
	if err := db.AutoMigrate(&model.Asset{}, &model.Task{}, &model.UserDailyActivity{}, &model.UserDailyUploadUsage{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Asset{ID: "wechat-asset", UserID: sourceID, Title: "微信作品"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "wechat-task", UserID: sourceID, Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", sourceID).Update("available_microcredits", 200).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditLedgerEntry{ID: "wechat-credit", UserID: sourceID, Type: model.CreditLedgerPaymentTopup, AmountMicrocredits: 200, AvailableDeltaMicrocredits: 200}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	phone := model.User{ID: "phone-owner", Username: "phone-owner", Phone: "+8613800000000", PhoneVerifiedAt: &now, Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&phone).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: phone.ID, AvailableMicrocredits: 300}).Error; err != nil {
		t.Fatal(err)
	}
	day := time.Now().UTC().Truncate(24 * time.Hour)
	for _, activity := range []model.UserDailyActivity{
		{ID: "wechat-day", UserID: sourceID, Day: day, LoginCount: 2, TaskCount: 1},
		{ID: "phone-day", UserID: phone.ID, Day: day, LoginCount: 3, AssetCount: 4},
	} {
		if err := db.Create(&activity).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, usage := range []model.UserDailyUploadUsage{
		{ID: "wechat-upload", UserID: sourceID, Day: "2026-10-13", Bytes: 20},
		{ID: "phone-upload", UserID: phone.ID, Day: "2026-10-13", Bytes: 30},
	} {
		if err := db.Create(&usage).Error; err != nil {
			t.Fatal(err)
		}
	}
	phoneSession, err := svc.createAuthSession(&phone)
	if err != nil {
		t.Fatal(err)
	}
	bindStart, err := svc.BeginWeChatBind(ctx, phoneSession.Session, "", "192.0.2.41")
	if err != nil {
		t.Fatal(err)
	}
	bound, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, bindStart), "openid-existing", bindStart.BrowserToken, phoneSession.Session, "192.0.2.41")
	if err != nil || !bound.Bound {
		t.Fatalf("bind failed: %+v %v", bound, err)
	}
	identity, err := svc.repo.UserIdentity(weChatProvider, "wx-test-site-app:openid-existing")
	if err != nil || identity.UserID != phone.ID {
		t.Fatalf("identity owner: %+v %v", identity, err)
	}
	var asset model.Asset
	if err := db.First(&asset, "id = ?", "wechat-asset").Error; err != nil || asset.UserID != phone.ID {
		t.Fatalf("asset owner: %+v %v", asset, err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", "wechat-task").Error; err != nil || task.UserID != phone.ID {
		t.Fatalf("task owner: %+v %v", task, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", phone.ID).Error; err != nil || account.AvailableMicrocredits != 500 {
		t.Fatalf("merged credit balance: %+v %v", account, err)
	}
	var ledger model.CreditLedgerEntry
	if err := db.First(&ledger, "id = ?", "wechat-credit").Error; err != nil || ledger.UserID != phone.ID {
		t.Fatalf("ledger owner: %+v %v", ledger, err)
	}
	var activity model.UserDailyActivity
	if err := db.First(&activity, "id = ?", "phone-day").Error; err != nil || activity.LoginCount != 5 || activity.TaskCount != 1 || activity.AssetCount != 4 {
		t.Fatalf("daily activity not combined: %+v %v", activity, err)
	}
	var usage model.UserDailyUploadUsage
	if err := db.First(&usage, "id = ?", "phone-upload").Error; err != nil || usage.Bytes != 50 {
		t.Fatalf("daily upload usage not combined: %+v %v", usage, err)
	}
	if _, err := svc.CurrentUser(first.Session.Session); err == nil {
		t.Fatal("old WeChat session survived merge")
	}
	relogin, err := svc.BeginWeChatLogin(ctx, "/", "192.0.2.42")
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, relogin), "openid-existing", relogin.BrowserToken, "", "192.0.2.42")
	if err != nil || second.Session == nil || second.Session.User.ID != phone.ID {
		t.Fatalf("login did not use phone account: %+v %v", second, err)
	}
}

func TestWeChatBindRejectsActiveSourceTaskWithoutMovingData(t *testing.T) {
	svc, db := newWeChatTestService(t)
	ctx := context.Background()
	firstStart, err := svc.BeginWeChatLogin(ctx, "/", "192.0.2.50")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, firstStart), "openid-active", firstStart.BrowserToken, "", "192.0.2.50")
	if err != nil {
		t.Fatal(err)
	}
	sourceID := first.Session.User.ID
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "active-task", UserID: sourceID, Status: model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	phone := model.User{ID: "phone-active", Username: "phone-active", Phone: "+8613900000000", PhoneVerifiedAt: &now, Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&phone).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: phone.ID}).Error; err != nil {
		t.Fatal(err)
	}
	session, err := svc.createAuthSession(&phone)
	if err != nil {
		t.Fatal(err)
	}
	bindStart, err := svc.BeginWeChatBind(ctx, session.Session, "", "192.0.2.51")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteWeChatLogin(ctx, weChatStateFromStart(t, bindStart), "openid-active", bindStart.BrowserToken, session.Session, "192.0.2.51"); err == nil {
		t.Fatal("running task was merged")
	}
	identity, err := svc.repo.UserIdentity(weChatProvider, "wx-test-site-app:openid-active")
	if err != nil || identity.UserID != sourceID {
		t.Fatalf("identity moved after rejected merge: %+v %v", identity, err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", "active-task").Error; err != nil || task.UserID != sourceID {
		t.Fatalf("task moved after rejected merge: %+v %v", task, err)
	}
}

func TestWeChatWebsiteSwitchesFailClosed(t *testing.T) {
	svc, _ := newWeChatTestService(t)
	t.Setenv("CANVAS_WECHAT_WEBSITE_LOGIN_ENABLED", "false")
	if _, err := svc.BeginWeChatLogin(context.Background(), "/", "192.0.2.1"); err == nil {
		t.Fatal("disabled WeChat login started authorization")
	}
	t.Setenv("CANVAS_WECHAT_WEBSITE_LOGIN_ENABLED", "true")
	t.Setenv("CANVAS_WECHAT_WEBSITE_REGISTRATION_ENABLED", "false")
	started, err := svc.BeginWeChatLogin(context.Background(), "/", "192.0.2.1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteWeChatLogin(context.Background(), weChatStateFromStart(t, started), "new-openid", started.BrowserToken, "", "192.0.2.1"); err == nil {
		t.Fatal("disabled WeChat registration created a user")
	}
}

func TestWeChatAcceptanceCallbackRequiresExplicitSwitch(t *testing.T) {
	config := weChatConfig{AppID: "wx-test", AppSecret: "test-secret", RedirectURI: "https://service-28ac86dd.example.invalid" + weChatAcceptanceCallbackPath}
	if validWeChatConfig(config) {
		t.Fatal("candidate callback accepted without the acceptance switch")
	}
	t.Setenv("CANVAS_WECHAT_WEBSITE_ACCEPTANCE_ENABLED", "true")
	if !validWeChatConfig(config) {
		t.Fatal("candidate callback rejected with the acceptance switch")
	}
	config.RedirectURI = "https://other.example" + weChatAcceptanceCallbackPath
	if validWeChatConfig(config) {
		t.Fatal("candidate callback accepted an unrelated host")
	}
}

func TestWeChatWebsiteRejectsProviderErrorEvenWithHTTP200(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"errcode":48001,"errmsg":"api unauthorized"}`))
	}))
	defer provider.Close()
	_, err := exchangeWeChatCode(context.Background(), provider.Client(), provider.URL,
		weChatConfig{AppID: "wx-test", AppSecret: "test-secret"}, "test-code")
	if err == nil {
		t.Fatal("WeChat permission rejection was treated as a successful login")
	}
}

func TestWeChatBindingAdminRequiresPasswordAndFreshSession(t *testing.T) {
	svc, db := newWeChatTestService(t)
	hash, err := HashPassword("isolated-test-admin-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "existing-admin").Update("password_hash", hash).Error; err != nil {
		t.Fatal(err)
	}
	admin, err := svc.repo.User("existing-admin")
	if err != nil {
		t.Fatal(err)
	}
	session, err := svc.createAuthSession(admin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BeginWeChatBind(context.Background(), session.Session, "wrong", "192.0.2.10"); err == nil {
		t.Fatal("administrator bound WeChat without the current password")
	}
	if _, err := svc.BeginWeChatBind(context.Background(), session.Session, "isolated-test-admin-password", "192.0.2.10"); err != nil {
		t.Fatalf("valid administrator reauthentication rejected: %v", err)
	}
	sessionID, _ := parseSessionCookie(session.Session)
	if err := db.Model(&model.AuthSession{}).Where("id = ?", sessionID).Update("created_at", time.Now().Add(-6*time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BeginWeChatBind(context.Background(), session.Session, "isolated-test-admin-password", "192.0.2.10"); err == nil {
		t.Fatal("stale administrator session started a binding")
	}
}
