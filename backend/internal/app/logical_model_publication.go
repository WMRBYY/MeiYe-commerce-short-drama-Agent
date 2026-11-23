package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
)

func publicationScope(value string) string {
	if strings.TrimSpace(value) == "" {
		return "legacy"
	}
	return value
}

func decodePublicationAllowUserIDs(value string) []string {
	result := []string{}
	_ = json.Unmarshal([]byte(value), &result)
	if result == nil {
		return []string{}
	}
	return result
}

func normalizePublicationAllowUserIDs(values []string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, raw := range values {
		id := strings.TrimSpace(raw)
		if id == "" || len(id) > 120 {
			return nil, BadAuthRequest("灰度用户 ID 不能为空且不得超过 120 个字符")
		}
		if !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}
	if len(result) > 1000 {
		return nil, BadAuthRequest("单个模型的灰度用户不能超过 1000 个")
	}
	return result, nil
}

func (s *Service) publicationVisibleForUser(userID string, item model.LogicalModel) (bool, error) {
	if !item.Enabled || item.ArchivedAt != nil {
		return false, nil
	}
	policy, err := s.repo.SmartRoutePolicy(item.ID)
	if err != nil {
		return false, err
	}
	if policy != nil && policy.ArchivedAt != nil {
		return false, nil
	}
	switch publicationScope(item.PublicationScope) {
	case "all":
		return true, nil
	case "gray":
		for _, id := range decodePublicationAllowUserIDs(item.PublicationAllowUserIDsJSON) {
			if id == userID {
				return true, nil
			}
		}
		return false, nil
	case "legacy":
		return s.smartRouteAdmission(userID, item.ID)
	default:
		return false, nil
	}
}

func (s *Service) explicitPublicationForUser(userID, logicalModelID string) (visible bool, explicit bool, err error) {
	item, err := s.repo.LogicalModel(strings.TrimSpace(logicalModelID))
	if err != nil {
		return false, true, BadAuthRequest("所选前台模型不存在或已删除")
	}
	if publicationScope(item.PublicationScope) == "legacy" {
		return false, false, nil
	}
	visible, err = s.publicationVisibleForUser(userID, *item)
	return visible, true, err
}

func logicalModelVisibilityReason(item AdminLogicalModel) string {
	if item.Archived {
		return "已归档或删除，新任务不可选择"
	}
	if !item.Enabled {
		return "模型已停用，新任务不可选择"
	}
	if item.ConfigurationError != "" {
		return item.ConfigurationError
	}
	if item.AvailabilityError != "" {
		return item.AvailabilityError
	}
	if !item.Available {
		return "暂无可安全结算的供应线路"
	}
	switch item.PublicationScope {
	case "all":
		return "已全站发布；路由开关仅决定是否自动切换"
	case "gray":
		return "仅指定用户 ID 可见；路由开关仅决定是否自动切换"
	case "legacy":
		return "沿用旧路由灰度规则；普通用户可能不可见，请明确设置发布范围"
	case "off":
		return "已关闭发布，普通用户不可见"
	default:
		return "草稿，普通用户不可见"
	}
}
