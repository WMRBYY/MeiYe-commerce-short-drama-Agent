package app

import (
	"encoding/json"
	"errors"
	"net/http"

	"gorm.io/gorm"
	"yingce/backend/internal/repository"
)

type AgentConversationDocumentView struct {
	Revision int64           `json:"revision"`
	Document json.RawMessage `json:"document"`
}

func (s *Service) CloudAgentConversationDocument(userID, canvasID string) (AgentConversationDocumentView, error) {
	if userID == "" || canvasID == "" {
		return AgentConversationDocumentView{}, BadAuthRequest("缺少账号或画布 ID")
	}
	if _, err := s.repo.CanvasProjectMetadataForUser(userID, canvasID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return AgentConversationDocumentView{}, NotFound("画布不存在")
		}
		return AgentConversationDocumentView{}, err
	}
	stored, err := s.repo.AgentConversationDocument(userID, canvasID)
	if err != nil {
		return AgentConversationDocumentView{}, err
	}
	if stored == nil {
		return AgentConversationDocumentView{Revision: 0, Document: json.RawMessage(`{"version":1,"activeId":null,"conversations":[],"deletedIds":[]}`)}, nil
	}
	return AgentConversationDocumentView{Revision: stored.Revision, Document: json.RawMessage(stored.DocumentJSON)}, nil
}

func (s *Service) SaveCloudAgentConversationDocument(userID, canvasID string, expectedRevision int64, body json.RawMessage) (AgentConversationDocumentView, error) {
	if expectedRevision < 0 || len(body) == 0 || len(body) > 12<<20 {
		return AgentConversationDocumentView{}, BadAuthRequest("Agent 对话历史请求无效或过大")
	}
	var shape struct {
		Version       int               `json:"version"`
		Conversations []json.RawMessage `json:"conversations"`
		DeletedIDs    []string          `json:"deletedIds"`
	}
	if json.Unmarshal(body, &shape) != nil || shape.Version != 1 || shape.Conversations == nil || len(shape.Conversations) > 500 || len(shape.DeletedIDs) > 5000 {
		return AgentConversationDocumentView{}, BadAuthRequest("Agent 对话历史格式无效")
	}
	if _, err := s.CloudAgentConversationDocument(userID, canvasID); err != nil {
		return AgentConversationDocumentView{}, err
	}
	revision, err := s.repo.SaveAgentConversationDocument(userID, canvasID, expectedRevision, string(body))
	if errors.Is(err, repository.ErrTaskStateConflict) {
		return AgentConversationDocumentView{}, NewAppError(http.StatusConflict, "Agent 对话历史已在其他设备更新")
	}
	if err != nil {
		return AgentConversationDocumentView{}, err
	}
	return AgentConversationDocumentView{Revision: revision, Document: body}, nil
}
