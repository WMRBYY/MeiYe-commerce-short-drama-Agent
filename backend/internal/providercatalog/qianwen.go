package providercatalog

import (
	"encoding/json"
	"fmt"
	"time"
)

const QianwenProviderID = "qianwen-official"

// BundledQianwen pins the credential destination to the official metered gateway.
func BundledQianwen() Provider {
	return Provider{
		ID: QianwenProviderID, Name: "阿里云千问官方 · 按量付费", Tags: []string{"official", "text", "image", "video"},
		Summary:  "千问、DeepSeek、GLM、万相和 HappyHorse，使用千问平台按量付费 API Key",
		Website:  "https://platform.qianwenai.com/docs/api-reference/preparation/api-key",
		StartsAt: time.Date(2026, 11, 13, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60)), Permanent: true,
		Connection: Connection{BaseURL: "https://service-61a5b3b3.example.invalid/compatible-mode/v1"},
		KeyGuide: KeyGuide{
			URL: "https://platform.qianwenai.com/docs/api-reference/preparation/api-key",
			Steps: []string{
				"在千问 AI 平台的 API Keys 页面创建按量付费 API Key",
				"粘贴完整 Key，验证后选择要接入的模型",
				"按量调用单独计费，Token Plan 套餐 Key 无法用于此渠道",
			},
		},
		Models: []Model{
			qianwenText("qwen3.8-max", 1_000_000, 131072, 100, 64, 12, 36, 1.5),
			qianwenText("qwen3.8-flash", 1_000_000, 131072, 100, 64, 0.8, 2.7, 0.1),
			qianwenText("qwen3.7-plus", 1_000_000, 131072, 100, 64, 6, 24, 1.2),
			qianwenText("qwen3.7-max", 1_000_000, 131072, 0, 0, 12, 36, 2.4),
			qianwenText("qwen3.6-flash", 1_000_000, 65536, 100, 64, 4.8, 28.8, 0.48),
			qianwenText("deepseek-v4.1-flash-1017", 1_000_000, 393216, 1, 0, 2, 8, 0.04),
			qianwenText("deepseek-v4.1-flash", 1_000_000, 393216, 1, 0, 2, 8, 0.04),
			qianwenText("deepseek-v4-pro-0813", 1_000_000, 393216, 0, 0, 9, 27, 0.9),
			qianwenText("deepseek-v4-pro", 1_000_000, 393216, 0, 0, 12, 24, 1),
			qianwenText("deepseek-v4-flash-0731", 1_000_000, 393216, 0, 0, 3, 9, 0.3),
			qianwenText("glm-5.3", 1048576, 131072, 0, 0, 8, 28, 2),
			qianwenText("glm-5.2", 1048576, 131072, 0, 0, 8, 28, 2),
			qianwenImage("wan2.7-image", 0.2),
			qianwenImage("wan2.7-image-pro", 0.5),
			qianwenHappyHorse("happyhorse-1.1-t2v", "text_to_video", 0, 0, true),
			qianwenHappyHorse("happyhorse-1.1-i2v", "image_to_video", 1, 1, false),
			qianwenHappyHorse("happyhorse-1.1-r2v", "reference_to_video", 1, 9, true),
		},
	}
}

// The channel catalog currently represents one rate per text model. Use the
// highest public tier for tiered or peak/off-peak rates so the preset is usable
// at any hour and context length.
func qianwenText(id string, contextWindow, maxOutput, images, videos int, input, output, cached float64) Model {
	description := "文本"
	if images > 0 {
		description = "文本、图片理解"
	}
	if videos > 0 {
		description += "和视频理解"
	}
	transport := ""
	if videos > 0 {
		transport = `"mediaTransport":{"image":"url","video":"url"},`
	}
	return Model{
		ModelKey: id, ProviderModelKey: id, DisplayName: id, Capability: "text", Protocol: "chat-completion", Description: description,
		CapabilityConfig: json.RawMessage(fmt.Sprintf(`{"version":1,%s"text":{"contextWindowTokens":%d,"maxOutputTokens":%d,"references":{"promptMaxChars":32000,"maxImages":%d,"maxImageBytes":20000000,"maxVideos":%d,"maxVideoBytes":2000000000}}}`,
			transport, contextWindow, maxOutput, images, videos)),
		PriceTiers: []PriceTier{{BillingMode: "token", InputPerMillion: input, OutputPerMillion: output, CachedPerMillion: cached}},
	}
}

func qianwenImage(id string, cost float64) Model {
	return Model{
		ModelKey: id, ProviderModelKey: id, DisplayName: id, Capability: "image", Protocol: "dashscope-qwen-image",
		Description:      "文生图、图像编辑，最多 9 张参考图；预设提供常用尺寸",
		CapabilityConfig: json.RawMessage(`{"version":1,"image":{"references":{"promptMaxChars":5000,"maxImages":9,"maxImageBytes":20000000},"size":{"parameter":"size","values":["1:1","3:4","4:3","2:3","3:2","9:16","16:9"],"default":"1:1"},"maxOutputs":1}}`),
		PriceTiers:       []PriceTier{{BillingMode: "fixed_request", Cost: cost}},
	}
}

func qianwenHappyHorse(id, operation string, minImages, maxImages int, ratioSupported bool) Model {
	ratios := ""
	if ratioSupported {
		ratios = `"ratios":["16:9","9:16","1:1","4:3","3:4"],"defaultRatio":"16:9",`
	}
	return Model{
		ModelKey: id, ProviderModelKey: id, DisplayName: id, Capability: "video", Protocol: "qianwenai-happyhorse-video",
		Description: "HappyHorse 1.1，3–15 秒；480p、720p 或 1080p",
		CapabilityConfig: json.RawMessage(fmt.Sprintf(`{"version":1,"video":{"references":{"promptMaxChars":2500,"minImages":%d,"maxImages":%d,"maxImageBytes":20000000},"duration":{"selection":"range","min":3,"max":15,"step":1,"default":5},%s"resolutions":["480p","720p","1080p"],"defaultResolution":"720p","operations":[%q],"defaultOperation":%q,"watermark":{"supported":true,"default":true}}}`,
			minImages, maxImages, ratios, operation, operation)),
		PriceTiers: []PriceTier{
			{Selector: map[string]string{"vquality": "480p"}, BillingMode: "per_second", Cost: 0.45},
			{Selector: map[string]string{"vquality": "720p"}, BillingMode: "per_second", Cost: 0.9},
			{Selector: map[string]string{"vquality": "1080p"}, BillingMode: "per_second", Cost: 1.2},
		},
	}
}
