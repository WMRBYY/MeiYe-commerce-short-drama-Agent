package app

import (
	"fmt"

	"yingce/backend/internal/protocol"
)

func validateMediaVisionProtocol(cfg ecommerceProviderConfig, registries ...*protocol.Registry) error {
	if cfg.TextProvider == nil {
		return fmt.Errorf("当前模型无法分析完整参考视频，请在后台选择支持视频输入的 Gemini 多模态模型或 Qwen3.8-Omni-Flash")
	}
	p := cfg.TextProvider
	declared := p.CapabilityConfig != nil && p.CapabilityConfig.Text != nil && p.CapabilityConfig.Text.References.MaxVideos > 0
	native := p.InterfaceType == "gemini-generate-content" || p.InterfaceType == "gemini-multimodal-text" || p.InterfaceType == "vertex-gemini"
	if !native && !declared && !usesInlineMediaProtocol(cfg) && !qwenOmniChatVideo(*p) {
		return fmt.Errorf("当前模型未声明视频理解能力，请在后台选择支持完整视频输入的模型")
	}
	if len(registries) > 0 {
		adapter, ok := registries[0].Resolve(p.InterfaceType)
		if !ok || !adapter.Metadata().Enabled {
			return fmt.Errorf("视频理解协议 %s 未安装或未启用，请在后台配置可用插件", p.InterfaceType)
		}
	}
	return nil
}
