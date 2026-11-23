package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (s *Service) taskSubmissionReceipt(userID string, req CreateTaskRequest) (string, string, *model.Task, error) {
	key := strings.TrimSpace(req.ClientSubmissionID)
	if key == "" {
		return "", "", nil, nil
	}
	if len(key) > 200 || len(key) < 8 {
		return "", "", nil, BadAuthRequest("提交编号无效")
	}
	if req.admission != nil || req.creationPrepare != nil {
		return "", "", nil, BadAuthRequest("内部任务不接受外部提交编号")
	}
	idHash := sha256.Sum256([]byte(userID + ":" + key))
	id := "ci-" + hex.EncodeToString(idHash[:16])
	digest := req.submissionFingerprint
	if digest == "" {
		raw, err := json.Marshal(req)
		if err != nil {
			return "", "", nil, err
		}
		requestHash := sha256.Sum256(raw)
		digest = hex.EncodeToString(requestHash[:])
	}
	task, err := s.repo.TaskForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return id, digest, nil, nil
	}
	if err != nil {
		return "", "", nil, err
	}
	var input map[string]any
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
		return "", "", nil, creationConflict("提交回执损坏")
	}
	metadata, _ := input["metadata"].(map[string]any)
	if metadata["clientSubmissionHash"] != digest {
		return "", "", nil, creationConflict("相同提交编号不能用于不同请求")
	}
	return id, digest, taskForOutput(*task), nil
}
