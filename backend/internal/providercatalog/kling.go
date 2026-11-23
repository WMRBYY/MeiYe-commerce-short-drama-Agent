package providercatalog

import (
	"encoding/json"
	"time"
)

const KlingProviderID = "kling-official"
const KlingSaleMicrocredits int64 = 50 * MicrocreditsPerYuan

// BundledKling is locally owned; the remote catalog cannot redirect its credentials.
func BundledKling() Provider {
	config := json.RawMessage(`{"version":1,"video":{"references":{"promptMaxChars":3072,"minImages":0,"maxImages":2,"maxVideos":0,"maxAudios":0},"duration":{"selection":"range","min":3,"max":15,"step":1,"default":5},"ratios":["16:9","9:16","1:1"],"defaultRatio":"16:9","resolutions":["720p","1080p","4k"],"defaultResolution":"720p","generateAudio":{"supported":true,"default":false},"watermark":{"supported":false,"default":false},"operations":["text_to_video","image_to_video"],"defaultOperation":"text_to_video"}}`)
	return Provider{
		ID: KlingProviderID, Name: "可灵官方", Tags: []string{"video", "official"}, Summary: "可灵官方文生视频与首尾帧图生视频", Website: "https://klingai.com/dev/api-key", Permanent: true, StartsAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		Connection: Connection{BaseURL: "https://api-beijing.klingai.com"},
		KeyGuide:   KeyGuide{URL: "https://klingai.com/dev/api-key", Steps: []string{"登录可灵国内开发者平台，创建新版 API Key（北京区）", "粘贴 API Key 本身，不含 Bearer；旧版 AK/SK 不适用", "确保 API 套餐有余额并已开通模型权限"}},
		Models:     []Model{{ModelKey: "kling-3.0", ProviderModelKey: "kling-3.0", DisplayName: "可灵 3.0", Capability: "video", Protocol: KlingProviderID, Description: "3–15 秒；720p / 1080p / 4k；默认售价 50 积分/秒，接入后可修改；上游成本未配置", CapabilityConfig: config, PriceTiers: []PriceTier{{BillingMode: "per_second"}}}},
	}
}

func WithBundled(remote *Catalog) *Catalog {
	result := &Catalog{SchemaVersion: SchemaVersion}
	if remote != nil {
		*result = *remote
	}
	result.Tags = append([]Tag{}, result.Tags...)
	for _, tag := range []Tag{
		{ID: "video", Label: "视频", Tone: "blue"},
		{ID: "official", Label: "官方", Tone: "green"},
		{ID: "image", Label: "生图", Tone: "cyan"},
		{ID: "text", Label: "文本", Tone: "blue"},
	} {
		found := false
		for _, existing := range result.Tags {
			if existing.ID == tag.ID {
				found = true
			}
		}
		if !found {
			result.Tags = append(result.Tags, tag)
		}
	}
	result.Providers = []Provider{BundledKling(), BundledQianwen()}
	if remote != nil {
		for _, provider := range remote.Providers {
			if provider.ID != KlingProviderID && provider.ID != QianwenProviderID {
				result.Providers = append(result.Providers, provider)
			}
		}
	}
	return result
}
