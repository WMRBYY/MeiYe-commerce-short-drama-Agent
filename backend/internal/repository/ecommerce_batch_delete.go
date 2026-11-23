package repository

import (
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) LockEcommerceProject(userID, id string) (*model.EcommerceProject, error) {
	var project model.EcommerceProject
	query := r.db.Where("user_id = ? AND id = ?", userID, id)
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.First(&project).Error
	return &project, err
}

func (r *Repository) LockUserTasks(userID string, ids []string) ([]model.Task, error) {
	tasks := []model.Task{}
	if len(ids) == 0 {
		return tasks, nil
	}
	query := r.db.Where("user_id = ? AND id IN ?", userID, ids).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.Find(&tasks).Error
	return tasks, err
}
