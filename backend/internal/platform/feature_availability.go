package platform

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"yingce/backend/internal/kernel"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const featureAvailabilitySettingKey = "feature_availability"

const (
	FeatureShortDrama            = "shortDrama"
	FeatureTaskCenter            = "taskCenter"
	FeatureCredits               = "credits"
	FeatureTeams                 = "teams"
	FeatureCustomChannels        = "customChannels"
	FeatureFrontendModels        = "frontendModels"
	FeaturePluginCenter          = "pluginCenter"
	FeatureSystemPlugins         = "systemPluginsVisibleToUsers"
	FeatureInspirationSources    = "inspirationSourcesVisible"
	FeatureTimelineTranscription = "timelineTranscription"
	FeatureImageWorkbench        = "imageWorkbench"
	FeatureVideoWorkbench        = "videoWorkbench"
	FeatureEcommerce             = "ecommerce"
	FeatureEcommerceVideo        = "ecommerceVideo"
	FeatureSiteAssistant         = "siteAssistant"
)

type FeatureAvailability struct {
	TeamsEnabled                 bool            `json:"teamsEnabled"`
	WelcomeEnabled               bool            `json:"welcomeEnabled"`
	ShortDramaEnabled            bool            `json:"shortDramaEnabled"`
	TaskCenterEnabled            bool            `json:"taskCenterEnabled"`
	CreditsEnabled               bool            `json:"creditsEnabled"`
	CustomChannelsEnabled        bool            `json:"customChannelsEnabled"`
	FrontendModelsEnabled        bool            `json:"frontendModelsEnabled"`
	PluginCenterEnabled          bool            `json:"pluginCenterEnabled"`
	SystemPluginsVisibleToUsers  bool            `json:"systemPluginsVisibleToUsers"`
	InspirationSourcesVisible    bool            `json:"inspirationSourcesVisible"`
	TimelineTranscriptionEnabled bool            `json:"timelineTranscriptionEnabled"`
	ImageWorkbenchEnabled        bool            `json:"imageWorkbenchEnabled"`
	VideoWorkbenchEnabled        bool            `json:"videoWorkbenchEnabled"`
	EcommerceEnabled             bool            `json:"ecommerceEnabled"`
	EcommerceVideoEnabled        bool            `json:"ecommerceVideoEnabled"`
	SiteAssistantEnabled         bool            `json:"siteAssistantEnabled"`
	CanvasNodesEnabled           map[string]bool `json:"canvasNodesEnabled"`
	// 批量换装各功能（outfit、pose…）的开放状态；未登记视为开放，关闭后只有管理员可见、可用。
	EcommerceTryOnFunctions map[string]bool `json:"ecommerceTryOnFunctions"`
}

// TryOnFunctionEnabled 未登记的换装功能默认开放，新加功能无需迁移即可在后台管理。
func (f FeatureAvailability) TryOnFunctionEnabled(id string) bool {
	enabled, exists := f.EcommerceTryOnFunctions[id]
	return !exists || enabled
}

// Missing keys remain enabled so a newly registered canvas node is manageable
// immediately without a data migration. A false value applies to every role.
func (f FeatureAvailability) CanvasNodeEnabled(id string) bool {
	enabled, exists := f.CanvasNodesEnabled[id]
	return !exists || enabled
}

type PublicFeatureAvailability struct {
	FeatureAvailability
	Configured bool      `json:"configured"`
	UpdatedBy  string    `json:"updatedBy,omitempty"`
	UpdatedAt  time.Time `json:"updatedAt,omitempty"`
}

func DefaultFeatureAvailability() FeatureAvailability {
	// 缺少配置时沿用产品默认值。团队空间须由管理员明确开启。
	return FeatureAvailability{
		WelcomeEnabled:               true,
		ShortDramaEnabled:            true,
		TaskCenterEnabled:            true,
		CreditsEnabled:               true,
		TeamsEnabled:                 false,
		CustomChannelsEnabled:        true,
		FrontendModelsEnabled:        false,
		PluginCenterEnabled:          true,
		SystemPluginsVisibleToUsers:  true,
		InspirationSourcesVisible:    true,
		TimelineTranscriptionEnabled: true,
		ImageWorkbenchEnabled:        false,
		VideoWorkbenchEnabled:        false,
		EcommerceEnabled:             false,
		EcommerceVideoEnabled:        false,
		SiteAssistantEnabled:         false,
		CanvasNodesEnabled: map[string]bool{
			"image-remove-background":  true,
			"image-upscale":            true,
			"psd-layers":               true,
			"video-replace-background": true,
			"video-upscale":            true,
			"image-expand":             true,
		},
		EcommerceTryOnFunctions: map[string]bool{},
	}
}

func (s *Service) FeatureAvailability() (*PublicFeatureAvailability, error) {
	setting, value, err := s.readFeatureAvailability()
	if err != nil {
		return nil, err
	}
	return publicFeatureAvailability(setting, value), nil
}

func (s *Service) AdminFeatureAvailability(actor *model.User) (*PublicFeatureAvailability, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	return s.FeatureAvailability()
}

func (s *Service) UpdateFeatureAvailability(actor *model.User, value FeatureAvailability) (*PublicFeatureAvailability, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	current, before, err := s.readFeatureAvailability()
	if err != nil {
		return nil, err
	}
	if value.CanvasNodesEnabled == nil {
		value.CanvasNodesEnabled = before.CanvasNodesEnabled
	}
	if value.EcommerceTryOnFunctions == nil {
		value.EcommerceTryOnFunctions = before.EcommerceTryOnFunctions
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "feature_availability.update", "system_setting", featureAvailabilitySettingKey, "更新功能开放配置", map[string]any{"before": before, "after": value}); err != nil {
		return nil, err
	}
	return publicFeatureAvailability(&setting, value), nil
}

func (s *Service) FeatureEnabled(feature string) (bool, error) {
	_, value, err := s.readFeatureAvailability()
	if err != nil {
		return false, err
	}
	switch feature {
	case FeatureShortDrama:
		return value.ShortDramaEnabled, nil
	case FeatureTaskCenter:
		return value.TaskCenterEnabled, nil
	case FeatureCredits:
		return value.CreditsEnabled, nil
	case FeatureTeams:
		return value.TeamsEnabled, nil
	case FeatureCustomChannels:
		return value.CustomChannelsEnabled, nil
	case FeatureFrontendModels:
		return value.FrontendModelsEnabled, nil
	case FeaturePluginCenter:
		return value.PluginCenterEnabled, nil
	case FeatureSystemPlugins:
		return value.SystemPluginsVisibleToUsers, nil
	case FeatureInspirationSources:
		return value.InspirationSourcesVisible, nil
	case FeatureTimelineTranscription:
		return value.TimelineTranscriptionEnabled, nil
	case FeatureImageWorkbench:
		return value.ImageWorkbenchEnabled, nil
	case FeatureVideoWorkbench:
		return value.VideoWorkbenchEnabled, nil
	case FeatureEcommerce:
		return value.EcommerceEnabled, nil
	case FeatureEcommerceVideo:
		return value.EcommerceVideoEnabled, nil
	case FeatureSiteAssistant:
		return value.SiteAssistantEnabled, nil
	default:
		return false, errors.New("未知功能开放配置")
	}
}

// TryOnFunctionEnabled 读取单个批量换装功能的开放状态。
func (s *Service) TryOnFunctionEnabled(id string) (bool, error) {
	_, value, err := s.readFeatureAvailability()
	if err != nil {
		return false, err
	}
	return value.TryOnFunctionEnabled(id), nil
}

func (s *Service) RequireCanvasNode(id string) error {
	_, value, err := s.readFeatureAvailability()
	if err != nil {
		return err
	}
	if !value.CanvasNodeEnabled(id) {
		return kernel.Forbidden("该画布节点已由后台关闭")
	}
	return nil
}

func (s *Service) RequireFeature(feature string) error {
	enabled, err := s.FeatureEnabled(feature)
	if err != nil {
		return err
	}
	if enabled {
		return nil
	}
	switch feature {
	case FeatureShortDrama:
		return kernel.Forbidden("短剧创作暂未开放")
	case FeatureTaskCenter:
		return kernel.Forbidden("任务中心暂未开放")
	case FeatureCredits:
		return kernel.Forbidden("积分功能暂未开放")
	case FeatureTeams:
		err := kernel.Forbidden("团队空间暂未开放")
		err.Reason = "team_feature_disabled"
		return err
	case FeatureCustomChannels:
		return kernel.Forbidden("自定义渠道暂未开放")
	case FeatureFrontendModels:
		return kernel.Forbidden("前台模型目录暂未开放")
	case FeaturePluginCenter:
		return kernel.Forbidden("插件中心暂未开放")
	case FeatureSystemPlugins:
		return kernel.Forbidden("系统插件暂未向普通用户展示")
	case FeatureInspirationSources:
		return kernel.Forbidden("素材来源说明暂未开放")
	case FeatureTimelineTranscription:
		return kernel.Forbidden("字幕转写暂未开放")
	case FeatureImageWorkbench:
		return kernel.Forbidden("生图暂未开放")
	case FeatureVideoWorkbench:
		return kernel.Forbidden("视频暂未开放")
	case FeatureEcommerce:
		return kernel.Forbidden("电商创作暂未开放")
	case FeatureEcommerceVideo:
		return kernel.Forbidden("电商视频暂未开放")
	case FeatureSiteAssistant:
		return kernel.Forbidden("站内助手暂未开放")
	default:
		return kernel.Forbidden("该功能暂未开放")
	}
}

func (s *Service) readFeatureAvailability() (*model.SystemSetting, FeatureAvailability, error) {
	setting, err := s.repo.SystemSetting(featureAvailabilitySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, DefaultFeatureAvailability(), nil
	}
	if err != nil {
		return nil, FeatureAvailability{}, err
	}
	// 升级时缺少的字段沿用各自的产品默认值。
	value := DefaultFeatureAvailability()
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, FeatureAvailability{}, errors.New("功能开放配置格式无效")
	}
	if value.CanvasNodesEnabled == nil {
		value.CanvasNodesEnabled = DefaultFeatureAvailability().CanvasNodesEnabled
	}
	if value.EcommerceTryOnFunctions == nil {
		value.EcommerceTryOnFunctions = map[string]bool{}
	}
	// 电商 Agent、商品视频和小夜在加入开关前就已对外开放。已保存的配置里没有这些键时
	// 视为开启，升级不会让线上功能消失；全新安装（没有配置）仍按默认关闭。
	var present map[string]json.RawMessage
	if json.Unmarshal([]byte(setting.ValueJSON), &present) == nil {
		if _, ok := present["ecommerceEnabled"]; !ok {
			value.EcommerceEnabled = true
		}
		if _, ok := present["ecommerceVideoEnabled"]; !ok {
			value.EcommerceVideoEnabled = true
		}
		if _, ok := present["siteAssistantEnabled"]; !ok {
			value.SiteAssistantEnabled = true
		}
	}
	return setting, value, nil
}

func publicFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	result := &PublicFeatureAvailability{FeatureAvailability: value, Configured: setting != nil}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

// PublicFeatureAvailability projects the persisted feature flags without
// exposing the platform service internals to compatibility callers.
func ProjectFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	return publicFeatureAvailability(setting, value)
}
