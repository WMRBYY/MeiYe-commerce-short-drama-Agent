package repository

import (
	"encoding/json"
	"time"

	"yingce/backend/internal/model"
)

// A task, its charge and its project receipt commit together. A competing
// worker's stale revision fails before admission and cannot charge twice.
func (r *Repository) SaveEcommerceExecution(project *model.EcommerceProject, expected int64, admit func(*Repository) error) error {
	updatedAt := time.Now()
	err := r.Transaction(func(repo *Repository) error {
		stored, err := lockEcommerceProject(repo.db, project.UserID, project.ID)
		if err != nil {
			return err
		}
		if stored.Revision != expected {
			return ErrEcommerceRoundConflict
		}
		if admit != nil {
			if err := admit(repo); err != nil {
				return err
			}
		}
		result := repo.db.Model(&model.EcommerceProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expected).
			Updates(map[string]any{"name": project.Name, "draft_json": project.DraftJSON, "plan_json": project.PlanJSON, "status": project.Status, "revision": expected + 1, "updated_at": updatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrEcommerceRoundConflict
		}
		return nil
	})
	if err == nil {
		project.Revision, project.UpdatedAt = expected+1, updatedAt
	}
	return err
}

func (r *Repository) ActiveEcommerceExecutions(afterID string, limit int) ([]model.EcommerceProject, error) {
	var rows []model.EcommerceProject
	err := r.db.Where("id > ? AND status IN ? AND draft_json LIKE ?", afterID, []string{"queued", "planning", "running"}, `%"execution":%`).Order("id").Limit(limit).Find(&rows).Error
	return rows, err
}

// This is called before the credit-account lock, keeping the same lock order
// as managed executions. A disconnected POST still leaves a durable receipt.
func (r *Repository) bindEcommerceAnalysisTask(task *model.Task) error {
	if task.Type != "canvas_text" {
		return nil
	}
	var input struct {
		Metadata struct {
			Source    string `json:"source"`
			Stage     string `json:"stage"`
			ProjectID string `json:"ecommerceProjectId"`
			Managed   bool   `json:"ecommerceManaged"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.Source != "ecommerce-agent" || input.Metadata.Managed {
		return nil
	}
	field := ""
	switch input.Metadata.Stage {
	case "planning":
		field = "planningTaskId"
	case "creative-directions":
		field = "directionsTaskId"
	default:
		return nil
	}
	project, err := lockEcommerceProject(r.db, task.UserID, input.Metadata.ProjectID)
	if err != nil {
		return err
	}
	var draft map[string]any
	if err := json.Unmarshal([]byte(project.DraftJSON), &draft); err != nil {
		return err
	}
	if draft == nil {
		draft = map[string]any{}
	}
	draft[field] = task.ID
	raw, err := json.Marshal(draft)
	if err != nil {
		return err
	}
	// Do not invalidate the submitting client's identical receipt save.
	return r.db.Model(&model.EcommerceProject{}).Where("id = ? AND user_id = ?", project.ID, task.UserID).
		Updates(map[string]any{"draft_json": string(raw), "status": "planning", "updated_at": time.Now()}).Error
}
