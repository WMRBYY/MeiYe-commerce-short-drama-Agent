package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrSmartRouteReconciliationConflict = errors.New("smart route reconciliation state changed")

func (r *Repository) SmartRouteReconciliationTasks(limit int) ([]model.Task, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var tasks []model.Task
	err := r.db.Where("status = ?", model.TaskStatusReconciling).Order("created_at asc").Limit(limit).Find(&tasks).Error
	return tasks, err
}

// EnterSmartRouteReconciliation moves the task, current attempt and reserved
// billing into one durable state. An expired worker lease cannot do this after
// another worker has taken over.
func (r *Repository) EnterSmartRouteReconciliation(task *model.Task, attemptID string, deadline time.Time) error {
	if task == nil || task.ID == "" || attemptID == "" || task.LeaseOwner == "" {
		return ErrSmartRouteReconciliationConflict
	}
	now := time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current model.Task
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ?", task.ID).Error; err != nil {
			return err
		}
		if current.Status == model.TaskStatusReconciling {
			return nil
		}
		if current.Status != model.TaskStatusRunning || !current.SmartRouteActive || current.LeaseOwner != task.LeaseOwner || current.LeaseExpiresAt == nil || !current.LeaseExpiresAt.After(now) || current.RouteRun != task.RouteRun {
			return ErrSmartRouteReconciliationConflict
		}
		var attempt model.RouteAttempt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&attempt, "id = ? AND task_id = ? AND route_run = ?", attemptID, task.ID, task.RouteRun).Error; err != nil {
			return err
		}
		if attempt.DispatchState != "submission_unknown" && attempt.DispatchState != "accepted" {
			return ErrSmartRouteReconciliationConflict
		}
		if current.BillingOrderID != "" {
			if err := lockTeamForBilling(tx, current.BillingOrderID); err != nil {
				return err
			}
			var order model.BillingOrder
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", current.BillingOrderID).Error; err != nil {
				return err
			}
			if !smartRouteBillingMatchesTask(order, current) || (order.Status != model.BillingStatusReserved && order.Status != model.BillingStatusRunning && order.Status != model.BillingStatusUncertain && order.Status != model.BillingStatusRefunded) {
				return ErrSmartRouteReconciliationConflict
			}
			if order.Status != model.BillingStatusRefunded {
				var err error
				if order.DeductedUpfront && order.TeamID == "" {
					err = refundBillingOrderTx(tx, order.ID, "上游提交状态待核对，积分直接退回")
				} else {
					err = updateBillingOrderState(tx, order, map[string]any{"status": model.BillingStatusUncertain, "error": "上游提交状态待核对", "updated_at": now})
				}
				if err != nil {
					return err
				}
			}
		}
		attemptUpdates := map[string]any{
			"status": "reconciling", "reconciliation_state": "pending", "reconcile_next_at": now,
			"reconcile_deadline_at": deadline, "completed_at": nil,
		}
		if attempt.ProviderRequestID == "" && current.ProviderRequestID != "" {
			attemptUpdates["provider_request_id"] = current.ProviderRequestID
		}
		if err := tx.Model(&attempt).Updates(attemptUpdates).Error; err != nil {
			return err
		}
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", current.ID, model.TaskStatusRunning, task.LeaseOwner, now).
			Updates(map[string]any{
				"status": model.TaskStatusReconciling, "stage": "正在确认任务状态", "progress": 0,
				"error": "", "execution_diagnostic_json": task.ExecutionDiagnosticJSON,
				"next_poll_at": now, "lease_owner": "", "lease_expires_at": nil,
				"completed_at": nil, "updated_at": now,
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrSmartRouteReconciliationConflict
		}
		return nil
	})
}

func smartRouteBillingMatchesTask(order model.BillingOrder, task model.Task) bool {
	if order.TaskID != task.ID || order.UserID == "" {
		return false
	}
	if teamID, ok := model.TeamIDFromContentKey(task.UserID); ok {
		return order.TeamID == teamID && order.MembershipID != ""
	}
	return order.TeamID == "" && order.UserID == task.UserID
}

func (r *Repository) ClaimNextSmartRouteReconciliation(owner string, leaseDuration time.Duration) (*model.Task, error) {
	now := time.Now()
	var task model.Task
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("status = ? AND next_poll_at IS NOT NULL AND next_poll_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)", model.TaskStatusReconciling, now, now).
			Order("next_poll_at asc").Limit(1)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		result := query.Find(&task)
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		claim := tx.Model(&model.Task{}).Where("id = ? AND status = ?", task.ID, model.TaskStatusReconciling)
		if r.Dialect() != "postgres" {
			claim = claim.Where("next_poll_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)", now, now)
		}
		// Keep next_poll_at while leased. If the process dies, the expired
		// lease makes this persisted row claimable again after restart.
		updated := claim.Updates(map[string]any{"lease_owner": owner, "lease_expires_at": now.Add(leaseDuration), "next_poll_at": now, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			task = model.Task{}
			return nil
		}
		return tx.First(&task, "id = ?", task.ID).Error
	})
	if err != nil || task.ID == "" {
		return nil, err
	}
	return &task, nil
}

func (r *Repository) DeferSmartRouteReconciliation(taskID, owner, attemptID, state string, delay time.Duration) error {
	now := time.Now()
	manual := state == "manual_required"
	var next *time.Time
	stage := "正在确认任务状态"
	if manual {
		stage = "等待人工核查上游状态"
	} else {
		value := now.Add(delay)
		next = &value
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", taskID, model.TaskStatusReconciling, owner, now).
			Updates(map[string]any{"stage": stage, "next_poll_at": next, "lease_owner": "", "lease_expires_at": nil, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrSmartRouteReconciliationConflict
		}
		updated = tx.Model(&model.RouteAttempt{}).
			Where("id = ? AND task_id = ? AND status = ?", attemptID, taskID, "reconciling").
			Updates(map[string]any{"reconciliation_state": state, "reconciliation_checks": gorm.Expr("reconciliation_checks + 1"), "reconcile_next_at": next, "reconcile_last_checked_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrSmartRouteReconciliationConflict
		}
		return nil
	})
}

func (r *Repository) ResumeSmartRouteReconciliation(taskID, owner, attemptID, providerRequestID string) error {
	if providerRequestID == "" {
		return ErrSmartRouteReconciliationConflict
	}
	now := time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", taskID, model.TaskStatusReconciling, owner, now).
			Updates(map[string]any{"status": model.TaskStatusRunning, "stage": "回查原上游任务", "provider_request_id": providerRequestID, "next_poll_at": now, "lease_owner": "", "lease_expires_at": nil, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrSmartRouteReconciliationConflict
		}
		updated = tx.Model(&model.RouteAttempt{}).
			Where("id = ? AND task_id = ? AND status = ?", attemptID, taskID, "reconciling").
			Updates(map[string]any{"status": "accepted", "dispatch_state": "accepted", "provider_request_id": providerRequestID, "accepted_at": gorm.Expr("COALESCE(accepted_at, ?)", now), "reconciliation_state": "accepted", "reconcile_next_at": nil, "reconcile_last_checked_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrSmartRouteReconciliationConflict
		}
		return nil
	})
}

// ResolveSmartRouteReconciliationRefund is used only after an upstream proof
// or a documented human review. The task terminal state and credit release
// commit atomically, so duplicate callbacks or repeated clicks are harmless.
func (r *Repository) ResolveSmartRouteReconciliationRefund(taskID, attemptID, actorID, evidence string) error {
	now := time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		var task model.Task
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "id = ?", taskID).Error; err != nil {
			return err
		}
		if task.Status == model.TaskStatusFailed {
			var previous model.RouteAttempt
			if err := tx.First(&previous, "id = ? AND task_id = ?", attemptID, taskID).Error; err != nil {
				return err
			}
			if previous.ReconciliationState == "resolved_refund" {
				return nil
			}
		}
		if task.Status != model.TaskStatusReconciling {
			return ErrSmartRouteReconciliationConflict
		}
		var attempt model.RouteAttempt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&attempt, "id = ? AND task_id = ? AND route_run = ?", attemptID, taskID, task.RouteRun).Error; err != nil {
			return err
		}
		if attempt.Status != "reconciling" {
			return ErrSmartRouteReconciliationConflict
		}
		if task.BillingOrderID != "" {
			if err := lockTeamForBilling(tx, task.BillingOrderID); err != nil {
				return err
			}
			var order model.BillingOrder
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", task.BillingOrderID).Error; err != nil {
				return err
			}
			if !smartRouteBillingMatchesTask(order, task) || (order.Status != model.BillingStatusUncertain && order.Status != model.BillingStatusRefunded) {
				return ErrSmartRouteReconciliationConflict
			}
			if err := refundBillingOrderTx(tx, task.BillingOrderID, "上游状态核查后退款："+evidence); err != nil {
				return err
			}
		}
		if err := tx.Model(&task).Updates(map[string]any{"status": model.TaskStatusFailed, "stage": "任务未完成", "error": "上游任务未完成，积分已退回", "next_poll_at": nil, "lease_owner": "", "lease_expires_at": nil, "completed_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		return tx.Model(&attempt).Updates(map[string]any{"status": "failed", "reconciliation_state": "resolved_refund", "reconciliation_evidence": evidence, "reconciled_by": actorID, "reconciled_at": now, "reconcile_next_at": nil, "completed_at": now}).Error
	})
}
