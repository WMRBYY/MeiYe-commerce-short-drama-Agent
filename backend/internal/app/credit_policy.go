package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const creditPolicySettingKey = "credit_policy"
const dailyCreditMicrocredits int64 = 200_000

var beijingTime = time.FixedZone("Asia/Shanghai", 8*60*60)

func (s *Service) creditNow() time.Time {
	if s.creditClock != nil {
		return s.creditClock()
	}
	return time.Now()
}

type CreditPolicy struct {
	SignupBonusMicrocredits  int64            `json:"signupBonusMicrocredits"`
	CheckinBonusMicrocredits int64            `json:"checkinBonusMicrocredits"`
	DefaultMultiplierBPS     int64            `json:"defaultMultiplierBasisPoints"`
	ModelMultiplierBPS       map[string]int64 `json:"modelMultiplierBasisPoints"`
}

type PublicCreditPolicy struct {
	SignupBonusMicrocredits  int64      `json:"signupBonusMicrocredits"`
	CheckinBonusMicrocredits int64      `json:"checkinBonusMicrocredits"`
	CheckedInToday           bool       `json:"checkedInToday"`
	PendingMicrocredits      int64      `json:"pendingMicrocredits"`
	OldestExpiresAt          *time.Time `json:"oldestExpiresAt"`
	NextRefreshAt            time.Time  `json:"nextRefreshAt"`
}

func defaultCreditPolicy() CreditPolicy {
	return CreditPolicy{CheckinBonusMicrocredits: dailyCreditMicrocredits, DefaultMultiplierBPS: 10_000, ModelMultiplierBPS: map[string]int64{}}
}

func validateCreditPolicy(policy CreditPolicy) error {
	if policy.SignupBonusMicrocredits < 0 || policy.CheckinBonusMicrocredits < 0 {
		return BadAuthRequest("注册和签到奖励不能小于 0")
	}
	if policy.SignupBonusMicrocredits > 1_000_000*CreditScale || policy.CheckinBonusMicrocredits > 100_000*CreditScale {
		return BadAuthRequest("积分奖励超出允许范围")
	}
	if policy.DefaultMultiplierBPS <= 0 || policy.DefaultMultiplierBPS > 1_000_000 {
		return BadAuthRequest("默认模型倍率必须在 0.0001-100 之间")
	}
	for modelKey, multiplier := range policy.ModelMultiplierBPS {
		if strings.TrimSpace(modelKey) == "" || multiplier <= 0 || multiplier > 1_000_000 {
			return BadAuthRequest("模型倍率配置无效")
		}
	}
	return nil
}

const creditPolicyCacheTTL = 5 * time.Minute

func (s *Service) creditPolicy() (CreditPolicy, error) {
	s.creditPolicyMu.RLock()
	if s.creditPolicyCache != nil && time.Since(s.creditPolicyAt) < creditPolicyCacheTTL {
		policy := *s.creditPolicyCache
		s.creditPolicyMu.RUnlock()
		return policy, nil
	}
	s.creditPolicyMu.RUnlock()
	policy, err := s.readCreditPolicy()
	if err != nil {
		return CreditPolicy{}, err
	}
	s.creditPolicyMu.Lock()
	s.creditPolicyCache = &policy
	s.creditPolicyAt = time.Now()
	s.creditPolicyMu.Unlock()
	return policy, nil
}

// readCreditPolicy bypasses the local display cache for billing decisions.
func (s *Service) readCreditPolicy() (CreditPolicy, error) {
	setting, err := s.repo.SystemSetting(creditPolicySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultCreditPolicy(), nil
	}
	if err != nil {
		return CreditPolicy{}, err
	}
	var policy CreditPolicy
	if json.Unmarshal([]byte(setting.ValueJSON), &policy) != nil {
		return CreditPolicy{}, errors.New("积分策略配置格式无效")
	}
	if policy.ModelMultiplierBPS == nil {
		policy.ModelMultiplierBPS = map[string]int64{}
	}
	// Historical settings may still contain a signup reward. Keep the setting
	// and past ledger intact while making the effective policy permanently zero.
	policy.SignupBonusMicrocredits = 0
	policy.CheckinBonusMicrocredits = dailyCreditMicrocredits
	if err := validateCreditPolicy(policy); err != nil {
		return CreditPolicy{}, err
	}
	return policy, nil
}

func (s *Service) AdminCreditPolicy(actor *model.User) (CreditPolicy, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CreditPolicy{}, err
	}
	return s.readCreditPolicy()
}

func (s *Service) UpdateCreditPolicy(actor *model.User, policy CreditPolicy) (CreditPolicy, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CreditPolicy{}, err
	}
	if policy.SignupBonusMicrocredits != 0 {
		return CreditPolicy{}, BadAuthRequest("新用户初始积分固定为 0")
	}
	if policy.ModelMultiplierBPS == nil {
		policy.ModelMultiplierBPS = map[string]int64{}
	}
	policy.CheckinBonusMicrocredits = dailyCreditMicrocredits
	if err := validateCreditPolicy(policy); err != nil {
		return CreditPolicy{}, err
	}
	encoded, err := json.Marshal(policy)
	if err != nil {
		return CreditPolicy{}, err
	}
	setting := model.SystemSetting{Key: creditPolicySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	current, err := s.repo.SystemSetting(creditPolicySettingKey)
	if err == nil {
		setting.CreatedAt = current.CreatedAt
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return CreditPolicy{}, err
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return CreditPolicy{}, err
	}
	s.creditPolicyMu.Lock()
	s.creditPolicyCache = nil
	s.creditPolicyMu.Unlock()
	if err := s.appendAdminAudit(actor, "credit_policy.update", "system_setting", creditPolicySettingKey, "更新积分策略", policy); err != nil {
		return CreditPolicy{}, err
	}
	return policy, nil
}

func dailyCreditDays(now, migratedAt, registeredAt time.Time) ([]string, time.Time) {
	today := now.In(beijingTime)
	next := time.Date(today.Year(), today.Month(), today.Day()+1, 0, 0, 0, 0, beijingTime)
	if now.Before(migratedAt) || (!registeredAt.IsZero() && now.Before(registeredAt)) {
		return []string{}, next
	}
	return []string{today.Format("2006-01-02")}, next
}

func (s *Service) CheckinCredits(user *model.User) (*model.CreditAccount, bool, error) {
	if user == nil {
		return nil, false, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, false, err
	}
	migratedAt, err := s.repo.DailyCreditStartsAt()
	if err != nil {
		return nil, false, err
	}
	days, _ := dailyCreditDays(s.creditNow(), migratedAt, user.CreatedAt)
	if len(days) == 0 {
		return nil, false, BadAuthRequest("每日赠加油尚未开始")
	}
	account, granted, err := s.repo.ClaimDailyCredits(user.ID, days, dailyCreditMicrocredits)
	return account, granted > 0, err
}

func (s *Service) publicCreditPolicy(user *model.User) (PublicCreditPolicy, error) {
	policy, err := s.creditPolicy()
	if err != nil {
		return PublicCreditPolicy{}, err
	}
	migratedAt, err := s.repo.DailyCreditStartsAt()
	if err != nil {
		return PublicCreditPolicy{}, err
	}
	days, next := dailyCreditDays(s.creditNow(), migratedAt, user.CreatedAt)
	pending, err := s.repo.UnclaimedDailyCreditDays(user.ID, days)
	if err != nil {
		return PublicCreditPolicy{}, err
	}
	var oldestExpiresAt *time.Time
	if len(pending) > 0 {
		oldest, parseErr := time.ParseInLocation("2006-01-02", pending[0], beijingTime)
		if parseErr != nil {
			return PublicCreditPolicy{}, parseErr
		}
		expires := oldest.AddDate(0, 0, 1)
		oldestExpiresAt = &expires
	}
	checked := len(days) > 0 && (len(pending) == 0 || pending[len(pending)-1] != days[len(days)-1])
	todayAmount := dailyCreditMicrocredits
	if len(days) == 0 {
		todayAmount = 0
	}
	return PublicCreditPolicy{SignupBonusMicrocredits: policy.SignupBonusMicrocredits,
		CheckinBonusMicrocredits: todayAmount, CheckedInToday: checked,
		PendingMicrocredits: int64(len(pending)) * dailyCreditMicrocredits,
		OldestExpiresAt:     oldestExpiresAt, NextRefreshAt: next}, nil
}

// 单价、数量和倍率全程使用整数并向上取整，避免浮点误差造成少扣积分。
func creditAmount(unitPrice int64, quantity int64, multiplierBPS int64) (int64, error) {
	if unitPrice < 0 || quantity <= 0 || multiplierBPS <= 0 {
		return 0, errors.New("积分计费参数无效")
	}
	if unitPrice > (1<<63-1)/quantity {
		return 0, errors.New("积分计费金额溢出")
	}
	base := unitPrice * quantity
	if base > ((1<<63-1)-9_999)/multiplierBPS {
		return 0, errors.New("积分计费金额溢出")
	}
	amount := (base*multiplierBPS + 9_999) / 10_000
	if amount < 0 {
		return 0, fmt.Errorf("积分计费金额无效：%d", amount)
	}
	return amount, nil
}
