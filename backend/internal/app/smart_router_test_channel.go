package app

import (
	"encoding/json"
	"strings"
)

// Test-only system channels participate in Ww_ route groups but never appear
// as standalone models or accept direct relay calls. The IDs are configured
// through a system setting so production providers are unaffected.
const smartRouterTestChannelsSettingKey = "smart_router_test_channels"

func (s *Service) smartRouterTestChannels() (map[string]bool, error) {
	if s == nil || s.repo == nil {
		return map[string]bool{}, nil
	}
	setting, err := s.repo.SystemSettingOptional(smartRouterTestChannelsSettingKey)
	if err != nil {
		return nil, err
	}
	result := map[string]bool{}
	if setting == nil || strings.TrimSpace(setting.ValueJSON) == "" {
		return result, nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(setting.ValueJSON), &ids); err != nil {
		return nil, err
	}
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			result[id] = true
		}
	}
	return result, nil
}

func (s *Service) IsSmartRouterTestChannel(channelID string) (bool, error) {
	channels, err := s.smartRouterTestChannels()
	return channels[strings.TrimSpace(channelID)], err
}
