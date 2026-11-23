package app

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"strings"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// DeleteEcommerceBatch commits the current round, its generated assets and deletion outbox together.
func (s *Service) DeleteEcommerceBatch(userID, projectID string, revision int64) (*model.EcommerceProject, []string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(projectID) == "" || revision < 1 {
		return nil, nil, BadAuthRequest("请提供有效的项目和版本")
	}
	var project *model.EcommerceProject
	assetIDs := []string{}
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		var err error
		project, err = repo.LockEcommerceProject(userID, projectID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("电商项目不存在")
		}
		if err != nil {
			return err
		}
		if project.Revision != revision {
			return creationConflict("本批次已更新，请刷新后重新确认删除")
		}
		var plan model.EcommercePlan
		var rawPlan map[string]json.RawMessage
		var draft map[string]json.RawMessage
		if json.Unmarshal([]byte(project.PlanJSON), &plan) != nil || json.Unmarshal([]byte(project.PlanJSON), &rawPlan) != nil || json.Unmarshal([]byte(project.DraftJSON), &draft) != nil || rawPlan == nil || draft == nil {
			return BadAuthRequest("项目数据无法读取，已停止删除")
		}
		if len(plan.Images) == 0 {
			return BadAuthRequest("本轮没有可删除的作品")
		}
		retained := map[string]bool{}
		for _, image := range plan.PreviousImages {
			retained[image.TaskID] = true
		}
		ids := []string{}
		for _, image := range plan.Images {
			if image.TaskID != "" && !retained[image.TaskID] {
				ids = append(ids, image.TaskID)
			}
		}
		tasks, err := repo.LockUserTasks(userID, ids)
		if err != nil {
			return err
		}
		taskSet := map[string]bool{}
		taskIDs := []string{}
		for _, task := range tasks {
			switch task.Status {
			case model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled:
			default:
				return BadAuthRequest("本批次仍有任务在处理中，请完成后再删除")
			}
			taskSet[task.ID] = true
			taskIDs = append(taskIDs, task.ID)
		}
		var planningID string
		_ = json.Unmarshal(draft["planningTaskId"], &planningID)
		if planningID != "" {
			planning, err := repo.TaskForUser(userID, planningID)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err == nil && planning.Status != model.TaskStatusSucceeded && planning.Status != model.TaskStatusFailed && planning.Status != model.TaskStatusCancelled {
				return BadAuthRequest("图片方案仍在处理中，请完成后再删除")
			}
		}
		assets, err := repo.Assets(userID)
		if err != nil {
			return err
		}
		for _, asset := range assets {
			var payload struct {
				Metadata struct {
					TaskID string `json:"taskId"`
				} `json:"metadata"`
			}
			if json.Unmarshal([]byte(asset.PayloadJSON), &payload) == nil && taskSet[payload.Metadata.TaskID] {
				assetIDs = append(assetIDs, asset.ID)
			}
		}
		if len(assetIDs) > 0 {
			if err := s.deleteUserAssetsWithResources(userID, assetIDs, true, repo); err != nil {
				return err
			}
		}
		if err := repo.DeleteTerminalTasks(userID, taskIDs); err != nil {
			return err
		}
		rawPlan["images"] = json.RawMessage(`[]`)
		if len(plan.PreviousImages) == 0 {
			rawPlan = map[string]json.RawMessage{}
		}
		delete(draft, "planningTaskId")
		planJSON, err := json.Marshal(rawPlan)
		if err != nil {
			return err
		}
		draftJSON, err := json.Marshal(draft)
		if err != nil {
			return err
		}
		project.PlanJSON = string(planJSON)
		project.DraftJSON = string(draftJSON)
		project.Status = "draft"
		return repo.SaveEcommerceProject(project, revision)
	})
	if err == nil && len(assetIDs) > 0 {
		s.runWorkerTask(func() { s.drainResourceDeletionJobs(1000) })
	}
	return project, assetIDs, err
}
