package app

var inlineMediaProtocols = map[string]bool{
	"apimart-gemini-video-text": true,
	"openai-gemini-multimodal":  true,
}

func usesInlineMediaProtocol(cfg ecommerceProviderConfig) bool {
	return cfg.TextProvider != nil && inlineMediaProtocols[cfg.TextProvider.InterfaceType]
}
