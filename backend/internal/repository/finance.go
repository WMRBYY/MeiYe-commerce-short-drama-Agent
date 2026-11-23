package repository

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

const dailyCreditMigrationVersion = 50

func (r *Repository) DailyCreditStartsAt() (time.Time, error) {
	var row struct{ AppliedAt time.Time }
	if err := r.db.Table("schema_migrations").Select("applied_at").Where("version = ?", dailyCreditMigrationVersion).Take(&row).Error; err != nil {
		return time.Time{}, err
	}
	return row.AppliedAt, nil
}

func dailyCreditReference(userID, day string) string {
	return fmt.Sprintf("daily-fuel:%s:%s", userID, day)
}

func legacyCheckinOnBeijingDay(db *gorm.DB, userID, day string) (bool, error) {
	start, err := time.ParseInLocation("2006-01-02", day, time.FixedZone("Asia/Shanghai", 8*60*60))
	if err != nil {
		return false, err
	}
	var count int64
	err = db.Model(&model.CreditLedgerEntry{}).
		Where("user_id = ? AND type = ? AND reference_key LIKE ? AND created_at >= ? AND created_at < ?",
			userID, model.CreditLedgerCheckinBonus, "checkin:"+userID+":%", start.UTC(), start.AddDate(0, 0, 1).UTC()).Count(&count).Error
	return count > 0, err
}

func (r *Repository) UnclaimedDailyCreditDays(userID string, days []string) ([]string, error) {
	if len(days) == 0 {
		return []string{}, nil
	}
	refs := make([]string, len(days))
	for i, day := range days {
		refs[i] = dailyCreditReference(userID, day)
	}
	var claimed []string
	if err := r.db.Model(&model.CreditLedgerEntry{}).Where("reference_key IN ?", refs).Pluck("reference_key", &claimed).Error; err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(claimed))
	for _, ref := range claimed {
		seen[ref] = true
	}
	pending := make([]string, 0, len(days))
	for _, day := range days {
		if seen[dailyCreditReference(userID, day)] {
			continue
		}
		legacy, err := legacyCheckinOnBeijingDay(r.db, userID, day)
		if err != nil {
			return nil, err
		}
		if !legacy {
			pending = append(pending, day)
		}
	}
	return pending, nil
}

// Each day owns a unique ledger reference. The entries and balance change
// commit together, including when concurrent requests race on the same days.
func (r *Repository) ClaimDailyCredits(userID string, days []string, amountPerDay int64) (*model.CreditAccount, int64, error) {
	var account model.CreditAccount
	var granted int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		account = model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		for _, day := range days {
			legacy, err := legacyCheckinOnBeijingDay(tx, userID, day)
			if err != nil {
				return err
			}
			if legacy {
				continue
			}
			ref := dailyCreditReference(userID, day)
			entry := model.CreditLedgerEntry{ID: newRepositoryID(), UserID: userID, Type: model.CreditLedgerCheckinBonus,
				AmountMicrocredits: amountPerDay, ReferenceKey: &ref, Note: "每日赠加油 " + day}
			created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&entry)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected == 0 {
				continue
			}
			updated := tx.Model(&model.CreditAccount{}).
				Where("user_id = ? AND available_microcredits <= ?", userID, maxPaymentCreditBalance-amountPerDay).
				Updates(map[string]any{
					"available_microcredits": gorm.Expr("available_microcredits + ?", amountPerDay),
					"version":                gorm.Expr("version + 1"), "updated_at": time.Now(),
				})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return ErrPaymentCreditOverflow
			}
			if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
				return err
			}
			if err := tx.Model(&entry).Updates(map[string]any{
				"available_delta_microcredits": amountPerDay,
				"available_after_microcredits": account.AvailableMicrocredits,
				"reserved_after_microcredits":  account.ReservedMicrocredits,
			}).Error; err != nil {
				return err
			}
			granted += amountPerDay
		}
		return tx.First(&account, "user_id = ?", userID).Error
	})
	return &account, granted, err
}

var (
	ErrInsufficientCredits     = errors.New("积分不足，请先充值")
	ErrRedeemCodeInvalid       = errors.New("兑换码无效或已使用")
	ErrActiveTaskLimit         = errors.New("同时进行的任务数已达上限，请等待已有任务完成")
	ErrTaskNotRetryable        = errors.New("该任务当前状态不支持重试")
	ErrTaskBillingReview       = errors.New("上一次调用费用仍需核对")
	ErrBillingStateConflict    = errors.New("计费状态已变化，请刷新后重试")
	ErrBillingUsageUnavailable = errors.New("暂时无法获取用量，计费未完成")
	ErrBillingChargeLimit      = errors.New("本次费用超过授权上限，已拒绝扣费")
	ErrChannelModelInUse       = errors.New("该渠道模型正在被使用，无法删除或停用")
)

func (r *Repository) CreditAccount(userID string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.First(&account, "user_id = ?", userID).Error
	if err == nil {
		return &account, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	account = model.CreditAccount{UserID: userID}
	if err := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

func (r *Repository) CreditAccounts(userIDs []string) ([]model.CreditAccount, error) {
	if len(userIDs) == 0 {
		return []model.CreditAccount{}, nil
	}
	var accounts []model.CreditAccount
	err := r.db.Where("user_id IN ?", userIDs).Find(&accounts).Error
	return accounts, err
}

func (r *Repository) CreditLedger(userID string, entryType string, limit int, offset int) ([]model.CreditLedgerEntry, int64, error) {
	var items []model.CreditLedgerEntry
	var total int64
	query := r.db.Model(&model.CreditLedgerEntry{}).Where("account_id = ? AND type <> ?", model.PersonalCreditAccountID(userID), model.CreditLedgerReserve)
	switch entryType {
	case "topup":
		query = query.Where("type IN ?", []model.CreditLedgerType{model.CreditLedgerPaymentTopup, model.CreditLedgerRedeem})
	case "income":
		query = query.Where("type IN ?", []model.CreditLedgerType{model.CreditLedgerRedeem, model.CreditLedgerAdminGrant, model.CreditLedgerAdminAdjust, model.CreditLedgerSignupBonus, model.CreditLedgerCheckinBonus})
	case "consume":
		query = query.Where("type = ?", model.CreditLedgerConsume)
	case "refund":
		query = query.Where("type = ?", model.CreditLedgerRefund)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) CreditLedgerReferenceExists(referenceKey string) (bool, error) {
	var count int64
	err := r.db.Model(&model.CreditLedgerEntry{}).Where("reference_key = ?", referenceKey).Count(&count).Error
	return count > 0, err
}

func (r *Repository) CreateTaskWithCreditReservation(task *model.Task, order *model.BillingOrder, activeTaskLimit int, agentRunLimit ...int) error {
	return r.Transaction(func(repo *Repository) error {
		tx := repo.db
		if err := enforceAgentRunLimit(tx, task, agentRunLimit); err != nil {
			return err
		}
		if err := repo.requireCurrentCloudAgentParent(task); err != nil {
			return err
		}
		if err := New(tx).requireExclusiveCanvasAgent(task); err != nil {
			return err
		}
		if err := r.requireActiveLogicalModelForTask(tx, task); err != nil {
			return err
		}
		if err := repo.bindEcommerceAnalysisTask(task); err != nil {
			return err
		}
		if err := enforceActiveTaskLimit(tx, task.UserID, activeTaskLimit); err != nil {
			return err
		}
		if err := reserveBillingOrder(tx, order); err != nil {
			return err
		}
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		if task.Operation == "cloud_agent" && task.ProjectID != "" {
			repo.canvasChanged(task.UserID, task.ProjectID)
		}
		return nil
	})
}

func (r *Repository) CreateTaskWithActiveLimit(task *model.Task, activeTaskLimit int, agentRunLimit ...int) error {
	return r.Transaction(func(repo *Repository) error {
		tx := repo.db
		if err := enforceAgentRunLimit(tx, task, agentRunLimit); err != nil {
			return err
		}
		if err := repo.requireCurrentCloudAgentParent(task); err != nil {
			return err
		}
		if err := New(tx).requireExclusiveCanvasAgent(task); err != nil {
			return err
		}
		if err := r.requireActiveLogicalModelForTask(tx, task); err != nil {
			return err
		}
		if err := repo.bindEcommerceAnalysisTask(task); err != nil {
			return err
		}
		if err := enforceActiveTaskLimit(tx, task.UserID, activeTaskLimit); err != nil {
			return err
		}
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		if task.Operation == "cloud_agent" && task.ProjectID != "" {
			repo.canvasChanged(task.UserID, task.ProjectID)
		}
		return nil
	})
}

func (r *Repository) RetryTaskWithBilling(userID string, prepared *model.Task, order *model.BillingOrder, activeTaskLimit int, authorizeRelease ...func(*Repository, *model.Task, *model.BillingOrder) error) (*model.Task, error) {
	var task model.Task
	taskID := prepared.ID
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// 与自动退款保持任务先于账户的锁顺序；重试资格也必须在预扣前确认。
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "id = ? AND user_id = ?", taskID, userID).Error; err != nil {
			return err
		}
		if task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled {
			return ErrTaskNotRetryable
		}
		if task.BillingOrderID != "" {
			var previous model.BillingOrder
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&previous, "id = ? AND user_id = ? AND task_id = ?", task.BillingOrderID, userID, task.ID).Error; err != nil {
				return err
			}
			switch previous.Status {
			case model.BillingStatusSettled, model.BillingStatusRefunded:
			case model.BillingStatusReserved, model.BillingStatusRunning:
				if len(authorizeRelease) != 1 || authorizeRelease[0] == nil {
					return ErrTaskBillingReview
				}
				if err := authorizeRelease[0](New(tx), &task, &previous); err != nil {
					return err
				}
				// 旧执行证据将在重试时清空，必须先在同一事务中完成释放。
				if err := refundBillingOrder(tx, previous, "重试前退回：已确认上次请求未提交或上游明确失败"); err != nil {
					return err
				}
			default:
				return ErrTaskBillingReview
			}
		}
		if err := enforceActiveTaskLimit(tx, userID, activeTaskLimit); err != nil {
			return err
		}
		if order != nil {
			if err := reserveBillingOrder(tx, order); err != nil {
				return err
			}
		}
		updates := map[string]any{
			"status": model.TaskStatusQueued, "stage": "等待队列调度", "progress": 5, "error": "", "result_json": "",
			"execution_diagnostic_json": "", "cancellation_source": "", "cancellation_actor_id": "", "cancellation_requested_at": nil,
			"text_draft": "", "started_at": nil, "completed_at": nil,
			"provider_request_id": "", "poll_stage": "", "next_poll_at": nil,
			"provider_cancel_status": "", "provider_cancel_error": "", "provider_cancel_attempts": 0,
			"provider_cancel_requested_at": nil, "provider_cancelled_at": nil, "provider_cancel_next_check_at": nil,
			"route_run":                 gorm.Expr("route_run + ?", 1),
			"logical_model_revision_id": prepared.LogicalModelRevisionID, "route_id": prepared.RouteID,
			"channel_model_id": prepared.ChannelModelID, "input_json": prepared.InputJSON, "protocol_binding_json": prepared.ProtocolBindingJSON,
			"model": prepared.Model, "provider": prepared.Provider,
			"lease_owner": "", "lease_expires_at": nil, "updated_at": time.Now(),
		}
		if order != nil {
			updates["billing_order_id"] = order.ID
		} else {
			// 免费模式重试必须解除旧订单，避免任务执行阶段复用上一次的计费状态。
			updates["billing_order_id"] = ""
		}
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND user_id = ? AND status IN ?", taskID, userID, []model.TaskStatus{model.TaskStatusFailed, model.TaskStatusCancelled}).
			Updates(updates)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskNotRetryable
		}
		if err := tx.Delete(&model.TaskTextDelta{}, "user_id = ? AND task_id = ?", userID, taskID).Error; err != nil {
			return err
		}
		return tx.First(&task, "id = ? AND user_id = ?", taskID, userID).Error
	})
	return &task, err
}

func enforceActiveTaskLimit(tx *gorm.DB, userID string, activeTaskLimit int) error {
	// Lock the account row so concurrent admissions for one user cannot both
	// pass the count below.
	account := model.CreditAccount{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", userID).UpdateColumn("version", gorm.Expr("version")).Error; err != nil {
		return err
	}
	var count int64
	if err := tx.Model(&model.Task{}).Where("user_id = ? AND status IN ?", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&count).Error; err != nil {
		return err
	}
	if count >= int64(activeTaskLimit) {
		return ErrActiveTaskLimit
	}
	return nil
}

func newRepositoryID() string {
	return randomRepositorySuffix()
}

func randomRepositorySuffix() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(value[:])
}
