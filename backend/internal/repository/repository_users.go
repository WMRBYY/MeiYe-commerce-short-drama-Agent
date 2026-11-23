// 用户、登录会话与邮箱验证码的持久化。
//
// 注册与重置密码必须在同一事务内消费验证码，防止并发请求重复使用同一个码。

package repository

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (r *Repository) UserCount() (int64, error) {
	var count int64
	err := r.db.Model(&model.User{}).Count(&count).Error
	return count, err
}

func (r *Repository) User(id string) (*model.User, error) {
	var user model.User
	if err := r.db.First(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// Profile writes only these columns, so concurrent login and account updates survive.
func (r *Repository) UpdateOwnProfile(userID string, name *string, avatarURL *string) (*model.User, error) {
	updates := map[string]any{"updated_at": time.Now()}
	if name != nil {
		updates["display_name"] = *name
		updates["profile_name_edited"] = true
	}
	if avatarURL != nil {
		updates["avatar_url"] = *avatarURL
		updates["avatar_mode"] = ""
		updates["avatar_version"] = ""
		updates["profile_avatar_edited"] = true
	}
	result := r.db.Model(&model.User{}).Where("id = ? AND status = ?", userID, model.UserStatusActive).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	return r.User(userID)
}

// WeChat may only fill fields that the user has never edited. An empty provider
// value is ignored; one provider response cannot erase an existing profile.
func (r *Repository) UpdateWeChatProfileIfUnedited(userID, name, avatarURL string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if name != "" {
			if err := tx.Model(&model.User{}).Where("id = ? AND profile_name_edited = ? AND display_name IN ?", userID, false, []string{"", "微信用户", "手机用户"}).
				Updates(map[string]any{"display_name": name, "updated_at": time.Now()}).Error; err != nil {
				return err
			}
		}
		if avatarURL != "" {
			if err := tx.Model(&model.User{}).Where("id = ? AND profile_avatar_edited = ? AND (avatar_url IS NULL OR avatar_url = ?)", userID, false, "").
				Updates(map[string]any{"avatar_url": avatarURL, "updated_at": time.Now()}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// UpdateUserLoginTime preserves concurrent changes to status and profile fields.
func (r *Repository) UpdateUserLoginTime(userID string, now time.Time) error {
	return r.db.Model(&model.User{}).Where("id = ?", userID).
		Updates(map[string]any{"last_login_at": now, "updated_at": now}).Error
}

func (r *Repository) UserByAccount(account string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("lower(username) = lower(?) OR lower(email) = lower(?)", account, account).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// PhoneUserOrCreate serializes first-time registrations for a verified number.
// The existing partial unique index on users(phone) remains the final guard.
func (r *Repository) PhoneUserOrCreate(phone string, create bool, candidate *model.User) (*model.User, bool, error) {
	var user model.User
	created := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "registration-phone:"+phone).Error; err != nil {
				return err
			}
		} else if tx.Dialector.Name() == "sqlite" {
			if err := tx.Exec("UPDATE users SET updated_at = updated_at WHERE 1 = 0").Error; err != nil {
				return err
			}
		} else {
			return gorm.ErrInvalidData
		}
		if err := tx.First(&user, "phone = ?", phone).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if !create || candidate == nil {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Create(candidate).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.CreditAccount{UserID: candidate.ID}).Error; err != nil {
			return err
		}
		user = *candidate
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &user, created, nil
}

// VerifyBoundAdminPhone marks only the explicitly selected, already-bound
// administrator number as verified after the SMS provider has accepted a code.
func (r *Repository) VerifyBoundAdminPhone(userID, phone string, now time.Time) error {
	result := r.db.Model(&model.User{}).
		Where("id = ? AND phone = ? AND role = ? AND status = ?", userID, phone, model.UserRoleAdmin, model.UserStatusActive).
		Updates(map[string]any{"phone_verified_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) UserByUsername(username string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("lower(username) = lower(?)", username).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) UserByEmail(email string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("email <> '' AND lower(email) = lower(?)", email).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) Users() ([]model.User, error) {
	var users []model.User
	err := r.db.Order("created_at desc").Find(&users).Error
	return users, err
}

func (r *Repository) TotalCreditBalance() (int64, error) {
	var total int64
	err := r.db.Model(&model.CreditAccount{}).Select("COALESCE(SUM(available_microcredits), 0)").Scan(&total).Error
	// Some analytics fixtures predate the wallet table; the balance card is a
	// read-only enhancement and must not make the existing overview unavailable.
	if err != nil && (strings.Contains(err.Error(), "no such table") || strings.Contains(strings.ToLower(err.Error()), "does not exist")) {
		return 0, nil
	}
	return total, err
}

// AdminUserKeyword 规整后台搜索词：表格里展示的是 "@username"，管理员常整段复制粘贴，去掉开头的 @。
func AdminUserKeyword(keyword string) string {
	return strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(keyword), "@＠"))
}

// adminLikePattern 转义 LIKE 通配符，phone_xxx 这类用户名按字面匹配。
func adminLikePattern(value string) string {
	escaped := strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.ToLower(value))
	return "%" + escaped + "%"
}

// group 为空表示不过滤；default 分组同时匹配未分配分组（空编码）的用户。
// sort 为 credits_asc / credits_desc 时按可用积分排序，否则按注册时间倒序。
func (r *Repository) AdminUsers(keyword string, role model.UserRole, status model.UserStatus, group string, sort string, limit int, offset int) ([]model.User, int64, error) {
	var users []model.User
	var total int64
	query := r.db.Model(&model.User{})
	if value := strings.TrimSpace(group); value == model.DefaultUserGroupCode {
		query = query.Where("user_group = ? OR user_group = ''", value)
	} else if value != "" {
		query = query.Where("user_group = ?", value)
	}
	if value := AdminUserKeyword(keyword); value != "" {
		pattern := adminLikePattern(value)
		query = query.Where(`lower(users.username) LIKE ? ESCAPE '\' OR lower(users.display_name) LIKE ? ESCAPE '\' OR lower(users.email) LIKE ? ESCAPE '\' OR users.id = ?`, pattern, pattern, pattern, value)
	}
	if role == model.UserRoleAdmin || role == model.UserRoleUser {
		query = query.Where("role = ?", role)
	}
	if status == model.UserStatusActive || status == model.UserStatusDisabled {
		query = query.Where("status = ?", status)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	switch sort {
	case "credits_asc", "credits_desc":
		direction := "ASC"
		if sort == "credits_desc" {
			direction = "DESC"
		}
		query = query.Select("users.*").
			Joins("LEFT JOIN credit_accounts ON credit_accounts.user_id = users.id").
			Order("COALESCE(credit_accounts.available_microcredits, 0) " + direction + ", users.created_at DESC, users.id DESC")
	default:
		query = query.Order("users.created_at DESC, users.id DESC")
	}
	if err := query.Limit(limit).Offset(offset).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func (r *Repository) AdminUserReferences() ([]model.User, error) {
	var users []model.User
	err := r.db.Select("id", "username", "display_name").Order("created_at desc").Limit(100).Find(&users).Error
	return users, err
}

func (r *Repository) ActiveAdminCountExcluding(userID string) (int64, error) {
	var count int64
	query := r.db.Model(&model.User{}).Where("role = ? AND status = ?", model.UserRoleAdmin, model.UserStatusActive)
	if userID != "" {
		query = query.Where("id <> ?", userID)
	}
	err := query.Count(&count).Error
	return count, err
}

func (r *Repository) AuthSession(id string) (*model.AuthSession, error) {
	var session model.AuthSession
	if err := r.db.First(&session, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) DeleteAuthSession(id string) error {
	return r.db.Delete(&model.AuthSession{}, "id = ?", id).Error
}

func (r *Repository) DeleteExpiredAuthSessions() error {
	return r.db.Delete(&model.AuthSession{}, "expires_at <= ?", time.Now()).Error
}

func (r *Repository) DeleteUserAuthSessions(userID string) error {
	return r.db.Delete(&model.AuthSession{}, "user_id = ?", userID).Error
}

func (r *Repository) LatestEmailVerificationCode(email string, purpose string) (*model.EmailVerificationCode, error) {
	var code model.EmailVerificationCode
	if err := r.db.Where("email = ? AND purpose = ? AND used_at IS NULL", email, purpose).Order("created_at desc").First(&code).Error; err != nil {
		return nil, err
	}
	return &code, nil
}

func (r *Repository) MarkEmailVerificationCodeUsed(id string, usedAt time.Time) error {
	return r.db.Model(&model.EmailVerificationCode{}).Where("id = ? AND used_at IS NULL", id).Update("used_at", usedAt).Error
}

func (r *Repository) DeleteEmailVerificationCode(id string) error {
	return r.db.Delete(&model.EmailVerificationCode{}, "id = ?", id).Error
}

func (r *Repository) CreateUserWithEmailVerification(user *model.User, verificationCodeID string, usedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationEmail(tx, user.Email); err != nil {
			return err
		}
		if err := New(tx).CheckEmailAvailable(user.Email, ""); err != nil {
			return err
		}
		result := tx.Model(&model.EmailVerificationCode{}).Where("id = ? AND used_at IS NULL AND expires_at > ?", verificationCodeID, usedAt).Update("used_at", usedAt)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("邮箱验证码已失效，请重新获取")
		}
		return tx.Create(user).Error
	})
}

func (r *Repository) ResetUserPasswordWithEmailVerification(userID string, email string, purpose string, verificationCodeID string, passwordHash string, usedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		codeResult := tx.Model(&model.EmailVerificationCode{}).
			Where("id = ? AND email = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?", verificationCodeID, email, purpose, usedAt).
			Update("used_at", usedAt)
		if codeResult.Error != nil {
			return codeResult.Error
		}
		if codeResult.RowsAffected != 1 {
			return ErrEmailVerificationCodeInvalid
		}

		userResult := tx.Model(&model.User{}).
			Where("id = ? AND email <> '' AND lower(email) = lower(?) AND status = ? AND password_hash <> ''", userID, email, model.UserStatusActive).
			Updates(map[string]any{"password_hash": passwordHash, "updated_at": usedAt})
		if userResult.Error != nil {
			return userResult.Error
		}
		if userResult.RowsAffected != 1 {
			return ErrEmailVerificationCodeInvalid
		}
		if err := tx.Delete(&model.AuthSession{}, "user_id = ?", userID).Error; err != nil {
			return err
		}
		return tx.Model(&model.EmailVerificationCode{}).
			Where("email = ? AND purpose = ? AND used_at IS NULL", email, purpose).
			Update("used_at", usedAt).Error
	})
}

func (r *Repository) DeleteExpiredEmailVerificationCodes(now time.Time) error {
	return r.db.Delete(&model.EmailVerificationCode{}, "expires_at <= ? OR used_at IS NOT NULL", now).Error
}
