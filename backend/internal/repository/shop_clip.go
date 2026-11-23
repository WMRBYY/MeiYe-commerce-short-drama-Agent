package repository

import (
	"gorm.io/gorm"
	"time"
	"yingce/backend/internal/model"
)

func (r *Repository) ShopClip(userID, id string) (*model.ShopClipProject, error) {
	var p model.ShopClipProject
	err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&p).Error
	return &p, err
}

func (r *Repository) ShopClipByRequest(userID, key string) (*model.ShopClipProject, error) {
	var p model.ShopClipProject
	err := r.db.Where("user_id = ? AND request_key = ?", userID, key).First(&p).Error
	return &p, err
}

func (r *Repository) ShopClipAttempt(userID, projectID, key string) (*model.ShopClipAttempt, error) {
	var row model.ShopClipAttempt
	err := r.db.Where("user_id = ? AND project_id = ? AND key = ?", userID, projectID, key).First(&row).Error
	return &row, err
}

func (r *Repository) ShopClips(userID string) ([]model.ShopClipProject, error) {
	items := []model.ShopClipProject{}
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Limit(50).Find(&items).Error
	return items, err
}

func (r *Repository) CreateShopClip(p *model.ShopClipProject, ids []string) error {
	return r.Transaction(func(tx *Repository) error {
		if err := tx.db.Create(p).Error; err != nil {
			return err
		}
		for _, id := range ids {
			if err := tx.db.Create(&model.ShopClipResource{ProjectID: p.ID, UserID: p.UserID, ResourceID: id}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) UpdateShopClip(userID, id, taskID string, states []string, values map[string]any) error {
	values["updated_at"] = time.Now()
	q := r.db.Model(&model.ShopClipProject{}).Where("id = ? AND user_id = ?", id, userID)
	if taskID != "" {
		q = q.Where("task_id = ?", taskID)
	}
	if len(states) > 0 {
		q = q.Where("status IN ?", states)
	}
	res := q.Updates(values)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) UpdateShopClipPlan(userID, id, taskID, previous, next, title string) error {
	res := r.db.Model(&model.ShopClipProject{}).Where("user_id = ? AND id = ? AND task_id = ? AND status = ? AND plan_json = ?", userID, id, taskID, "ready", previous).Updates(map[string]any{"plan_json": next, "title": title, "updated_at": time.Now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

func (r *Repository) ShopClipResourceReferences(userID string, ids []string) ([]ResourceDirectReference, error) {
	refs := []ResourceDirectReference{}
	if !r.db.Migrator().HasTable(&model.ShopClipResource{}) {
		return refs, nil
	}
	var rows []model.ShopClipResource
	q := r.db.Where("resource_id IN ?", ids)
	if userID != "" {
		q = q.Where("user_id = ?", userID)
	}
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		refs = append(refs, ResourceDirectReference{Kind: "电商视频剪辑", ID: row.ProjectID, ResourceID: row.ResourceID})
	}
	return refs, nil
}
