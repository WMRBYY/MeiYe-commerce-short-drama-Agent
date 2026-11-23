package repository

import (
	"time"
	"yingce/backend/internal/model"
)

func (r *Repository) AssertShopClipPlan(userID, id, taskID, plan string) error {
	res := r.db.Model(&model.ShopClipProject{}).Where("user_id = ? AND id = ? AND task_id = ? AND plan_json = ?", userID, id, taskID, plan).Update("updated_at", time.Now())
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

func (r *Repository) ShopClipCheckpoint(task *model.Task, projectID, step, planJSON string) error {
	return r.Transaction(func(tx *Repository) error {
		res := tx.db.Model(&model.Task{}).Where("id = ? AND user_id = ? AND lease_owner = ? AND status = ?", task.ID, task.UserID, task.LeaseOwner, model.TaskStatusRunning).Update("updated_at", time.Now())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		states := []string{"analyzing"}
		if step == "render_running" {
			states = append(states, "rendering")
		}
		return tx.UpdateShopClip(task.UserID, projectID, task.ID, states, map[string]any{"analysis_step": step, "plan_json": planJSON})
	})
}
