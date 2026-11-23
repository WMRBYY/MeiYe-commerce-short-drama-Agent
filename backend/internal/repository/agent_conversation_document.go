package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) AgentConversationDocument(userID, canvasID string) (*model.AgentConversationDocument, error) {
	var document model.AgentConversationDocument
	err := r.db.First(&document, "user_id = ? AND canvas_id = ?", userID, canvasID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &document, nil
}

func (r *Repository) SaveAgentConversationDocument(userID, canvasID string, expectedRevision int64, body string) (int64, error) {
	now := time.Now().UTC()
	if expectedRevision == 0 {
		created := model.AgentConversationDocument{UserID: userID, CanvasID: canvasID, Revision: 1, DocumentJSON: body, CreatedAt: now, UpdatedAt: now}
		result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&created)
		if result.Error != nil {
			return 0, result.Error
		}
		if result.RowsAffected != 1 {
			return 0, ErrTaskStateConflict
		}
		return 1, nil
	}
	result := r.db.Model(&model.AgentConversationDocument{}).
		Where("user_id = ? AND canvas_id = ? AND revision = ?", userID, canvasID, expectedRevision).
		Updates(map[string]any{"document_json": body, "revision": expectedRevision + 1, "updated_at": now})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, ErrTaskStateConflict
	}
	return expectedRevision + 1, nil
}
