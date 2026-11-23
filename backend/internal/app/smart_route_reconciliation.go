package app

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const smartRouteReconciliationWindow = 30 * time.Minute

// A submission with an unknown outcome is never retried on another channel.
// The attempt, task and reservation transition together under the task lease.
func (s *Service) enterSmartRouteReconciliation(task *model.Task) error {
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return err
	}
	if len(attempts) == 0 || (attempts[len(attempts)-1].DispatchState != "submission_unknown" && attempts[len(attempts)-1].DispatchState != "accepted") {
		return errors.New("缺少待对账的上游提交记录")
	}
	last := attempts[len(attempts)-1]
	if err := s.repo.EnterSmartRouteReconciliation(task, last.ID, time.Now().Add(smartRouteReconciliationWindow)); err != nil {
		return err
	}
	_ = s.log(task.UserID, task.ID, "warn", "上游提交状态未知，已进入安全对账", last.ID)
	return nil
}

func (s *Service) startSmartRouteReconciliationWorker(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			if ctx.Err() != nil {
				return
			}
			if !s.IsDraining() {
				for i := 0; i < 8; i++ {
					claimCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
					task, err := s.repo.WithContext(claimCtx).ClaimNextSmartRouteReconciliation(s.workerID+":reconcile:"+newID(), 45*time.Second)
					cancel()
					if err != nil {
						log.Printf("smart route reconciliation claim failed: %v", err)
						break
					}
					if task == nil {
						break
					}
					checkCtx, stop := context.WithTimeout(ctx, 20*time.Second)
					if err := s.reconcileSmartRouteTask(checkCtx, task); err != nil {
						log.Printf("smart route reconciliation task_id=%s failed: %v", task.ID, err)
						_ = s.repo.DeferSmartRouteReconciliation(task.ID, task.LeaseOwner, s.reconcilingAttemptID(task), "retry", 30*time.Second)
					}
					stop()
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

func (s *Service) reconcilingAttemptID(task *model.Task) string {
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil || len(attempts) == 0 {
		return ""
	}
	return attempts[len(attempts)-1].ID
}

func (s *Service) reconcileSmartRouteTask(ctx context.Context, task *model.Task) error {
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return err
	}
	if len(attempts) == 0 {
		return errors.New("对账任务缺少路由尝试")
	}
	attempt := attempts[len(attempts)-1]
	if attempt.Status != "reconciling" || (attempt.DispatchState != "submission_unknown" && attempt.DispatchState != "accepted") {
		return errors.New("对账尝试状态不一致")
	}
	if attempt.ProviderRequestID == "" {
		// Existing synchronous chat/image vendors do not expose a documented
		// lookup by our submission key. Keep the reservation and audit trail for
		// evidence-backed manual review; elapsed time is never proof of failure.
		return s.repo.DeferSmartRouteReconciliation(task.ID, task.LeaseOwner, attempt.ID, "manual_required", 0)
	}
	if attempt.ReconcileDeadlineAt != nil && time.Now().After(*attempt.ReconcileDeadlineAt) {
		return s.repo.DeferSmartRouteReconciliation(task.ID, task.LeaseOwner, attempt.ID, "manual_required", 0)
	}
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return err
	}
	metadataTask := *task
	metadataTask.InputJSON = decrypted
	ctx = withProviderSubmissionKey(withTaskExecutionID(ctx, task.ID), &attempt)
	ctx = withProviderAnalytics(ctx, s, metadataTask)
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return err
	}
	if attempt.ProtocolBindingJSON != "" {
		metadataTask.ProtocolBindingJSON = attempt.ProtocolBindingJSON
	}
	input.Config, err = s.resolveProviderConfig(input.Config, &metadataTask)
	if err != nil {
		return err
	}
	ctx = withProtocolRegistry(ctx, input.Config.registry)
	adapter, supported := declarativeProtocolAdapterForContext(ctx, input.Config.InterfaceType)
	if !supported {
		return s.repo.DeferSmartRouteReconciliation(task.ID, task.LeaseOwner, attempt.ID, "manual_required", 0)
	}
	request := protocolRequestFromInput(input)
	state, err := pollProtocolTask(ctx, input.Config, adapter, request, attempt.ProviderRequestID)
	if err != nil {
		return s.repo.DeferSmartRouteReconciliation(task.ID, task.LeaseOwner, attempt.ID, "retry", 30*time.Second)
	}
	switch state.Status {
	case protocol.StatusPending, protocol.StatusProcessing, protocol.StatusSucceeded:
		// The original task has a queryable provider ID. The ordinary worker
		// resumes that ID and persists the result through the existing path.
		return s.repo.ResumeSmartRouteReconciliation(task.ID, task.LeaseOwner, attempt.ID, attempt.ProviderRequestID)
	case protocol.StatusFailed, protocol.StatusCancelled:
		// A provider terminal result is evidence; never infer it from timeout.
		return s.repo.ResolveSmartRouteReconciliationRefund(task.ID, attempt.ID, "system", "上游查单确认任务失败")
	default:
		return s.repo.DeferSmartRouteReconciliation(task.ID, task.LeaseOwner, attempt.ID, "retry", 30*time.Second)
	}
}

type SmartRouteReconciliationReview struct {
	TaskID        string             `json:"taskId"`
	UserID        string             `json:"userId"`
	Attempt       model.RouteAttempt `json:"attempt"`
	BillingStatus string             `json:"billingStatus"`
	Stage         string             `json:"stage"`
}

func (s *Service) AdminSmartRouteReconciliations(actor *model.User) ([]SmartRouteReconciliationReview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	tasks, err := s.repo.SmartRouteReconciliationTasks(100)
	if err != nil {
		return nil, err
	}
	items := make([]SmartRouteReconciliationReview, 0, len(tasks))
	for _, task := range tasks {
		attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
		if err != nil || len(attempts) == 0 {
			continue
		}
		attempt := attempts[len(attempts)-1]
		attempt.ReconciliationEvidence = "" // no raw provider/user payload in list
		status := ""
		if task.BillingOrderID != "" {
			if bill, err := s.repo.BillingOrder(task.BillingOrderID); err == nil {
				status = string(bill.Status)
			}
		}
		items = append(items, SmartRouteReconciliationReview{TaskID: task.ID, UserID: task.UserID, Attempt: attempt, BillingStatus: status, Stage: task.Stage})
	}
	return items, nil
}

func (s *Service) AdminRefundSmartRouteReconciliation(actor *model.User, taskID, attemptID, evidence string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	evidence = strings.TrimSpace(evidence)
	if len([]rune(evidence)) < 12 || len([]rune(evidence)) > 400 {
		return BadAuthRequest("请填写已核对渠道记录的证据摘要（12 至 400 字）")
	}
	lower := strings.ToLower(evidence)
	for _, sensitive := range []string{"https://", "http://", "auth_key=", "api_key=", "bearer ", "sk-"} {
		if strings.Contains(lower, sensitive) {
			return BadAuthRequest("核查摘要不能包含链接或凭证，请只填写渠道记录编号和结论")
		}
	}
	if err := s.repo.ResolveSmartRouteReconciliationRefund(taskID, attemptID, actor.ID, evidence); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "smart_router.reconciliation_refund", "task", taskID, "核对上游记录后释放积分", map[string]any{"attemptId": attemptID, "evidenceRecorded": true})
}
