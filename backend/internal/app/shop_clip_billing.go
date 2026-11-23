package app

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func validateShopClipPrice(expected *int64, actual int64) error {
	if expected == nil || *expected != actual {
		return &AppError{Status: 409, Code: 409, Reason: "shop_clip_price_changed", Message: "剪辑报价已更新，请确认当前积分后再次提交"}
	}
	return nil
}

func shopClipBillingOrder(task *model.Task, plan ShopClipPlan) (*model.BillingOrder, error) {
	if plan.PricingVersion == 0 {
		return nil, nil
	}
	if plan.PricingVersion != 1 || plan.Credits < 0 || plan.Credits > 100000 {
		return nil, fmt.Errorf("剪辑价格快照无效")
	}
	if plan.Credits == 0 || task.Type == model.TaskTypeShopClipAnalysis && !plan.AutoRender {
		return nil, nil
	}
	amount := plan.Credits * CreditScale
	order := &model.BillingOrder{ID: newID(), UserID: task.UserID, TaskID: task.ID, IdempotencyKey: "shop-clip:" + task.ID, Model: "shop-clip", Capability: "video", Scene: "shop_clip", BillingMode: "fixed_request", PriceVersion: 1, UnitPriceMicrocredits: amount, MultiplierBasisPoints: 10000, Quantity: 1, AmountMicrocredits: amount, ReservedAmountMicrocredits: amount, ChargeLimitSet: true, ChargeLimitMicrocredits: amount, Status: model.BillingStatusReserved}
	task.BillingOrderID = order.ID
	return order, nil
}

// Lock task state before its order, matching cancellation and settlement. A
// failure and refund are one transaction, so retry cannot race an unpaid refund.
func (w *taskWorkerCoordinator) failShopClipTask(task *model.Task, projectID, message string) error {
	err := w.service.repo.Transaction(func(tx *repository.Repository) error {
		done, err := tx.UpdateTaskTerminalState(task.ID, task.LeaseOwner, model.TaskStatusRunning, model.TaskStatusFailed, "剪辑失败", message, time.Now())
		if err != nil {
			return err
		}
		if !done {
			return repository.ErrTaskStateConflict
		}
		if task.BillingOrderID != "" {
			if err := tx.RefundBillingOrder(task.BillingOrderID, message); err != nil {
				return err
			}
		}
		if projectID != "" {
			err := tx.UpdateShopClip(task.UserID, projectID, task.ID, []string{"analyzing", "rendering"}, map[string]any{"status": "failed", "stage": "剪辑失败", "error": message})
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		return nil
	})
	if err == nil {
		w.service.logInfo(task.UserID, task.ID, "剪辑失败："+message, "")
	}
	return err
}

func shopClipRetryBillingReleased(tx *repository.Repository, userID, taskID string) error {
	task, err := tx.TaskForUser(userID, taskID)
	if err != nil {
		return err
	}
	if task.BillingOrderID == "" {
		return nil
	}
	order, err := tx.BillingOrder(task.BillingOrderID)
	if err != nil {
		return err
	}
	if order.Status != model.BillingStatusRefunded {
		return BadAuthRequest("上次剪辑账单尚未完成退款，请稍后重试")
	}
	return nil
}
