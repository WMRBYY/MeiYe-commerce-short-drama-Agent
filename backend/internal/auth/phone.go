package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/sms"
)

const phoneTicketLifetime = 5 * time.Minute

var phoneCodePattern = regexp.MustCompile(`^[0-9]{6}$`)

func securePhoneToken() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

type PhoneAuthConfirm struct {
	Phone  string `json:"phone"`
	Ticket string `json:"ticket"`
	Code   string `json:"code"`
}

type phoneTicketRecord struct {
	PhoneHash string `json:"phoneHash"`
	OutID     string `json:"outId"`
}

func (s *Service) PhoneAuthAvailable() bool {
	return strings.EqualFold(os.Getenv("CANVAS_PHONE_AUTH_ENABLED"), "true") && s.phoneRedis != nil && s.phoneVerifier != nil
}

func phoneRegistrationEnabled() bool {
	return strings.EqualFold(os.Getenv("CANVAS_PHONE_REGISTRATION_ENABLED"), "true")
}

func (s *Service) phoneHash(phone string) (string, error) {
	return s.verificationHash("phone-auth:" + phone)
}

func (s *Service) StartPhoneAuth(ctx context.Context, rawPhone, clientIP string) (*VerificationTicket, error) {
	if !s.PhoneAuthAvailable() {
		return nil, kernel.NewAppError(503, "手机号登录暂不可用")
	}
	phone, err := sms.NormalizePhone(rawPhone)
	if err != nil {
		return nil, err
	}
	hash, err := s.phoneHash(phone)
	if err != nil {
		return nil, err
	}
	for _, limit := range []struct {
		key string
		max int
		ttl time.Duration
	}{
		{"phone-send-ip:" + clientIP, 10, 10 * time.Minute},
		{"phone-send-ip-day:" + clientIP, 40, 24 * time.Hour},
		{"phone-send-hour:" + hash, 5, time.Hour},
		{"phone-send-day:" + hash, 20, 24 * time.Hour},
	} {
		allowed, rateErr := s.host.AllowRequest(ctx, limit.key, limit.max, limit.ttl)
		if rateErr != nil {
			return nil, kernel.NewAppError(503, "短信请求协调服务不可用")
		}
		if !allowed {
			return nil, kernel.RateLimited("短信发送过于频繁，请稍后再试")
		}
	}
	cooldownKey := "canvas:phone:cooldown:" + hash
	reserved, err := s.phoneRedis.SetNX(ctx, cooldownKey, "1", time.Minute).Result()
	if err != nil {
		return nil, kernel.NewAppError(503, "短信请求协调服务不可用")
	}
	if !reserved {
		return nil, kernel.RateLimited("请等待 60 秒后重试")
	}
	// A provider timeout is ambiguous: keep the cooldown to avoid duplicate paid sends.
	ticket, err := securePhoneToken()
	if err != nil {
		return nil, kernel.NewAppError(503, "验证码请求暂不可用")
	}
	outID, err := securePhoneToken()
	if err != nil {
		return nil, kernel.NewAppError(503, "验证码请求暂不可用")
	}
	providerCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := s.phoneVerifier.Send(providerCtx, phone, outID); err != nil {
		return nil, kernel.NewAppError(503, "验证码发送失败，请稍后重试")
	}
	record, _ := json.Marshal(phoneTicketRecord{PhoneHash: hash, OutID: outID})
	key := "canvas:phone:ticket:" + HashToken(ticket)
	if err := s.phoneRedis.Set(ctx, key, record, phoneTicketLifetime).Err(); err != nil {
		return nil, kernel.NewAppError(503, "验证码状态保存失败，请稍后重试")
	}
	if err := s.phoneRedis.Set(ctx, "canvas:phone:active:"+hash, HashToken(ticket), phoneTicketLifetime).Err(); err != nil {
		_ = s.phoneRedis.Del(ctx, key).Err()
		return nil, kernel.NewAppError(503, "验证码状态保存失败，请稍后重试")
	}
	return &VerificationTicket{Ticket: ticket, ExpiresIn: int(phoneTicketLifetime.Seconds()), RetryAfter: 60}, nil
}

func (s *Service) CompletePhoneAuth(ctx context.Context, req PhoneAuthConfirm, clientIP string) (*AuthSessionResult, error) {
	if !s.PhoneAuthAvailable() {
		return nil, kernel.NewAppError(503, "手机号登录暂不可用")
	}
	phone, err := sms.NormalizePhone(req.Phone)
	if err != nil {
		return nil, err
	}
	if len(req.Ticket) != 64 || !phoneCodePattern.MatchString(req.Code) {
		return nil, invalidVerification()
	}
	hash, err := s.phoneHash(phone)
	if err != nil {
		return nil, err
	}
	for _, key := range []string{"phone-confirm-ip:" + clientIP, "phone-confirm-number:" + hash} {
		allowed, rateErr := s.host.AllowRequest(ctx, key, 20, 10*time.Minute)
		if rateErr != nil {
			return nil, kernel.NewAppError(503, "验证协调服务不可用")
		}
		if !allowed {
			return nil, kernel.RateLimited("验证尝试过于频繁，请稍后重试")
		}
	}
	ticketHash := HashToken(req.Ticket)
	key := "canvas:phone:ticket:" + ticketHash
	lockKey := key + ":lock"
	lockToken, err := securePhoneToken()
	if err != nil {
		return nil, kernel.NewAppError(503, "验证码核验暂不可用")
	}
	locked, err := s.phoneRedis.SetNX(ctx, lockKey, lockToken, 20*time.Second).Result()
	if err != nil {
		return nil, kernel.NewAppError(503, "验证协调服务不可用")
	}
	if !locked {
		return nil, kernel.RateLimited("验证码正在核验，请稍后重试")
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = redis.NewScript(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`).Run(cleanupCtx, s.phoneRedis, []string{lockKey}, lockToken).Err()
	}()
	encoded, err := s.phoneRedis.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, invalidVerification()
	}
	if err != nil {
		return nil, kernel.NewAppError(503, "验证协调服务不可用")
	}
	var ticket phoneTicketRecord
	if json.Unmarshal(encoded, &ticket) != nil || subtle.ConstantTimeCompare([]byte(ticket.PhoneHash), []byte(hash)) != 1 {
		return nil, invalidVerification()
	}
	active, err := s.phoneRedis.Get(ctx, "canvas:phone:active:"+hash).Result()
	if err != nil || active != ticketHash {
		return nil, invalidVerification()
	}
	attemptKey := key + ":attempts"
	attempts, err := s.phoneRedis.Incr(ctx, attemptKey).Result()
	if err != nil {
		return nil, kernel.NewAppError(503, "验证协调服务不可用")
	}
	if attempts == 1 {
		if err := s.phoneRedis.Expire(ctx, attemptKey, phoneTicketLifetime).Err(); err != nil {
			return nil, kernel.NewAppError(503, "验证协调服务不可用")
		}
	}
	if attempts > 5 {
		_ = s.phoneRedis.Del(ctx, key).Err()
		return nil, invalidVerification()
	}
	providerCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	valid, err := s.phoneVerifier.Check(providerCtx, phone, ticket.OutID, req.Code)
	if err != nil {
		return nil, kernel.NewAppError(503, "验证码核验服务暂不可用")
	}
	if !valid {
		return nil, invalidVerification()
	}
	// Consume before any user/session write. A DB failure requires a new code.
	if err := s.phoneRedis.Del(ctx, key).Err(); err != nil {
		return nil, kernel.NewAppError(503, "验证协调服务不可用")
	}
	user, _, err := s.verifiedPhoneUser(phone)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if err := s.repo.UpdateUserLoginTime(user.ID, now); err != nil {
		return nil, err
	}
	user.LastLoginAt = &now
	return s.createAuthSession(user, NewLoginLog("sms", "login", LoginContext{}))
}

func (s *Service) verifiedPhoneUser(phone string) (*model.User, bool, error) {
	count, err := s.repo.UserCount()
	if err != nil {
		return nil, false, err
	}
	if count == 0 {
		return nil, false, kernel.Forbidden("请先通过管理员入口初始化站点")
	}
	create := phoneRegistrationEnabled()
	now := time.Now()
	secret, err := securePhoneToken()
	if err != nil {
		return nil, false, err
	}
	username := "phone_" + secret[:20]
	passwordHash, err := HashPassword(secret)
	if err != nil {
		return nil, false, err
	}
	candidate := &model.User{ID: kernel.NewID(), Username: username, Phone: phone, PhoneVerifiedAt: &now, DisplayName: "手机用户", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: passwordHash, CreatedAt: now, UpdatedAt: now}
	user, created, err := s.repo.PhoneUserOrCreate(phone, create, candidate)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, kernel.Forbidden("该手机号尚未注册，手机号注册暂未开放")
	}
	if err != nil {
		return nil, false, err
	}
	if user.Status != model.UserStatusActive {
		return nil, false, kernel.Forbidden("该账号已被禁用")
	}
	if !created && user.Role == model.UserRoleAdmin {
		// SMS must never elevate a newly registered user. Only a pre-bound
		// administrator selected by a server-side ID may use this path.
		if user.ID == "" || user.ID != strings.TrimSpace(os.Getenv("CANVAS_PHONE_ADMIN_LOGIN_USER_ID")) {
			return nil, false, kernel.Forbidden("该手机号不能通过短信登录，请使用原有登录方式")
		}
		if user.PhoneVerifiedAt == nil {
			if err := s.repo.VerifyBoundAdminPhone(user.ID, phone, now); err != nil {
				return nil, false, err
			}
			user.PhoneVerifiedAt = &now
		}
	} else if !created && (user.Role != model.UserRoleUser || user.PhoneVerifiedAt == nil) {
		return nil, false, kernel.Forbidden("该手机号不能通过短信登录，请使用原有登录方式")
	}
	return user, created, nil
}
