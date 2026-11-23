package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

// Per-user base storage overrides live in system settings, one row per user,
// so no schema change is needed. An override replaces the global default base
// (runtime policy resource.storedFileGB) for that user; granted or purchased
// capacity is still added on top.
const userStorageQuotaSettingPrefix = "user_storage_quota:"

const (
	minUserStorageQuotaBytes = int64(100) << 20     // 100 MB
	maxUserStorageQuotaBytes = int64(100_000) << 30 // 100000 GB
)

type userStorageQuotaValue struct {
	BaseBytes int64  `json:"baseBytes"`
	Note      string `json:"note,omitempty"`
}

// UserStorageQuotaOverride is one user's base capacity override as shown to admins.
type UserStorageQuotaOverride struct {
	UserID      string    `json:"userId"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	BaseBytes   int64     `json:"baseBytes"`
	UsedBytes   int64     `json:"usedBytes"`
	TotalBytes  int64     `json:"totalBytes"`
	Note        string    `json:"note,omitempty"`
	UpdatedBy   string    `json:"updatedBy,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type AdminStorageQuotaOverview struct {
	DefaultStoredFileGB int64                      `json:"defaultStoredFileGB"`
	MaxDefaultGB        int64                      `json:"maxDefaultGB"`
	Overrides           []UserStorageQuotaOverride `json:"overrides"`
}

type AdminStorageQuotaDefaultRequest struct {
	StoredFileGB int64 `json:"storedFileGB"`
}

// AdminUserStorageQuotaRequest sets (BaseBytes > 0) or clears (nil) one user's base capacity.
type AdminUserStorageQuotaRequest struct {
	BaseBytes *int64 `json:"baseBytes"`
	Note      string `json:"note"`
}

func userStorageQuotaKey(userID string) string { return userStorageQuotaSettingPrefix + userID }

// userStorageBase returns the base capacity for a user: the per-user override
// when one exists, otherwise the global default from the runtime policy.
func (s *Service) userStorageBase(userID string, policy RuntimePolicySetting) (int64, bool, error) {
	setting, err := s.repo.SystemSettingOptional(userStorageQuotaKey(userID))
	if err != nil {
		return 0, false, err
	}
	if setting != nil {
		var value userStorageQuotaValue
		if json.Unmarshal([]byte(setting.ValueJSON), &value) == nil && value.BaseBytes > 0 {
			return value.BaseBytes, true, nil
		}
	}
	return gigabytes(policy.Resource.StoredFileGB), false, nil
}

func (s *Service) AdminStorageQuotaOverview(actor *model.User) (*AdminStorageQuotaOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	settings, err := s.repo.SystemSettingsWithPrefix(userStorageQuotaSettingPrefix, 1000)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(settings))
	values := map[string]userStorageQuotaValue{}
	updated := map[string]model.SystemSetting{}
	for _, setting := range settings {
		userID := strings.TrimPrefix(setting.Key, userStorageQuotaSettingPrefix)
		var value userStorageQuotaValue
		if userID == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil || value.BaseBytes <= 0 {
			continue
		}
		ids, values[userID], updated[userID] = append(ids, userID), value, setting
	}
	users, err := s.repo.UsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	overrides := make([]UserStorageQuotaOverride, 0, len(ids))
	now := time.Now()
	for _, userID := range ids {
		user, ok := users[userID]
		if !ok {
			continue
		}
		used, err := s.repo.UserStoredFileBytes(userID)
		if err != nil {
			return nil, err
		}
		purchased, _, err := s.repo.UserStorageGrantSummary(userID, now)
		if err != nil {
			return nil, err
		}
		value := values[userID]
		overrides = append(overrides, UserStorageQuotaOverride{
			UserID: userID, Username: user.Username, DisplayName: user.DisplayName,
			BaseBytes: value.BaseBytes, UsedBytes: used, TotalBytes: capStoredFileLimit(value.BaseBytes + purchased),
			Note: value.Note, UpdatedBy: updated[userID].UpdatedBy, UpdatedAt: updated[userID].UpdatedAt,
		})
	}
	sort.Slice(overrides, func(i, j int) bool { return overrides[i].UpdatedAt.After(overrides[j].UpdatedAt) })
	return &AdminStorageQuotaOverview{DefaultStoredFileGB: policy.Resource.StoredFileGB, MaxDefaultGB: 999, Overrides: overrides}, nil
}

// AdminUpdateDefaultStorageQuota changes only resource.storedFileGB of the
// runtime policy; every other policy field is kept as it is.
func (s *Service) AdminUpdateDefaultStorageQuota(actor *model.User, request AdminStorageQuotaDefaultRequest) (*AdminStorageQuotaOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	policy.Resource.StoredFileGB = request.StoredFileGB
	storedMB := request.StoredFileGB * 1024
	if storedMB > 0 && policy.Resource.ResourceUploadMB > storedMB {
		policy.Resource.ResourceUploadMB = storedMB
	}
	if storedMB > 0 && policy.Resource.GeneratedFileMB > storedMB {
		policy.Resource.GeneratedFileMB = storedMB
	}
	if _, err := s.UpdateRuntimePolicySetting(actor, policy); err != nil {
		return nil, err
	}
	s.clearStorageStatusCache()
	return s.AdminStorageQuotaOverview(actor)
}

func (s *Service) AdminSetUserStorageQuota(actor *model.User, userID string, request AdminUserStorageQuotaRequest) (*AdminUserStorage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	user, err := s.repo.User(strings.TrimSpace(userID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("用户不存在")
	}
	if err != nil {
		return nil, err
	}
	key := userStorageQuotaKey(user.ID)
	if request.BaseBytes == nil {
		if err := s.repo.DeleteSystemSetting(key); err != nil {
			return nil, err
		}
		s.invalidateStorageStatus(user.ID)
		if err := s.appendAdminAudit(actor, "storage_quota.clear", "user", user.ID, "恢复默认存储容量", nil); err != nil {
			return nil, err
		}
		return s.AdminUserStorage(actor, user.ID)
	}
	bytes := *request.BaseBytes
	if bytes < minUserStorageQuotaBytes || bytes > maxUserStorageQuotaBytes {
		return nil, BadAuthRequest("单个用户容量必须在 0.1 GB 到 100000 GB 之间")
	}
	raw, _ := json.Marshal(userStorageQuotaValue{BaseBytes: bytes, Note: truncateRunes(strings.TrimSpace(request.Note), 200)})
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: key, ValueJSON: string(raw), UpdatedBy: actor.ID, UpdatedAt: time.Now()}); err != nil {
		return nil, err
	}
	s.invalidateStorageStatus(user.ID)
	if err := s.appendAdminAudit(actor, "storage_quota.set", "user", user.ID, fmt.Sprintf("设置存储容量为 %s", formatStorageQuota(bytes)), map[string]any{"baseBytes": bytes}); err != nil {
		return nil, err
	}
	return s.AdminUserStorage(actor, user.ID)
}

func (s *Service) clearStorageStatusCache() {
	s.storageStatusMu.Lock()
	defer s.storageStatusMu.Unlock()
	s.storageStatusCache = make(map[string]storageStatusEntry)
}

func formatStorageQuota(bytes int64) string {
	gb := float64(bytes) / float64(int64(1)<<30)
	if gb == math.Trunc(gb) {
		return fmt.Sprintf("%.0f GB", gb)
	}
	return fmt.Sprintf("%.2f GB", gb)
}
