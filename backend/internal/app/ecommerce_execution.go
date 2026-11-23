package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"io"
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/workbench"
)

type EcommerceExecutionRequest struct {
	ID              string                              `json:"id"`
	ProjectID       string                              `json:"projectId,omitempty"`
	Revision        int64                               `json:"revision,omitempty"`
	AutoGenerate    *bool                               `json:"autoGenerate,omitempty"`
	Progressive     bool                                `json:"progressive,omitempty"`
	Draft           EcommerceDraft                      `json:"draft"`
	Prompt          string                              `json:"prompt"`
	InputSignature  string                              `json:"inputSignature"`
	ReferenceImages []model.EcommerceExecutionReference `json:"referenceImages"`
	Image           WorkbenchTaskInput                  `json:"image"`
}

// StartEcommerceExecution stores the creation request in the existing project
// repository; model work is scheduled by StartWorker, never a browser tab.
func (s *Service) StartEcommerceExecution(userID string, req EcommerceExecutionRequest) (*model.EcommerceProject, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if len(req.ID) < 8 || len(req.ID) > 64 || len(req.Prompt) == 0 || len(req.Prompt) > 128000 {
		return nil, BadAuthRequest("创作请求标识或策划内容无效")
	}
	req.Draft.Execution = nil
	if err := validateEcommerceImagePurpose(req.Draft); err != nil {
		return nil, err
	}
	if err := validateEcommerceCreativeOptions(req.Draft.CreativeOptions); err != nil {
		return nil, err
	}
	if req.Draft.DetailScreenCount != nil && req.Draft.AutoPackage == nil {
		return nil, BadAuthRequest("详情图出图设置无效，请刷新后重试")
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	requestHash := hex.EncodeToString(digest[:])
	projectHash := sha256.Sum256([]byte(userID + ":" + req.ID))
	projectID := "ec-" + hex.EncodeToString(projectHash[:16])
	if req.ProjectID != "" {
		projectID = req.ProjectID
	}
	if existing, err := s.repo.EcommerceProject(userID, projectID); err == nil {
		var saved EcommerceDraft
		if json.Unmarshal([]byte(existing.DraftJSON), &saved) == nil && saved.Execution != nil && saved.Execution.RequestHash == requestHash {
			return existing, nil
		}
		if req.ProjectID == "" || (saved.Execution != nil && saved.Execution.ID == req.ID) {
			return nil, creationConflict("相同请求标识的内容已变化，请新建一次创作")
		}
		if existing.Revision != req.Revision || saved.Execution.Active() {
			return nil, creationConflict("项目已更新或仍在执行，请刷新后重试")
		}
		if req.Draft.AutoPackage != nil || saved.AutoPackage != nil {
			if req.Draft.AutoPackage == nil || saved.AutoPackage == nil || req.Draft.ImageModel != saved.ImageModel {
				return nil, creationConflict("自动套餐配置已更新，请重新提交")
			}
			// The worker reads this same saved snapshot at execution time.
			req.Draft = saved
			req.Draft.Execution = nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if req.InputSignature == "" || len(req.InputSignature) > 128000 {
		return nil, BadAuthRequest("策划参数签名无效")
	}
	if req.Image.Kind != WorkbenchKindImage || req.Image.Model == "" || (req.Image.LogicalModelID == "" && req.Image.ChannelID == "") {
		return nil, BadAuthRequest("请选择已开放的图片模型")
	}
	if req.Draft.AutoPackage != nil {
		draft := req.Draft
		if err := validateEcommercePackageSettings(draft); err != nil {
			return nil, err
		}
		if draft.Resolution == "" || draft.ImageModel == "" {
			return nil, BadAuthRequest("请选择图片模型与分辨率")
		}
		if draft.ImageType == "detail" && (len(draft.LayoutReferences) == 0 || draft.Count == 0) {
			return nil, BadAuthRequest("请添加至少一张版式参考图并选择详情图张数")
		}
		refs, err := s.ecommercePackageReferences(userID, draft)
		if err != nil {
			return nil, err
		}
		if draft.DetailScreenCount != nil {
			if len(req.ReferenceImages) > 24 {
				return nil, BadAuthRequest("长图分析的图片数量超过限制")
			}
			if len(req.ReferenceImages) < len(refs) {
				return nil, BadAuthRequest("长图分析缺少原始参考图")
			}
			for index, reference := range refs {
				if req.ReferenceImages[index].ID != reference.ID {
					return nil, BadAuthRequest("长图分析的原图顺序已变化，请重新提交")
				}
			}
			for _, view := range req.ReferenceImages[len(refs):] {
				if _, err := s.ecommerceReadablePhoto(userID, view.ID); err != nil {
					return nil, err
				}
				refs = append(refs, view)
			}
		}
		req.ReferenceImages = refs
		req.Image.References = ecommerceExecutionReferences(draft, nil)
	}
	if len(req.ReferenceImages) > 24 || len(req.Image.References) > 20 {
		return nil, BadAuthRequest("参考图数量超过限制")
	}
	for index := range req.ReferenceImages {
		ref := &req.ReferenceImages[index]
		id := strings.TrimPrefix(strings.TrimSpace(ref.ID), "resource:")
		if id == "" {
			id = strings.TrimPrefix(strings.TrimSpace(ref.StorageKey), "resource:")
		}
		resource, err := s.repo.ResourceForUser(userID, id)
		if id == "" || err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return nil, BadAuthRequest("商品参考图片不存在或尚未就绪")
		}
		ref.ID, ref.StorageKey = id, "resource:"+id
	}
	for _, ref := range req.Image.References {
		resource, err := s.repo.ResourceForUser(userID, ref.ResourceID)
		if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return nil, BadAuthRequest("图片模型参考图不存在或尚未就绪")
		}
	}
	// Resolve both stage and image routes now, while an error can still be shown
	// synchronously; no task or credit is created by these prepared requests.
	setting, err := s.EcommerceAgentSetting()
	if err != nil {
		return nil, err
	}
	if setting.planningRef().LogicalModelID == "" && setting.planningRef().ChannelModelID == "" {
		return nil, BadAuthRequest("请在现有电商 Agent 配置中设置整套策划模型")
	}
	imagePreflight := req.Image
	imagePreflight.Prompt = "图片模型预检"
	imagePreflight.Parameters = normalizedCommerceImageParameters(req.Draft, req.Image.Parameters)
	imagePreflight.References = ecommerceExecutionReferences(req.Draft, nil)
	if req.Draft.DetailScreenCount != nil {
		imagePreflight.References = append(imagePreflight.References, workbench.TaskReference{ResourceID: req.Draft.LayoutReferences[0].ResourceID, Kind: "image", Role: "reference"})
	}
	if req.Draft.AutoPackage == nil {
		if _, err := s.createWorkbenchTask(userID, imagePreflight, "", "", &creationTaskPreparation{}); err != nil {
			return nil, err
		}
	} else {
		if resolution := stringValue(imagePreflight.Parameters["imageResolution"]); resolution != "" && resolution != "auto" {
			imagePreflight.Parameters["imageResolution"] = req.Draft.Resolution
		}
		seen := make(map[string]bool)
		for _, slot := range req.Draft.AutoPackage.Slots {
			if seen[slot.Ratio] {
				continue
			}
			seen[slot.Ratio] = true
			imagePreflight.Parameters["size"] = slot.Ratio
			if _, err := s.createWorkbenchTask(userID, imagePreflight, "", "", &creationTaskPreparation{}); err != nil {
				return nil, err
			}
		}
		imagePreflight.Parameters["size"] = req.Draft.AutoPackage.Slots[0].Ratio
	}
	ref := setting.planningRef()
	run := &model.EcommerceExecution{ID: req.ID, RequestHash: requestHash, Status: "queued", Stage: "planning", StartedAt: time.Now().UTC().Format(time.RFC3339Nano), Prompt: req.Prompt, InputSignature: req.InputSignature, ReferenceImages: req.ReferenceImages, Model: req.Image.Model, LogicalModelID: req.Image.LogicalModelID, ChannelID: req.Image.ChannelID, Parameters: imagePreflight.Parameters, PlanningModel: ref.ModelKey, PlanningChannelID: ref.ChannelID, PlanningLogicalModelID: ref.LogicalModelID}
	run.AutoGenerate = req.AutoGenerate == nil || *req.AutoGenerate
	run.Progressive = req.Progressive && run.AutoGenerate
	if req.Draft.AutoPackage != nil {
		run.AutoGenerate, run.Progressive = true, true
	}
	if req.ProjectID != "" {
		project, err := s.repo.EcommerceProject(userID, req.ProjectID)
		if err != nil {
			return nil, err
		}
		if project.Revision != req.Revision {
			return nil, creationConflict("项目已更新，请刷新后重试")
		}
		var stored EcommerceDraft
		if json.Unmarshal([]byte(project.DraftJSON), &stored) != nil {
			return nil, BadAuthRequest("商品草稿无效")
		}
		if stored.Execution.Active() {
			return nil, creationConflict("本轮仍在后台执行")
		}
		stored.Execution = run
		if run.Progressive {
			var existing model.EcommercePlan
			if json.Unmarshal([]byte(project.PlanJSON), &existing) != nil || len(existing.Images) != 0 || len(existing.PreviousImages) != 0 {
				return nil, creationConflict("项目已有图片方案，请从新项目开始逐张生成")
			}
			return s.saveEcommerceExecution(project, stored, &model.EcommercePlan{}, nil, nil)
		}
		return s.saveEcommerceExecution(project, stored, nil, nil, nil)
	}
	return s.createEcommerceExecutionProject(userID, req.Draft, run)
}

func (s *Service) createEcommerceExecutionProject(userID string, draft EcommerceDraft, run *model.EcommerceExecution) (*model.EcommerceProject, error) {
	hash := sha256.Sum256([]byte(userID + ":" + run.ID))
	projectID := "ec-" + hex.EncodeToString(hash[:16])
	if existing, err := s.repo.EcommerceProject(userID, projectID); err == nil {
		var saved EcommerceDraft
		_ = json.Unmarshal([]byte(existing.DraftJSON), &saved)
		if saved.Execution != nil && saved.Execution.ID == run.ID && saved.Execution.RequestHash == run.RequestHash {
			return existing, nil
		}
		return nil, creationConflict("同一创作请求已被使用")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		project := &model.EcommerceProject{ID: projectID, UserID: userID, Name: draft.ProductName, Status: "draft", DraftJSON: "{}", PlanJSON: "{}", ActiveRoundID: newID(), Revision: 1}
		if err := repo.CreateEcommerceProject(project); err != nil {
			return err
		}
		writer := &Service{repo: repo, dataDir: s.dataDir}
		draft.PlanningTaskID, draft.DirectionsTaskID, draft.Execution = "", "", nil
		saved, err := writer.SaveEcommerceProject(userID, projectID, SaveEcommerceProjectRequest{Revision: project.Revision, Name: draft.ProductName, Draft: draft})
		if err != nil {
			return err
		}
		draft.Execution = run
		_, err = writer.saveEcommerceExecution(saved, draft, nil, nil, nil)
		return err
	})
	if err != nil {
		if existing, readErr := s.repo.EcommerceProject(userID, projectID); readErr == nil {
			var saved EcommerceDraft
			_ = json.Unmarshal([]byte(existing.DraftJSON), &saved)
			if saved.Execution != nil && saved.Execution.ID == run.ID && saved.Execution.RequestHash == run.RequestHash {
				return existing, nil
			}
		}
		return nil, err
	}
	return s.EcommerceProject(userID, projectID)
}

func (s *Service) saveEcommerceExecution(project *model.EcommerceProject, draft EcommerceDraft, plan *model.EcommercePlan, task *model.Task, prepared *creationTaskPreparation) (*model.EcommerceProject, error) {
	raw, err := json.Marshal(draft)
	if err != nil {
		return nil, err
	}
	next := *project
	next.DraftJSON = string(raw)
	if plan != nil {
		raw, err = json.Marshal(plan)
		if err != nil {
			return nil, err
		}
		next.PlanJSON = string(raw)
	}
	next.Status = draft.Execution.Status
	if draft.Execution.Status == "running" && draft.Execution.Stage == "planning" {
		next.Status = "planning"
	} else if draft.Execution.Status == "running" && (draft.Execution.Stage == "submitting" || draft.Execution.Stage == "submitted") {
		next.Status = "running"
	}
	var admit func(*repository.Repository) error
	if task != nil {
		var input map[string]any
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return nil, err
		}
		if err := s.protectTaskSecrets(input); err != nil {
			return nil, err
		}
		raw, err = json.Marshal(input)
		if err != nil {
			return nil, err
		}
		task.InputJSON = string(raw)
		policy, err := s.RuntimePolicy()
		if err != nil {
			return nil, err
		}
		if prepared != nil && prepared.Order != nil {
			task.BillingOrderID = prepared.Order.ID
		}
		admit = func(repo *repository.Repository) error {
			var order *model.BillingOrder
			if prepared != nil {
				order = prepared.Order
			}
			return createTaskWithStorageQuotaRepository(repo, task, order, policy)
		}
	}
	if err := s.repo.SaveEcommerceExecution(&next, project.Revision, admit); err != nil {
		return nil, err
	}
	if task != nil {
		s.wakeTaskDispatcher()
	}
	return &next, nil
}

func (s *Service) startEcommerceExecutionWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		cursor := ""
		for {
			projects, err := s.repo.ActiveEcommerceExecutions(cursor, 100)
			if len(projects) < 100 {
				cursor = ""
			} else {
				cursor = projects[len(projects)-1].ID
			}
			if err != nil {
				slog.Warn("ecommerce execution scan failed", "error", err)
			}
			for _, project := range projects {
				if ctx.Err() != nil || s.IsDraining() {
					return
				}
				if s.coordinator != nil {
					release, acquired, leaseErr := s.coordinator.Acquire(ctx, "ecommerce-execution:"+project.ID, 1, 2*time.Minute)
					if leaseErr != nil || !acquired {
						continue
					}
					if err := s.advanceEcommerceExecution(ctx, &project); err != nil && !errors.Is(err, repository.ErrEcommerceRoundConflict) {
						slog.Warn("ecommerce execution advance failed", "projectId", project.ID, "error", err)
					}
					release()
				} else if err := s.advanceEcommerceExecution(ctx, &project); err != nil && !errors.Is(err, repository.ErrEcommerceRoundConflict) {
					slog.Warn("ecommerce execution advance failed", "projectId", project.ID, "error", err)
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

func (s *Service) advanceEcommerceExecution(ctx context.Context, project *model.EcommerceProject) error {
	var draft EcommerceDraft
	if err := json.Unmarshal([]byte(project.DraftJSON), &draft); err != nil {
		return err
	}
	if !draft.Execution.Active() {
		return nil
	}
	var plan model.EcommercePlan
	_ = json.Unmarshal([]byte(project.PlanJSON), &plan)
	err := s.stepEcommerceExecution(ctx, project, &draft, &plan)
	if err == nil || errors.Is(err, repository.ErrEcommerceRoundConflict) {
		return err
	}
	var appErr *AppError
	if errors.Is(err, repository.ErrActiveTaskLimit) || (errors.As(err, &appErr) && (appErr.Status == 429 || appErr.Status == 503)) || ctx.Err() != nil {
		return err
	}
	latest, readErr := s.repo.EcommerceProject(project.UserID, project.ID)
	if readErr != nil {
		return readErr
	}
	if latest.Revision != project.Revision {
		return repository.ErrEcommerceRoundConflict
	}
	draft = EcommerceDraft{}
	if err := json.Unmarshal([]byte(latest.DraftJSON), &draft); err != nil {
		return err
	}
	message := clipText(err.Error(), 1000)
	if draft.Execution.Stage == "planning" {
		slog.Warn("ecommerce analysis failed", "projectId", project.ID, "error", err)
		message = "分析模型暂时无法完成商品分析，请重试。"
		if errors.As(err, &appErr) && appErr.Status == 400 {
			message = appErr.Message
		}
	}
	draft.Execution.Status, draft.Execution.Error = "failed", message
	_, saveErr := s.saveEcommerceExecution(latest, draft, nil, nil, nil)
	return saveErr
}

func (s *Service) stepEcommerceExecution(ctx context.Context, project *model.EcommerceProject, draft *EcommerceDraft, plan *model.EcommercePlan) error {
	run := draft.Execution
	if run.Kind == "shop-edit" || run.Kind == "tryon" {
		return s.stepEcommerceBatchExecution(ctx, project, draft)
	}
	switch run.Status {
	case "queued":
		ref := EcommerceAgentModelRef{ModelKey: run.PlanningModel, ChannelID: run.PlanningChannelID, LogicalModelID: run.PlanningLogicalModelID}
		refs := make([]any, 0, len(run.ReferenceImages))
		for _, image := range run.ReferenceImages {
			refs = append(refs, map[string]any{"id": image.ID, "name": image.Name, "type": "image/*", "dataUrl": "", "storageKey": image.StorageKey})
		}
		snapshot := *draft
		snapshot.Execution = nil
		prepared := &creationTaskPreparation{}
		metadata := map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": project.ID, "ecommerceDraft": snapshot, "ecommerceManaged": true, "ecommerceProgressive": run.Progressive}
		if offset := ecommerceSubmittedPrefix(*draft, *plan); offset > 0 {
			if offset == draft.Count {
				run.Status, run.Stage = "running", "submitting"
				_, err := s.saveEcommerceExecution(project, *draft, plan, nil, nil)
				return err
			}
			metadata["ecommerceResumeAfter"] = offset
		}
		task, err := s.CreateTask(project.UserID, CreateTaskRequest{ProjectID: project.ID, Type: "canvas_text", Model: ref.ModelKey, LogicalModelID: ref.LogicalModelID, Prompt: run.Prompt, creationPrepare: prepared, Input: map[string]any{"mode": "text", "prompt": run.Prompt, "config": map[string]any{"channelId": ref.ChannelID, "model": ref.ModelKey}, "referenceImages": refs, "metadata": metadata}})
		if err != nil {
			return err
		}
		draft.Execution.Status, draft.Execution.Stage, draft.Execution.PlanningTaskID = "running", "planning", task.ID
		draft.PlanningTaskID = task.ID
		_, err = s.saveEcommerceExecution(project, *draft, plan, task, prepared)
		return err
	case "running":
		switch run.Stage {
		case "planning":
			task, err := s.repo.TaskForUser(project.UserID, run.PlanningTaskID)
			if err != nil {
				return err
			}
			switch task.Status {
			case model.TaskStatusFailed, model.TaskStatusCancelled:
				if ecommerceSubmittedPrefix(*draft, *plan) == draft.Count && draft.Count > 0 {
					run.Stage, draft.PlanningTaskID = "submitting", ""
					_, err := s.saveEcommerceExecution(project, *draft, plan, nil, nil)
					return err
				}
				return errors.New(defaultString(task.Error, "分析任务失败"))
			case model.TaskStatusSucceeded:
			default:
				if run.Progressive && task.Status == model.TaskStatusRunning && draft.DetailScreenCount == nil {
					return s.advanceStreamedEcommerceImages(project, *draft, plan, task)
				}
				return nil
			}
			var result struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
				return err
			}
			previous := plan.Images
			*plan = model.EcommercePlan{}
			if err := ecommerceParseJSON(result.Text, plan); err != nil {
				return err
			}
			offset := ecommercePlanningResumeAfter(task.InputJSON)
			if offset > 0 {
				if offset != len(previous) || len(plan.Images) != draft.Count-offset {
					return BadAuthRequest("续做的策划张数与待补页数不一致，请重试")
				}
				suffix := plan.Images
				var stored model.EcommercePlan
				if err := json.Unmarshal([]byte(project.PlanJSON), &stored); err != nil {
					return err
				}
				stored.Images = append(previous[:offset:offset], suffix...)
				stored.UncertainFacts = append(stored.UncertainFacts, plan.UncertainFacts...)
				*plan = stored
			}
			if draft.ReferenceMode == "detail" {
				if draft.DetailScreenCount != nil {
					if err := s.validateEcommerceReferencePlan(project.UserID, *draft, plan); err != nil {
						return err
					}
					alignEcommerceDetailBoundaries(plan)
				}
				draft.Count = len(plan.Images)
				if draft.DetailScreenCount != nil && *draft.DetailScreenCount == 0 {
					slots := make([]ecommercePackageSlot, draft.Count)
					for i := range slots {
						slots[i] = ecommercePackageSlot{Kind: "detail", Ratio: draft.Ratio}
					}
					draft.AutoPackage = &EcommerceAutoPackage{Slots: slots}
				}
			}
			plan.InputSignature = run.InputSignature
			for index := range plan.Images {
				page := &plan.Images[index]
				if run.Progressive && index < len(previous) && previous[index].TaskID != "" {
					*page = previous[index]
					continue
				}
				// Model output cannot invent task receipts or override the user's model.
				page.TaskID, page.ManualPrompt = "", false
				page.Platform, page.Language, page.ImageModel = draft.Platform, draft.Language, draft.ImageModel
				if draft.AutoPackage != nil {
					applyEcommercePackageSlot(*draft, page, index)
				} else if draft.Ratio != "auto" || page.Ratio == "" || page.Ratio == "auto" {
					page.Ratio = defaultString(stringValue(run.Parameters["size"]), draft.Ratio)
				}
				page.Resolution = draft.Resolution
				if !ecommercePlanImageAllowsText(*draft, page.ImageType) {
					page.Copy = ""
				}
				if page.ID == "" {
					page.ID = fmt.Sprintf("screen-%d", index+1)
				}
				if page.ReferenceScreen != nil {
					page.ReferenceScreen.ResourceID = ""
				}
				groundEcommercePageClaims(*draft, *plan, page, index)
			}
			if err := s.validateEcommercePlan(project.UserID, *draft, plan); err != nil {
				return err
			}
			if err := s.validateEcommerceReferencePlan(project.UserID, *draft, plan); err != nil {
				return err
			}
			if len(plan.Images) != draft.Count {
				return BadAuthRequest("策划张数与本轮请求不一致")
			}
			if offset > 0 && draft.ImageType == "detail" {
				if err := validateEcommerceDetailRhythm(*draft, *plan); err != nil {
					return err
				}
				addEcommerceDetailReview(plan)
			}
			if run.Progressive && len(previous) > len(plan.Images) {
				return BadAuthRequest("模型最终返回的策划缺少已生成的屏，请重试")
			}
			if run.Progressive {
				excludeEcommerceExecutionFacts(plan)
				run.Stage = "submitting"
			} else if !run.AutoGenerate {
				run.Status, run.Stage = "awaiting_confirmation", "plan"
			} else if len(plan.UncertainFacts) > 0 {
				draft.Execution.Status, draft.Execution.Stage = "awaiting_confirmation", "facts"
			} else {
				draft.Execution.Stage = "submitting"
			}
			draft.PlanningTaskID = ""
			_, err = s.saveEcommerceExecution(project, *draft, plan, nil, nil)
			return err
		case "submitting":
			for index := range plan.Images {
				if plan.Images[index].TaskID != "" {
					continue
				}
				if ctx.Err() != nil {
					return ctx.Err()
				}
				_, err := s.submitEcommerceExecutionImage(project, *draft, plan, index)
				return err
			}
			draft.Execution.Stage = "submitted"
			// All model tasks are durable; the next phase only observes their results.
			_, err := s.saveEcommerceExecution(project, *draft, plan, nil, nil)
			return err
		case "submitted":
			done, failed := 0, 0
			for _, page := range plan.Images {
				task, err := s.repo.TaskForUser(project.UserID, page.TaskID)
				if err != nil {
					return err
				}
				switch task.Status {
				case model.TaskStatusSucceeded:
					done++
				case model.TaskStatusFailed, model.TaskStatusCancelled:
					failed++
				default:
					return nil
				}
			}
			run.Status = "completed"
			if failed > 0 {
				run.Status = "partial_success"
				run.Error = fmt.Sprintf("%d 张生成失败，已保留成功图片和失败记录", failed)
			}
			if done == 0 {
				run.Status = "failed"
			}
			_, err := s.saveEcommerceExecution(project, *draft, plan, nil, nil)
			return err
		}
	case "awaiting_confirmation":
		return nil
	}
	return nil
}

func (s *Service) submitEcommerceExecutionImage(project *model.EcommerceProject, draft EcommerceDraft, plan *model.EcommercePlan, index int) (*model.EcommerceProject, error) {
	run, page := draft.Execution, &plan.Images[index]
	if draft.ReferenceMode == "detail" && page.ReferenceScreen == nil {
		return nil, BadAuthRequest("本屏缺少参考范围，未提交生成，请重新策划")
	}
	if page.ReferenceScreen != nil && page.ReferenceScreen.ResourceID == "" {
		id, err := s.ecommerceExecutionCrop(project.UserID, run.ID, page.ReferenceScreen)
		if err != nil {
			return nil, err
		}
		page.ReferenceScreen.ResourceID = id
	}
	parameters := map[string]any{"size": page.Ratio, "count": 1}
	for _, key := range []string{"quality", "imageResolution"} {
		if value := run.Parameters[key]; value != nil {
			parameters[key] = value
		}
	}
	prepared := &creationTaskPreparation{}
	prompt := ecommerceExecutionImagePrompt(draft, *plan, *page)
	if draft.AutoPackage != nil && index < len(draft.AutoPackage.Slots) {
		prompt = ecommercePackageImagePrompt(draft, index) + "\n\n" + prompt
	}
	task, err := s.createWorkbenchTask(project.UserID, WorkbenchTaskInput{EcommerceProjectID: project.ID, Kind: "image", Model: run.Model, LogicalModelID: run.LogicalModelID, ChannelID: run.ChannelID, Prompt: prompt, Parameters: parameters, References: ecommerceExecutionReferences(draft, page)}, "", "", prepared)
	if err != nil {
		return nil, err
	}
	page.TaskID = task.ID
	return s.saveEcommerceExecution(project, draft, plan, task, prepared)
}

func (s *Service) RetryEcommerceExecution(userID, projectID, taskID string) (*model.EcommerceProject, error) {
	project, err := s.repo.EcommerceProject(userID, projectID)
	if err != nil {
		return nil, err
	}
	var draft EcommerceDraft
	if err := json.Unmarshal([]byte(project.DraftJSON), &draft); err != nil {
		return nil, err
	}
	run := draft.Execution
	if run == nil || run.Kind != "" {
		return nil, BadAuthRequest("当前创作任务不能重试")
	}
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if taskID != "" {
		var plan model.EcommercePlan
		if err := json.Unmarshal([]byte(project.PlanJSON), &plan); err != nil {
			return nil, err
		}
		for index, page := range plan.Images {
			if page.TaskID != taskID {
				continue
			}
			task, err := s.repo.TaskForUser(userID, taskID)
			if err != nil {
				return nil, err
			}
			if task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled {
				return nil, BadAuthRequest("只有失败或取消的图片可以重试")
			}
			if !run.Active() && run.Stage == "submitted" {
				run.Status, run.Error = "running", ""
			}
			return s.submitEcommerceExecutionImage(project, draft, &plan, index)
		}
		return nil, NotFound("本轮图片任务已更新，请刷新后查看")
	}
	if run.Status != "failed" {
		return nil, BadAuthRequest("当前创作任务不能重试")
	}
	switch run.Stage {
	case "planning", "queued":
		run.Status, run.Stage, run.PlanningTaskID = "queued", "planning", ""
		draft.PlanningTaskID = ""
	case "submitting":
		run.Status = "running"
	default:
		return nil, BadAuthRequest("请在失败图片上点击重试")
	}
	run.Error = ""
	return s.saveEcommerceExecution(project, draft, nil, nil, nil)
}

func (s *Service) ConfirmEcommerceExecution(userID, projectID, decision string) (*model.EcommerceProject, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	project, err := s.repo.EcommerceProject(userID, projectID)
	if err != nil {
		return nil, err
	}
	var draft EcommerceDraft
	var plan model.EcommercePlan
	if err := json.Unmarshal([]byte(project.DraftJSON), &draft); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(project.PlanJSON), &plan); err != nil {
		return nil, err
	}
	if draft.Execution == nil || draft.Execution.Status != "awaiting_confirmation" || (draft.Execution.Stage != "facts" && draft.Execution.Stage != "plan") {
		return nil, BadAuthRequest("当前策划不需要事实确认")
	}
	if decision == "exclude" {
		excludeEcommerceExecutionFacts(&plan)
		draft.Execution.Status, draft.Execution.Stage = "running", "submitting"
	} else if decision == "approve" {
		plan.ConfirmedFacts = append(plan.ConfirmedFacts, plan.UncertainFacts...)
		plan.UncertainFacts = []string{}
		draft.Execution.Status, draft.Execution.Stage = "running", "submitting"
	} else {
		return nil, BadAuthRequest("确认操作无效")
	}
	_, err = s.saveEcommerceExecution(project, draft, &plan, nil, nil)
	if err != nil {
		return nil, err
	}
	return s.EcommerceProject(userID, projectID)
}

func excludeEcommerceExecutionFacts(plan *model.EcommercePlan) {
	if len(plan.UncertainFacts) == 0 {
		return
	}
	facts, _ := json.Marshal(plan.UncertainFacts)
	exclusion := "以下商品主张未经核实，不得用于本图的文案、标注或视觉功能表达：" + string(facts)
	for _, fact := range plan.UncertainFacts {
		if fact = strings.TrimSpace(fact); fact == "" {
			continue
		}
		if summary := strings.TrimSpace(strings.ReplaceAll(plan.ProductSummary, fact, "")); summary != "" {
			plan.ProductSummary = summary
		} else {
			plan.ProductSummary = "依据参考图保留商品可见外观。"
		}
		if visual := strings.TrimSpace(strings.ReplaceAll(plan.VisualStrategy, fact, "")); visual != "" {
			plan.VisualStrategy = visual
		} else {
			plan.VisualStrategy = "采用各屏策划的构图、光线与版式。"
		}
		for i := range plan.Images {
			page := &plan.Images[i]
			if page.TaskID != "" {
				continue
			}
			for _, field := range []*string{&page.Copy, &page.Prompt, &page.VerifiedClaims, &page.MainVisual, &page.Composition, &page.DisplayAssignment} {
				*field = strings.ReplaceAll(*field, fact, "")
			}
		}
	}
	for i := range plan.Images {
		page := &plan.Images[i]
		if page.TaskID == "" {
			page.NegativePrompt += "\n" + exclusion
		}
	}
	plan.QualityChecks = append(plan.QualityChecks, exclusion)
	plan.UncertainFacts = []string{}
}

func ecommerceExecutionReferences(draft EcommerceDraft, page *model.EcommercePlanTask) []workbench.TaskReference {
	all := append([]EcommerceReference{}, draft.References...)
	if draft.ReferenceMode != "detail" {
		all = append(all, ecommerceLayoutSources(draft)...)
	}
	if page != nil && page.ReferenceScreen != nil {
		// An identity photo is an especially strong visual cue. Information-only
		// sections receive their layout crop, without any product packshot.
		if draft.ReferenceMode == "detail" && page.ReferenceScreen.ProductView == "none" {
			all = nil
			for _, ref := range draft.References {
				if ref.Role == "model" {
					all = append(all, ref)
				}
			}
		}
		all = append(all, EcommerceReference{ResourceID: page.ReferenceScreen.ResourceID})
	}
	refs := []workbench.TaskReference{}
	seen := map[string]bool{}
	for _, ref := range all {
		if ref.ResourceID == "" || seen[ref.ResourceID] || (ref.Role == "model" && !draft.ModelEnabled) {
			continue
		}
		if page != nil && ref.Role == "sku" {
			matches := false
			for _, sku := range draft.Skus {
				if sku.ID == page.SkuID && sku.ResourceID == ref.ResourceID {
					matches = true
				}
			}
			if !matches {
				continue
			}
		}
		seen[ref.ResourceID] = true
		refs = append(refs, workbench.TaskReference{ResourceID: ref.ResourceID, Kind: "image", Role: "reference"})
	}
	return refs
}

func normalizedCommerceImageParameters(draft EcommerceDraft, parameters map[string]any) map[string]any {
	result := map[string]any{"size": defaultString(stringValue(parameters["size"]), draft.Ratio), "count": 1}
	for _, key := range []string{"quality", "imageResolution"} {
		if value := parameters[key]; value != nil {
			result[key] = value
		}
	}
	return result
}

func ecommerceExecutionImagePrompt(draft EcommerceDraft, plan model.EcommercePlan, page model.EcommercePlanTask) string {
	copyRule := "不添加任何新文字，保留商品真实 Logo 与包装原文。"
	if page.ImageType == "white" || draft.ImageType == "white" {
		copyRule += "背景为纯白 RGB 255,255,255，完整呈现商品，保留自然接触阴影。"
	}
	if ecommercePlanImageAllowsText(draft, page.ImageType) && page.Copy != "" {
		copyRule = "只允许以下文案和商品自身文字，逐字保留，不增写标签、参数或装饰字；语言：" + draft.Language + "\n" + page.Copy
	}
	reference := ""
	if screen := page.ReferenceScreen; screen != nil {
		reference = fmt.Sprintf("【本屏参考·视觉执行】只重绘第 %d 屏；内容：%s；布局：%s；视觉：%s。最后一张附图是当前屏的真实参考裁片，其余商品素材用于身份保真。", screen.ScreenIndex, screen.Content, screen.Layout, screen.Visual)
		reference += "\n保持裁片对应的主体、人物与环境占比、图文位置、背景、配色、光线、字体和信息组件；商品使用本商品真实外观和原色，不能据此把整套背景改成商品颜色。参考版式优先于通用商品居中、换机位、换场景建议。人物场景按本商品用途改编，原图的品牌、参数、功效和百分比不得移植，文字只用本张白名单。套内版心与尺度一致，边缘延展到画幅，不加外框和补白。"
		if index := screen.ScreenIndex - 2; index >= 0 && index < len(plan.Images) && plan.Images[index].ReferenceScreen != nil && plan.Images[index].ReferenceScreen.BottomJoin != "" {
			reference += "\n【上边缘衔接】" + plan.Images[index].ReferenceScreen.BottomJoin
		}
		if screen.BottomJoin != "" {
			reference += "\n【下边缘衔接】" + screen.BottomJoin
		}
		switch screen.ProductView {
		case "none":
			reference += "\n本屏商品不出镜，按裁片表现原料、场景、图解或纯信息，不添加整件、包装、缩略商品或替代品牌。"
		case "detail":
			reference += "\n画面只取本屏指定局部，细节就是主视觉，不补全整件或另摆包装。"
		case "supporting":
			reference += "\n商品仅作配角，按裁片原有占比留给环境、人物或信息，不放大到中央。"
		default:
			reference += "\n只在原屏确有商品处展示商品，原屏没有整件时不能补入整件。"
		}
	}
	return strings.Join([]string{reference, page.Prompt, "【整套视觉系统】" + plan.VisualStrategy, "【本屏拍摄】" + page.DisplayAssignment + "\n" + page.Composition + "\n" + page.MainVisual + "\n" + page.Lighting, "【商品事实】" + plan.ProductSummary + "\n" + draft.LockedDetails, "【画面文字白名单】" + copyRule, ecommerceagent.PlatformKnowledgePrompt(draft.Platform, draft.Region, page.ImageType, draft.TypeOptions["purpose"]), ecommerceagent.LayoutSafetyRule, ecommerceagent.HumanPhotographyKnowledge, "【避免】" + page.NegativePrompt}, "\n\n")
}

func (s *Service) ecommerceExecutionCrop(userID, runID string, screen *model.EcommerceReferenceScreen) (string, error) {
	return s.ecommerceExecutionCropBox(userID, screen.SourceResourceID, fmt.Sprintf("ecommerce-%s-screen-%d", runID, screen.ScreenIndex), 0, screen.Top, 1, screen.Bottom)
}

func (s *Service) ecommerceExecutionCropBox(userID, sourceID, key string, left, top, right, bottom float64) (string, error) {
	if !(left >= 0 && top >= 0 && right <= 1 && bottom <= 1 && right > left && bottom > top) {
		return "", BadAuthRequest("参考裁片范围无效")
	}
	_, body, err := s.OpenResource(userID, sourceID)
	if err != nil {
		return "", err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, (32<<20)+1))
	if err != nil {
		return "", err
	}
	if len(data) > 32<<20 {
		return "", BadAuthRequest("参考长图超过处理上限")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	if int64(config.Width)*int64(config.Height) > 80_000_000 {
		return "", BadAuthRequest("参考长图像素过大")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	bounds := src.Bounds()
	rect := image.Rect(bounds.Min.X+int(float64(bounds.Dx())*left), bounds.Min.Y+int(float64(bounds.Dy())*top), bounds.Min.X+int(float64(bounds.Dx())*right), bounds.Min.Y+int(float64(bounds.Dy())*bottom)).Intersect(bounds)
	if rect.Empty() {
		return "", BadAuthRequest("参考裁片范围无效")
	}
	dst := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	draw.Draw(dst, dst.Bounds(), src, rect.Min, draw.Src)
	var output bytes.Buffer
	if err := png.Encode(&output, dst); err != nil {
		return "", err
	}
	resource, err := s.UploadResourceFile(userID, "参考裁片.png", int64(output.Len()), "image", rect.Dx(), rect.Dy(), 0, bytes.NewReader(output.Bytes()), key)
	if err != nil {
		return "", err
	}
	return resource.ID, nil
}
