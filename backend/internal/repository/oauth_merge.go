package repository

import (
	"errors"
	"fmt"
	"math"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

var ErrOAuthMergeConflict = errors.New("wechat account data cannot be merged safely")

// These tables contain durable user-owned records whose primary IDs do not
// change when the account owner changes. New user_id tables fail the inventory
// below until their merge policy is reviewed.
var weChatMergeOwnedTables = map[string]bool{
	"agent_conversation_documents": true, "agent_profiles": true, "announcement_image_drafts": true, "api_call_logs": true,
	"ark_private_asset_bindings": true, "asset_folders": true, "assets": true,
	"billing_orders": true, "canvas_mutation_receipts": true, "canvas_projects": true, "canvas_shares": true,
	"canvas_snapshots": true, "cloud_agent_canvas_mutations": true,
	"cloud_agent_event_records": true, "cloud_agent_executions": true,
	"cloud_agent_gemini_caches": true, "cloud_agent_message_records": true,
	"cloud_agent_pi_sessions": true, "cloud_agent_resource_leases": true,
	"creation_runs": true, "creation_submissions": true,
	"credit_ledger_entries": true, "model_channels": true,
	"payment_orders": true, "projects": true, "resource_deletion_jobs": true,
	"resources": true, "results": true, "style_profiles": true,
	"task_logs": true, "task_text_delta": true, "tasks": true,
	"tool_favorites": true, "upload_reservations": true,
	"user_announcement_reads": true, "user_oss_settings": true,
	"user_plugin_states": true, "user_prompt_customizations": true,
	"user_skill_states": true, "voice_profiles": true,
}

var weChatMergeSpecialTables = map[string]bool{
	"agent_memory_settings": true, "auth_sessions": true,
	"auth_verifications": true, "credit_accounts": true,
	"login_logs": true, "user_avatars": true,
	"user_daily_activities": true, "user_daily_upload_usages": true,
	"user_identities": true,
}

func mergeWeChatAccountIntoPhone(tx *gorm.DB, identity model.UserIdentity, targetID string) error {
	if identity.UserID == targetID {
		return nil
	}
	query := tx.Where("id IN ?", []string{identity.UserID, targetID}).Order("id")
	if tx.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var users []model.User
	if err := query.Find(&users).Error; err != nil {
		return err
	}
	if len(users) != 2 {
		return ErrOAuthMergeConflict
	}
	var source, target model.User
	for _, user := range users {
		if user.ID == identity.UserID {
			source = user
		} else {
			target = user
		}
	}
	if source.ID == "" || target.ID == "" || source.Role != model.UserRoleUser ||
		source.Status != model.UserStatusActive || source.Phone != "" ||
		target.Role != model.UserRoleUser || target.Status != model.UserStatusActive ||
		target.Phone == "" || target.PhoneVerifiedAt == nil {
		return ErrOAuthMergeConflict
	}
	var identities int64
	if err := tx.Model(&model.UserIdentity{}).Where("user_id = ?", source.ID).Count(&identities).Error; err != nil {
		return err
	}
	if identities != 1 {
		return ErrOAuthMergeConflict
	}
	if err := preflightWeChatMerge(tx, source.ID); err != nil {
		return err
	}
	if err := mergeWeChatCreditAccounts(tx, source.ID, target.ID); err != nil {
		return err
	}
	if err := mergeWeChatDailyActivity(tx, source.ID, target.ID); err != nil {
		return err
	}
	if err := mergeWeChatDailyUploads(tx, source.ID, target.ID); err != nil {
		return err
	}
	if tx.Migrator().HasTable("agent_memory_settings") {
		var sourceMemory, targetMemory int64
		if err := tx.Table("agent_memory_settings").Where("user_id = ?", source.ID).Count(&sourceMemory).Error; err != nil {
			return err
		}
		if err := tx.Table("agent_memory_settings").Where("user_id = ?", target.ID).Count(&targetMemory).Error; err != nil {
			return err
		}
		if sourceMemory > 0 && targetMemory == 0 {
			if err := tx.Table("agent_memory_settings").Where("user_id = ?", source.ID).Update("user_id", target.ID).Error; err != nil {
				return err
			}
		}
	}
	for table := range weChatMergeOwnedTables {
		if !tx.Migrator().HasTable(table) {
			continue
		}
		if err := tx.Table(table).Where("user_id = ?", source.ID).Update("user_id", target.ID).Error; err != nil {
			return fmt.Errorf("merge %s: %w", table, err)
		}
	}
	if err := tx.Model(&model.UserIdentity{}).Where("id = ? AND user_id = ?", identity.ID, source.ID).
		Update("user_id", target.ID).Error; err != nil {
		return err
	}
	if err := tx.Where("user_id = ?", source.ID).Delete(&model.AuthSession{}).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.User{}).Where("id = ?", source.ID).
		Updates(map[string]any{"status": model.UserStatusDisabled, "updated_at": time.Now()}).Error; err != nil {
		return err
	}
	if tx.Migrator().HasTable(&model.AdminAuditEvent{}) {
		if err := tx.Create(&model.AdminAuditEvent{
			ID: kernel.NewID(), ActorUserID: target.ID, Action: "auth.wechat_account_merge",
			TargetType: "user", TargetID: target.ID, Summary: "微信账号并入已验证手机号账号",
			MetadataJSON: fmt.Sprintf(`{"sourceUserId":%q}`, source.ID), CreatedAt: time.Now(),
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func preflightWeChatMerge(tx *gorm.DB, sourceID string) error {
	for table, column := range map[string]string{
		"agent_lessons": "author_user_id", "skill_library_categories": "owner_id",
		"skills": "owner_id", "storage_locations": "owner_id", "tools": "owner_id",
	} {
		if !tx.Migrator().HasTable(table) {
			continue
		}
		var count int64
		if err := tx.Table(table).Where(column+" = ?", sourceID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrOAuthMergeConflict
		}
	}
	for _, check := range []struct {
		table string
		where string
	}{
		{"tasks", "status NOT IN ('succeeded','failed','cancelled')"},
		{"billing_orders", "status NOT IN ('settled','refunded')"},
		{"payment_orders", "status NOT IN ('closed','credited','create_failed')"},
		{"cloud_agent_resource_leases", "1 = 1"},
	} {
		if !tx.Migrator().HasTable(check.table) {
			continue
		}
		var count int64
		if err := tx.Table(check.table).Where("user_id = ? AND "+check.where, sourceID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrOAuthMergeConflict
		}
	}
	tables, err := tx.Migrator().GetTables()
	if err != nil {
		return err
	}
	for _, table := range tables {
		if !tx.Migrator().HasColumn(table, "user_id") || weChatMergeOwnedTables[table] || weChatMergeSpecialTables[table] {
			continue
		}
		var count int64
		if err := tx.Table(table).Where("user_id = ?", sourceID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrOAuthMergeConflict
		}
	}
	return nil
}

func mergeWeChatCreditAccounts(tx *gorm.DB, sourceID, targetID string) error {
	var accounts []model.CreditAccount
	query := tx.Where("user_id IN ?", []string{sourceID, targetID}).Order("user_id")
	if tx.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Find(&accounts).Error; err != nil {
		return err
	}
	var source, target model.CreditAccount
	for _, account := range accounts {
		if account.UserID == sourceID {
			source = account
		} else {
			target = account
		}
	}
	if source.UserID == "" || target.UserID == "" || source.ReservedMicrocredits != 0 ||
		source.AvailableMicrocredits < 0 || target.AvailableMicrocredits < 0 ||
		target.AvailableMicrocredits > math.MaxInt64-source.AvailableMicrocredits {
		return ErrOAuthMergeConflict
	}
	if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", targetID).
		Updates(map[string]any{"available_microcredits": target.AvailableMicrocredits + source.AvailableMicrocredits,
			"version": target.Version + 1, "updated_at": time.Now()}).Error; err != nil {
		return err
	}
	return tx.Model(&model.CreditAccount{}).Where("user_id = ?", sourceID).
		Updates(map[string]any{"available_microcredits": 0, "version": source.Version + 1, "updated_at": time.Now()}).Error
}

func mergeWeChatDailyActivity(tx *gorm.DB, sourceID, targetID string) error {
	if !tx.Migrator().HasTable(&model.UserDailyActivity{}) {
		return nil
	}
	var rows []model.UserDailyActivity
	if err := tx.Where("user_id = ?", sourceID).Find(&rows).Error; err != nil {
		return err
	}
	for _, source := range rows {
		var target model.UserDailyActivity
		err := tx.First(&target, "user_id = ? AND day = ?", targetID, source.Day).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Model(&source).Update("user_id", targetID).Error; err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		first, last := target.FirstActiveAt, target.LastActiveAt
		if source.FirstActiveAt != nil && (first == nil || source.FirstActiveAt.Before(*first)) {
			first = source.FirstActiveAt
		}
		if source.LastActiveAt != nil && (last == nil || source.LastActiveAt.After(*last)) {
			last = source.LastActiveAt
		}
		if err := tx.Model(&target).Updates(map[string]any{
			"first_active_at": first, "last_active_at": last,
			"login_count":         target.LoginCount + source.LoginCount,
			"task_count":          target.TaskCount + source.TaskCount,
			"agent_message_count": target.AgentMessageCount + source.AgentMessageCount,
			"canvas_active":       target.CanvasActive || source.CanvasActive,
			"asset_count":         target.AssetCount + source.AssetCount,
			"resource_count":      target.ResourceCount + source.ResourceCount,
		}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&source).Error; err != nil {
			return err
		}
	}
	return nil
}

func mergeWeChatDailyUploads(tx *gorm.DB, sourceID, targetID string) error {
	if !tx.Migrator().HasTable(&model.UserDailyUploadUsage{}) {
		return nil
	}
	var rows []model.UserDailyUploadUsage
	if err := tx.Where("user_id = ?", sourceID).Find(&rows).Error; err != nil {
		return err
	}
	for _, source := range rows {
		var target model.UserDailyUploadUsage
		err := tx.First(&target, "user_id = ? AND day = ?", targetID, source.Day).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Model(&source).Update("user_id", targetID).Error; err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if source.Bytes < 0 || target.Bytes > math.MaxInt64-source.Bytes {
			return ErrOAuthMergeConflict
		}
		if err := tx.Model(&target).Update("bytes", target.Bytes+source.Bytes).Error; err != nil {
			return err
		}
		if err := tx.Delete(&source).Error; err != nil {
			return err
		}
	}
	return nil
}
