package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const weChatProvider = "wechat_website"
const weChatCallbackPath = "/api/auth/wechat/callback"
const weChatAcceptanceCallbackPath = "/profile-acceptance/wechat/callback"
const weChatTokenEndpoint = "https://api.weixin.qq.com/sns/oauth2/access_token"
const weChatUserInfoEndpoint = "https://api.weixin.qq.com/sns/userinfo"

type weChatToken struct{ AccessToken, OpenID string }
type weChatProfile struct {
	OpenID    string `json:"openid"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"headimgurl"`
	ErrCode   int    `json:"errcode"`
}

type WeChatStart struct {
	URL          string
	BrowserToken string
}

type WeChatCallbackResult struct {
	Session *AuthSessionResult
	Next    string
	Bound   bool
}

type weChatConfig struct {
	AppID       string
	AppSecret   string
	RedirectURI string
}

func weChatEnabled() bool {
	return strings.EqualFold(os.Getenv("CANVAS_WECHAT_WEBSITE_LOGIN_ENABLED"), "true") && validWeChatConfig(weChatConfiguration())
}

func weChatRegistrationEnabled() bool {
	return strings.EqualFold(os.Getenv("CANVAS_WECHAT_WEBSITE_REGISTRATION_ENABLED"), "true")
}

func weChatConfiguration() weChatConfig {
	return weChatConfig{
		AppID:       strings.TrimSpace(os.Getenv("CANVAS_WECHAT_WEBSITE_APP_ID")),
		AppSecret:   strings.TrimSpace(os.Getenv("CANVAS_WECHAT_WEBSITE_APP_SECRET")),
		RedirectURI: strings.TrimSpace(os.Getenv("CANVAS_WECHAT_WEBSITE_REDIRECT_URI")),
	}
}

func validWeChatConfig(config weChatConfig) bool {
	redirect, err := url.Parse(config.RedirectURI)
	if err != nil {
		return false
	}
	pathAllowed := redirect.Path == weChatCallbackPath ||
		(redirect.Path == weChatAcceptanceCallbackPath && strings.EqualFold(os.Getenv("CANVAS_WECHAT_WEBSITE_ACCEPTANCE_ENABLED"), "true"))
	return config.AppID != "" && config.AppSecret != "" && redirect.Scheme == "https" &&
		redirect.Hostname() == "service-28ac86dd.example.invalid" && redirect.Port() == "" && redirect.User == nil && pathAllowed &&
		redirect.RawQuery == "" && redirect.Fragment == ""
}

func (s *Service) WeChatAvailable() bool { return weChatEnabled() }

func (s *Service) WeChatBindingStatus(user *model.User) (bool, error) {
	_, err := s.repo.UserIdentityForUser(user.ID, weChatProvider)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return err == nil, err
}

func (s *Service) BeginWeChatLogin(ctx context.Context, nextPath, clientIP string) (*WeChatStart, error) {
	if !s.WeChatAvailable() {
		return nil, kernel.Forbidden("微信扫码登录尚未启用")
	}
	if err := s.allowWeChat(ctx, "wechat-login-start:"+clientIP, 20, 10*time.Minute); err != nil {
		return nil, err
	}
	count, err := s.repo.UserCount()
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, kernel.Forbidden("请先通过管理员入口初始化站点")
	}
	return s.beginWeChatState(safeOAuthNext(nextPath), "", "")
}

// Binding requires a fresh existing session. Administrators must also prove
// knowledge of their current password; OAuth itself never elevates a user.
func (s *Service) BeginWeChatBind(ctx context.Context, sessionCookie, password, clientIP string) (*WeChatStart, error) {
	if !s.WeChatAvailable() {
		return nil, kernel.Forbidden("微信扫码登录尚未启用")
	}
	user, err := s.CurrentUser(sessionCookie)
	if err != nil {
		return nil, err
	}
	sessionID, _ := parseSessionCookie(sessionCookie)
	session, err := s.repo.AuthSession(sessionID)
	if err != nil || session.UserID != user.ID || time.Since(session.CreatedAt) > 5*time.Minute {
		return nil, kernel.Forbidden("请重新登录后再绑定微信")
	}
	if user.Role == model.UserRoleAdmin {
		if password == "" || !verifyPassword(password, user.PasswordHash) {
			return nil, kernel.Forbidden("管理员绑定微信需要核对当前密码")
		}
	} else if user.PhoneVerifiedAt == nil {
		return nil, kernel.Forbidden("请先验证手机号后再绑定微信")
	}
	bound, err := s.WeChatBindingStatus(user)
	if err != nil {
		return nil, err
	}
	if bound {
		return nil, kernel.Forbidden("当前账号已绑定微信，无需重复绑定")
	}
	if err := s.allowWeChat(ctx, "wechat-bind-start:"+user.ID, 8, time.Hour); err != nil {
		return nil, err
	}
	if err := s.allowWeChat(ctx, "wechat-bind-ip:"+clientIP, 20, time.Hour); err != nil {
		return nil, err
	}
	return s.beginWeChatState("/settings?section=account&wechat_bound=1", user.ID, sessionID)
}

func (s *Service) beginWeChatState(nextPath, bindUserID, bindSessionID string) (*WeChatStart, error) {
	stateValue, browserToken := RandomToken(), RandomToken()
	state := &model.OAuthState{
		ID: kernel.NewID(), Provider: weChatProvider, StateHash: HashToken(stateValue), BrowserHash: HashToken(browserToken),
		BindUserID: bindUserID, BindSessionID: bindSessionID, NextPath: nextPath, ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	if err := s.repo.CreateOAuthState(state); err != nil {
		return nil, err
	}
	config := weChatConfiguration()
	target := url.URL{Scheme: "https", Host: "open.weixin.qq.com", Path: "/connect/qrconnect"}
	query := target.Query()
	query.Set("appid", config.AppID)
	query.Set("redirect_uri", config.RedirectURI)
	query.Set("response_type", "code")
	query.Set("scope", "snsapi_login")
	query.Set("state", stateValue)
	target.RawQuery = query.Encode()
	target.Fragment = "wechat_redirect"
	return &WeChatStart{URL: target.String(), BrowserToken: browserToken}, nil
}

func (s *Service) CompleteWeChatLogin(ctx context.Context, stateValue, code, browserToken, sessionCookie, clientIP string) (*WeChatCallbackResult, error) {
	if !s.WeChatAvailable() {
		return nil, kernel.Forbidden("微信扫码登录尚未启用")
	}
	if err := s.allowWeChat(ctx, "wechat-callback:"+clientIP, 30, 10*time.Minute); err != nil {
		return nil, err
	}
	if len(stateValue) != 64 || len(browserToken) != 64 || code == "" || len(code) > 512 {
		return nil, kernel.BadAuthRequest("微信授权状态无效，请重新扫码")
	}
	stateHash, browserHash, codeHash := HashToken(stateValue), HashToken(browserToken), HashToken(code)
	state, err := s.repo.ConsumeBoundOAuthState(weChatProvider, stateHash, browserHash, codeHash)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s.retryWeChatCallback(ctx, stateHash, browserHash, codeHash, sessionCookie)
	}
	if err != nil {
		return nil, err
	}
	// The provider code and state are single use. Finish the callback even if the
	// browser drops its first response, so a same-browser retry can recover it.
	callbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer cancel()
	var bindUser *model.User
	if state.BindUserID != "" {
		bindUser, err = s.CurrentUser(sessionCookie)
		sessionID, _ := parseSessionCookie(sessionCookie)
		if err != nil || bindUser.ID != state.BindUserID || sessionID != state.BindSessionID {
			return nil, kernel.Forbidden("绑定会话已变化，请重新登录并发起绑定")
		}
		bound, statusErr := s.WeChatBindingStatus(bindUser)
		if statusErr != nil {
			return nil, statusErr
		}
		if bound {
			return nil, kernel.Forbidden("当前账号已绑定微信，无需重复绑定")
		}
	} else if _, err := s.CurrentUser(sessionCookie); err == nil {
		return nil, kernel.Forbidden("当前已登录，请在账号设置中主动绑定微信")
	}
	token, err := exchangeWeChatCode(callbackCtx, s.wechatHTTPClient, s.wechatTokenURL, weChatConfiguration(), code)
	if err != nil {
		return nil, err
	}
	subject := weChatConfiguration().AppID + ":" + token.OpenID
	if len(subject) > 160 {
		return nil, kernel.BadAuthRequest("微信身份响应无效")
	}
	if bindUser != nil {
		if err := s.repo.BindWeChatIdentity(bindUser.ID, subject); err != nil {
			if errors.Is(err, repository.ErrOAuthIdentityConflict) {
				return nil, kernel.Forbidden("该微信账号已绑定其他用户，或当前用户已绑定微信")
			}
			if errors.Is(err, repository.ErrOAuthMergeConflict) {
				return nil, kernel.NewAppError(409, "微信账号存在正在处理的订单或无法自动合并的数据，请联系支持处理")
			}
			return nil, err
		}
		if err := s.repo.CompleteBoundOAuthState(state.ID, codeHash, bindUser.ID, true); err != nil {
			return nil, err
		}
		s.syncWeChatProfileLater(bindUser, token)
		return &WeChatCallbackResult{Next: state.NextPath, Bound: true}, nil
	}
	identity, err := s.repo.UserIdentity(weChatProvider, subject)
	var user *model.User
	if err == nil {
		user, err = s.repo.User(identity.UserID)
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		if !weChatRegistrationEnabled() {
			return nil, kernel.Forbidden("微信新用户注册暂未开放")
		}
		secret := RandomToken()
		passwordHash, hashErr := HashPassword(secret)
		if hashErr != nil {
			return nil, hashErr
		}
		user = &model.User{ID: kernel.NewID(), Username: "wx_" + secret[:24], DisplayName: "微信用户", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: passwordHash}
		identity = &model.UserIdentity{ID: kernel.NewID(), UserID: user.ID, Provider: weChatProvider, Subject: subject}
		if createErr := s.repo.CreateOAuthUser(user, identity); createErr != nil {
			// A concurrent callback may have created this identity first. Never
			// merge based on profile data or promote the new account's role.
			identity, err = s.repo.UserIdentity(weChatProvider, subject)
			if err != nil {
				return nil, createErr
			}
			user, err = s.repo.User(identity.UserID)
		} else {
			err = nil
		}
	}
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	now := time.Now()
	if err := s.repo.UpdateUserLoginTime(user.ID, now); err != nil {
		return nil, err
	}
	session, err := s.createAuthSession(user, NewLoginLog("wechat", "login", LoginContext{}))
	if err != nil {
		return nil, err
	}
	if err := s.repo.CompleteBoundOAuthState(state.ID, codeHash, user.ID, false); err != nil {
		return nil, err
	}
	s.syncWeChatProfileLater(user, token)
	return &WeChatCallbackResult{Session: session, Next: safeOAuthNext(state.NextPath)}, nil
}

func (s *Service) retryWeChatCallback(ctx context.Context, stateHash, browserHash, codeHash, sessionCookie string) (*WeChatCallbackResult, error) {
	deadline := time.Now().Add(12 * time.Second)
	for {
		state, err := s.repo.RetriableBoundOAuthState(weChatProvider, stateHash, browserHash, codeHash)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, kernel.BadAuthRequest("微信授权状态无效或已使用，请重新扫码")
			}
			return nil, err
		}
		if state.CallbackUserID != "" {
			if state.CallbackBound {
				sessionID, _ := parseSessionCookie(sessionCookie)
				if sessionID != state.BindSessionID {
					return nil, kernel.Forbidden("绑定会话已变化，请重新登录并发起绑定")
				}
				return &WeChatCallbackResult{Next: state.NextPath, Bound: true}, nil
			}
			user, err := s.repo.User(state.CallbackUserID)
			if err != nil {
				return nil, err
			}
			if user.Status != model.UserStatusActive {
				return nil, kernel.Forbidden("该账号已被禁用")
			}
			session, err := s.createAuthSession(user, NewLoginLog("wechat", "login", LoginContext{}))
			if err != nil {
				return nil, err
			}
			return &WeChatCallbackResult{Session: session, Next: safeOAuthNext(state.NextPath)}, nil
		}
		if time.Now().After(deadline) {
			return nil, kernel.NewAppError(503, "微信授权处理中，请稍后重试")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (s *Service) syncWeChatProfileLater(user *model.User, token weChatToken) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		s.syncWeChatProfile(ctx, user, token)
	}()
}

func (s *Service) allowWeChat(ctx context.Context, key string, limit int, window time.Duration) error {
	allowed, err := s.host.AllowRequest(ctx, key, limit, window)
	if err != nil {
		return kernel.NewAppError(503, "登录安全服务暂不可用")
	}
	if !allowed {
		return kernel.RateLimited("微信登录尝试过于频繁，请稍后重试")
	}
	return nil
}

func exchangeWeChatCode(ctx context.Context, client *http.Client, endpoint string, config weChatConfig, code string) (weChatToken, error) {
	query := url.Values{"appid": {config.AppID}, "secret": {config.AppSecret}, "code": {code}, "grant_type": {"authorization_code"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return weChatToken{}, kernel.BadAuthRequest("微信授权请求无效")
	}
	resp, err := client.Do(req)
	if err != nil {
		return weChatToken{}, kernel.NewAppError(503, "微信授权服务暂不可用")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return weChatToken{}, kernel.NewAppError(503, "微信授权服务返回异常")
	}
	var payload struct {
		ErrCode     int    `json:"errcode"`
		AccessToken string `json:"access_token"`
		OpenID      string `json:"openid"`
		Scope       string `json:"scope"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<10)).Decode(&payload); err != nil {
		return weChatToken{}, kernel.NewAppError(503, "微信授权响应无效")
	}
	if payload.ErrCode != 0 {
		log.Printf("wechat website OAuth code exchange rejected: errcode=%d", payload.ErrCode)
		return weChatToken{}, kernel.BadAuthRequest("微信授权未通过，请重新扫码")
	}
	if payload.AccessToken == "" || payload.OpenID == "" || !strings.Contains(","+payload.Scope+",", ",snsapi_login,") {
		return weChatToken{}, kernel.BadAuthRequest("微信授权响应缺少必要身份信息")
	}
	return weChatToken{AccessToken: payload.AccessToken, OpenID: payload.OpenID}, nil
}

func fetchWeChatProfile(ctx context.Context, client *http.Client, endpoint string, token weChatToken) (*weChatProfile, error) {
	query := url.Values{"access_token": {token.AccessToken}, "openid": {token.OpenID}, "lang": {"zh_CN"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("wechat userinfo unavailable")
	}
	var profile weChatProfile
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<10)).Decode(&profile); err != nil {
		return nil, err
	}
	if profile.ErrCode != 0 || profile.OpenID != token.OpenID {
		return nil, errors.New("wechat userinfo identity mismatch or permission denied")
	}
	return &profile, nil
}

func (s *Service) syncWeChatProfile(ctx context.Context, user *model.User, token weChatToken) {
	if user.ProfileNameEdited && user.ProfileAvatarEdited {
		return
	}
	profile, err := fetchWeChatProfile(ctx, s.wechatHTTPClient, s.wechatUserInfoURL, token)
	if err != nil {
		log.Printf("wechat profile unavailable")
		return
	}
	if strings.EqualFold(os.Getenv("CANVAS_WECHAT_PROFILE_DIAGNOSTICS"), "true") {
		log.Printf("wechat profile availability nickname=%t avatar=%t stored_avatar=%t name_edited=%t avatar_edited=%t",
			strings.TrimSpace(profile.Nickname) != "", strings.TrimSpace(profile.AvatarURL) != "",
			user.AvatarURL != "", user.ProfileNameEdited, user.ProfileAvatarEdited)
	}
	name := ""
	if !user.ProfileNameEdited && (user.DisplayName == "" || user.DisplayName == "微信用户" || user.DisplayName == "手机用户") {
		name, _ = NormalizeProfileNickname(profile.Nickname)
	}
	avatarURL := ""
	if !user.ProfileAvatarEdited && user.AvatarURL == "" && profile.AvatarURL != "" {
		if avatarHost, ok := s.host.(interface {
			StoreWeChatAvatar(context.Context, string, string) (string, error)
		}); ok {
			avatarURL, err = avatarHost.StoreWeChatAvatar(ctx, user.ID, profile.AvatarURL)
			if err != nil {
				log.Printf("wechat avatar import failed")
			}
		}
	}
	if name != "" || avatarURL != "" {
		if err := s.repo.UpdateWeChatProfileIfUnedited(user.ID, name, avatarURL); err != nil {
			log.Printf("wechat profile persistence failed: %v", err)
			return
		}

	}
}
