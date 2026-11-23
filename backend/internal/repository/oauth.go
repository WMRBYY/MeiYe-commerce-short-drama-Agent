package repository

import (
	"database/sql"
	"errors"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrOAuthIdentityConflict = errors.New("third-party identity is already bound")

func (r *Repository) UserIdentity(provider string, subject string) (*model.UserIdentity, error) {
	var identity model.UserIdentity
	if err := r.db.First(&identity, "provider = ? AND subject = ?", provider, subject).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

func (r *Repository) UserIdentityForUser(userID string, provider string) (*model.UserIdentity, error) {
	var identity model.UserIdentity
	if err := r.db.First(&identity, "user_id = ? AND provider = ?", userID, provider).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

func (r *Repository) CreateOAuthState(state *model.OAuthState) error {
	return r.db.Create(state).Error
}

func (r *Repository) PendingOAuthState(provider, stateHash string) (*model.OAuthState, error) {
	var state model.OAuthState
	err := r.db.First(&state, "provider = ? AND state_hash = ? AND used_at IS NULL AND expires_at > ?", provider, stateHash, time.Now()).Error
	return &state, err
}

func (r *Repository) CreateUserIdentity(identity *model.UserIdentity) error {
	return r.db.Create(identity).Error
}

func (r *Repository) ConsumeOAuthState(provider string, stateHash string) (*model.OAuthState, error) {
	var state model.OAuthState
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&state, "provider = ? AND state_hash = ? AND used_at IS NULL AND expires_at > ?", provider, stateHash, time.Now()).Error; err != nil {
			return err
		}
		now := time.Now()
		updates := map[string]any{"used_at": &now}
		if state.ProfileJSON != "" {
			updates["profile_json"] = ""
		}
		updated := tx.Model(&model.OAuthState{}).Where("id = ? AND used_at IS NULL", state.ID).Updates(updates)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		state.UsedAt = &now
		return nil
	})
	return &state, err
}

// ConsumeBoundOAuthState atomically consumes a state only from the browser that
// started the authorization. A copied callback URL alone cannot create a session.
func (r *Repository) ConsumeBoundOAuthState(provider, stateHash, browserHash, codeHash string) (*model.OAuthState, error) {
	var state model.OAuthState
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&state, "provider = ? AND state_hash = ? AND browser_hash = ? AND used_at IS NULL AND expires_at > ?", provider, stateHash, browserHash, time.Now()).Error; err != nil {
			return err
		}
		now := time.Now()
		updated := tx.Model(&model.OAuthState{}).Where("id = ? AND used_at IS NULL", state.ID).
			Updates(map[string]any{"used_at": now, "callback_code_hash": codeHash})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		state.UsedAt = &now
		state.CallbackCodeHash = codeHash
		return nil
	})
	return &state, err
}

// A retry needs the original browser proof and authorization code. It is only
// available briefly after the first callback, which may have lost its response.
func (r *Repository) RetriableBoundOAuthState(provider, stateHash, browserHash, codeHash string) (*model.OAuthState, error) {
	var state model.OAuthState
	err := r.db.First(&state, "provider = ? AND state_hash = ? AND browser_hash = ? AND callback_code_hash = ? AND used_at > ? AND expires_at > ?",
		provider, stateHash, browserHash, codeHash, time.Now().Add(-30*time.Second), time.Now()).Error
	return &state, err
}

func (r *Repository) CompleteBoundOAuthState(id, codeHash, userID string, bound bool) error {
	updated := r.db.Model(&model.OAuthState{}).
		Where("id = ? AND callback_code_hash = ? AND callback_user_id = ''", id, codeHash).
		Updates(map[string]any{"callback_user_id": userID, "callback_bound": bound})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// BindWeChatIdentity links a scanned WeChat identity to a verified phone account.
func (r *Repository) BindWeChatIdentity(userID, subject string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing model.UserIdentity
		identityQuery := tx
		if tx.Dialector.Name() == "postgres" {
			identityQuery = identityQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		err := identityQuery.First(&existing, "provider = ? AND subject = ?", "wechat_website", subject).Error
		if err == nil {
			if existing.UserID == userID {
				return ErrOAuthIdentityConflict
			}
			var targetIdentity model.UserIdentity
			if targetErr := tx.First(&targetIdentity, "provider = ? AND user_id = ?", "wechat_website", userID).Error; targetErr == nil {
				return ErrOAuthIdentityConflict
			} else if !errors.Is(targetErr, gorm.ErrRecordNotFound) {
				return targetErr
			}
			return mergeWeChatAccountIntoPhone(tx, existing, userID)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		err = tx.First(&existing, "provider = ? AND user_id = ?", "wechat_website", userID).Error
		if err == nil {
			return ErrOAuthIdentityConflict
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(&model.UserIdentity{ID: kernel.NewID(), UserID: userID, Provider: "wechat_website", Subject: subject}).Error
	}, &sql.TxOptions{Isolation: sql.LevelSerializable})
}

func (r *Repository) CreateOAuthUser(user *model.User, identity *model.UserIdentity) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationEmail(tx, user.Email); err != nil {
			return err
		}
		if err := New(tx).CheckEmailAvailable(user.Email, ""); err != nil {
			return err
		}
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		if err := tx.Create(identity).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditAccount{UserID: user.ID}).Error
	})
}
