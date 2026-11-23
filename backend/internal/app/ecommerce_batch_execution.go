package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

type EcommerceBatchJobRequest struct {
	Key       string             `json:"key"`
	Request   WorkbenchTaskInput `json:"request"`
	DependsOn string             `json:"dependsOn,omitempty"`
	AnchorAt  string             `json:"anchorAt,omitempty"`
}

type EcommerceBatchExecutionRequest struct {
	ID          string                     `json:"id"`
	Kind        string                     `json:"kind"`
	Title       string                     `json:"title"`
	ClientState json.RawMessage            `json:"clientState"`
	Planning    *CreateTaskRequest         `json:"planning,omitempty"`
	Jobs        []EcommerceBatchJobRequest `json:"jobs"`
}

// Batch intents use the same project persistence, worker, model catalogue and
// charge transactions as detail images. This is not a second task backend.
func (s *Service) StartEcommerceBatchExecution(userID string, req EcommerceBatchExecutionRequest) (*model.EcommerceProject, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	if (req.Kind != "shop-edit" && req.Kind != "tryon") || len(req.ID) < 8 || len(req.ID) > 64 || len(req.Jobs) < 1 || len(req.Jobs) > 20 || len(req.ClientState) > 1<<20 {
		return nil, BadAuthRequest("批量任务参数无效")
	}
	if req.Kind == "tryon" {
		fn := tryOnFunctionFromBatchID(req.ID)
		if fn == "" {
			return nil, BadAuthRequest("换装批次编号无效")
		}
		if err := s.RequireEcommerceTryOn(userID, fn); err != nil {
			return nil, err
		}
		var state struct {
			Source struct {
				Consent bool `json:"consent"`
			} `json:"source"`
		}
		if json.Unmarshal(req.ClientState, &state) != nil || (fn == "face-swap" && !state.Source.Consent) {
			return nil, BadAuthRequest("请确认人物肖像授权")
		}
	}
	raw, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(sum[:])
	key := sha256.Sum256([]byte(userID + ":" + req.ID))
	projectID := "ec-" + hex.EncodeToString(key[:16])
	if existing, err := s.repo.EcommerceProject(userID, projectID); err == nil {
		var draft EcommerceDraft
		if json.Unmarshal([]byte(existing.DraftJSON), &draft) == nil && draft.Execution != nil && draft.Execution.RequestHash == fingerprint {
			return existing, nil
		}
		return nil, creationConflict("批量提交编号不能用于不同内容")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	run := &model.EcommerceExecution{ID: req.ID, Kind: req.Kind, RequestHash: fingerprint, Status: "running", Stage: "submitting", ClientState: req.ClientState}
	seen := map[string]bool{}
	for _, job := range req.Jobs {
		if job.Key == "" || len(job.Key) > 200 || seen[job.Key] || job.Request.Kind != "image" || len(job.Request.Prompt) > 32000 {
			return nil, BadAuthRequest("批量图片任务无效")
		}
		if job.DependsOn != "" && !seen[job.DependsOn] {
			return nil, BadAuthRequest("依赖图片必须在当前图片之前")
		}
		if job.AnchorAt != "" && job.AnchorAt != "first" && job.AnchorAt != "last" {
			return nil, BadAuthRequest("参考图顺序无效")
		}
		seen[job.Key] = true
		job.Request.ClientSubmissionID = ""
		job.Request.EcommerceProjectID = ""
		if job.Request.Batch != nil {
			if fn := tryOnFunctionFromBatchID(job.Request.Batch.ID); fn != "" {
				if err := s.RequireEcommerceTryOn(userID, fn); err != nil {
					return nil, err
				}
			}
		}
		if _, err := s.createWorkbenchTask(userID, job.Request, "", "", &creationTaskPreparation{}); err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(job.Request)
		if err != nil {
			return nil, err
		}
		run.Jobs = append(run.Jobs, model.EcommerceExecutionJob{Key: job.Key, Request: encoded, DependsOn: job.DependsOn, AnchorAt: job.AnchorAt})
	}
	if req.Planning != nil {
		if req.Kind != "tryon" || req.Planning.Type != "canvas_text" || len(req.Planning.Prompt) > 128000 {
			return nil, BadAuthRequest("批量分析参数无效")
		}
		input, err := normalizeTaskInput(req.Planning.Input)
		if err != nil {
			return nil, err
		}
		metadata, _ := input["metadata"].(map[string]any)
		fn := stringValue(metadata["tryonFunction"])
		if err := s.RequireEcommerceTryOn(userID, fn); err != nil {
			return nil, err
		}
		if fn != tryOnFunctionFromBatchID(req.ID) {
			return nil, BadAuthRequest("分析功能与批次不一致")
		}
		setting, err := s.EcommerceAgentSetting()
		if err != nil {
			return nil, err
		}
		ref := setting.visionRef()
		if ref.ChannelModelID == "" && ref.LogicalModelID == "" {
			return nil, BadAuthRequest("请在电商 Agent 配置中设置商品识别模型")
		}
		refs, _ := input["referenceImages"].([]any)
		if len(refs) > 24 {
			return nil, BadAuthRequest("分析参考图数量超出限制")
		}
		for index, item := range refs {
			image, ok := item.(map[string]any)
			if !ok {
				return nil, BadAuthRequest("分析参考图无效")
			}
			id := strings.TrimPrefix(stringValue(image["storageKey"]), "resource:")
			resource, err := s.repo.ResourceForUser(userID, id)
			if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
				return nil, BadAuthRequest("分析参考图不存在或不属于当前用户")
			}
			refs[index] = map[string]any{"storageKey": "resource:" + id, "name": stringValue(image["name"])}
		}
		request := CreateTaskRequest{Type: "canvas_text", Model: ref.ModelKey, LogicalModelID: ref.LogicalModelID, Prompt: req.Planning.Prompt, Input: map[string]any{"mode": "text", "prompt": req.Planning.Prompt, "config": map[string]any{"channelId": ref.ChannelID, "model": ref.ModelKey}, "referenceImages": refs, "metadata": map[string]any{"source": "ecommerce-tryon", "stage": "tryon-planning", "tryonFunction": fn, "tryonBatchId": req.ID}, "textOptions": map[string]any{"thinkingLevel": setting.VisionThinkingLevel}}}
		run.PlanningRequest, _ = json.Marshal(request)
		run.Status, run.Stage = "queued", "planning"
	}
	draft := EcommerceDraft{ProductName: defaultString(strings.TrimSpace(req.Title), "电商图片"), Count: len(req.Jobs), Platform: "taobao", ImageType: "set", Language: "zh-CN", ReferenceMode: "product"}
	return s.createEcommerceExecutionProject(userID, draft, run)
}

func (s *Service) stepEcommerceBatchExecution(ctx context.Context, project *model.EcommerceProject, draft *EcommerceDraft) error {
	run := draft.Execution
	if run.Status == "queued" {
		var request CreateTaskRequest
		if err := json.Unmarshal(run.PlanningRequest, &request); err != nil {
			return err
		}
		prepared := &creationTaskPreparation{}
		request.creationPrepare = prepared
		task, err := s.CreateTask(project.UserID, request)
		if err != nil {
			return err
		}
		run.Status, run.Stage, run.PlanningTaskID = "running", "planning", task.ID
		_, err = s.saveEcommerceExecution(project, *draft, nil, task, prepared)
		return err
	}
	switch run.Stage {
	case "planning":
		task, err := s.repo.TaskForUser(project.UserID, run.PlanningTaskID)
		if err != nil {
			return err
		}
		if task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled {
			return errors.New(defaultString(task.Error, "批量分析失败，输入已保留"))
		}
		if task.Status != model.TaskStatusSucceeded {
			return nil
		}
		var result struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
			return err
		}
		var analysis struct {
			Shots []struct {
				Scene    string `json:"scene"`
				Pose     string `json:"pose"`
				Camera   string `json:"camera"`
				Lighting string `json:"lighting"`
				Styling  string `json:"styling"`
				Persona  string `json:"persona"`
			} `json:"shots"`
			Models []struct {
				Hair string `json:"hair"`
			} `json:"models"`
			Faces []struct {
				Hair string    `json:"hair"`
				Box  []float64 `json:"box"`
			} `json:"faces"`
		}
		if err := ecommerceParseJSON(result.Text, &analysis); err != nil {
			return err
		}
		if len(analysis.Shots) == 0 && len(analysis.Models) == 0 {
			return BadAuthRequest("分析没有返回有效场景或人物信息")
		}
		var state struct {
			Source struct {
				Fn     string `json:"fn"`
				Images map[string][]struct {
					Slot       string `json:"slot"`
					ResourceID string `json:"resourceId"`
				} `json:"images"`
			} `json:"source"`
		}
		_ = json.Unmarshal(run.ClientState, &state)
		if state.Source.Fn == "pose" && len(analysis.Shots) != len(run.Jobs) {
			return BadAuthRequest("姿势分析未覆盖全部图片，未提交生成")
		}
		modelHair := map[string]string{}
		faceCrops := map[string]string{}
		mi, fi := 0, 0
		for _, image := range state.Source.Images[state.Source.Fn] {
			if image.Slot == "model" {
				if mi < len(analysis.Models) {
					modelHair[image.ResourceID] = analysis.Models[mi].Hair
				}
				mi++
			}
			if image.Slot == "face" {
				if fi < len(analysis.Faces) && len(analysis.Faces[fi].Box) == 4 {
					box := analysis.Faces[fi].Box
					if box[0] < 0 || box[1] < 0 || box[2] > 1000 || box[3] > 1000 {
						fi++
						continue
					}
					if box[2]-box[0] >= 30 && box[3]-box[1] >= 30 {
						crop, err := s.ecommerceExecutionCropBox(project.UserID, image.ResourceID, fmt.Sprintf("tryon-%s-face-%d", run.ID, fi), box[0]/1000, box[1]/1000, box[2]/1000, box[3]/1000)
						if err == nil {
							faceCrops[image.ResourceID] = crop
						}
					}
				}
				fi++
			}
		}
		for i := range run.Jobs {
			var request WorkbenchTaskInput
			if err := json.Unmarshal(run.Jobs[i].Request, &request); err != nil {
				return err
			}
			if len(analysis.Shots) > 0 {
				shot := analysis.Shots[i%len(analysis.Shots)]
				block := fmt.Sprintf("【本张拍摄】场景：%s。姿势：%s。机位：%s。光线：%s。造型：%s。", shot.Scene, shot.Pose, shot.Camera, shot.Lighting, shot.Styling)
				pattern := regexp.MustCompile(`【本张拍摄】[^\n]*`)
				if pattern.MatchString(request.Prompt) {
					request.Prompt = pattern.ReplaceAllStringFunc(request.Prompt, func(string) string { return block })
				} else {
					request.Prompt += "\n\n" + block
				}
				if shot.Persona != "" {
					request.Prompt += "\n【本张原创人物】" + shot.Persona
				}
			}
			for ri := range request.References {
				ref := &request.References[ri]
				if hair := modelHair[ref.ResourceID]; hair != "" {
					request.Prompt += "\n【原图头部保持】" + hair + "。只修改五官，保持原图发型头型。"
				}
				if crop := faceCrops[ref.ResourceID]; crop != "" {
					ref.ResourceID = crop
				}
			}
			run.Jobs[i].Request, _ = json.Marshal(request)
		}
		run.Stage = "submitting"
		_, err = s.saveEcommerceExecution(project, *draft, nil, nil, nil)
		return err
	case "submitting":
		for i := range run.Jobs {
			job := &run.Jobs[i]
			if job.TaskID != "" {
				continue
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			var request WorkbenchTaskInput
			if err := json.Unmarshal(job.Request, &request); err != nil {
				return err
			}
			if job.DependsOn != "" {
				var parent string
				for _, candidate := range run.Jobs {
					if candidate.Key == job.DependsOn {
						parent = candidate.TaskID
						break
					}
				}
				if parent == "" {
					return nil
				}
				task, err := s.repo.TaskForUser(project.UserID, parent)
				if err != nil {
					return err
				}
				if task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled {
					return BadAuthRequest("首张没有生成成功，后续图片已保留且未扣费")
				}
				if task.Status != model.TaskStatusSucceeded {
					return nil
				}
				var result struct {
					Images []struct {
						StorageKey string `json:"storageKey"`
					} `json:"images"`
				}
				if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
					return err
				}
				if len(result.Images) == 0 {
					return BadAuthRequest("首图结果缺少图片资源")
				}
				ref := workbench.TaskReference{ResourceID: strings.TrimPrefix(result.Images[0].StorageKey, "resource:"), Kind: "image", Role: "reference"}
				if job.AnchorAt == "last" {
					request.References = append(request.References, ref)
				} else {
					request.References = append([]workbench.TaskReference{ref}, request.References...)
				}
			}
			request.EcommerceProjectID = project.ID
			prepared := &creationTaskPreparation{}
			task, err := s.createWorkbenchTask(project.UserID, request, "", "", prepared)
			if err != nil {
				return err
			}
			job.TaskID = task.ID
			_, err = s.saveEcommerceExecution(project, *draft, nil, task, prepared)
			return err
		}
		run.Stage = "submitted"
		_, err := s.saveEcommerceExecution(project, *draft, nil, nil, nil)
		return err
	case "submitted":
		failed := 0
		for _, job := range run.Jobs {
			task, err := s.repo.TaskForUser(project.UserID, job.TaskID)
			if err != nil {
				return err
			}
			switch task.Status {
			case model.TaskStatusSucceeded:
			case model.TaskStatusFailed, model.TaskStatusCancelled:
				failed++
			default:
				return nil
			}
		}
		run.Status = "completed"
		if failed > 0 {
			run.Status = "partial_success"
			run.Error = fmt.Sprintf("%d 张失败，成功图片和失败记录均已保留", failed)
		}
		if failed == len(run.Jobs) {
			run.Status = "failed"
		}
		_, err := s.saveEcommerceExecution(project, *draft, nil, nil, nil)
		return err
	}
	return nil
}
