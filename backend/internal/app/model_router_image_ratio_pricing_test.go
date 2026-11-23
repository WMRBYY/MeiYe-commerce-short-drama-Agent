package app

import (
	"fmt"
	"testing"

	"yingce/backend/internal/model"
)

func TestAspectRatioImageQualitySelectsSameResolutionAsProvider(t *testing.T) {
	item := model.ChannelModel{
		Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage,
		CapabilityConfigJSON: `{"image":{"size":{"parameter":"aspect_ratio"},"quality":{"supported":true}}}`,
	}
	for _, resolution := range []string{"1k", "2k", "4k"} {
		selector := fmt.Sprintf(`{"resolution":%q}`, resolution)
		item.PriceTiers = append(item.PriceTiers, model.ChannelModelPriceTier{
			ID: resolution, SelectorJSON: selector, Enabled: true, PriceConfigured: true,
		})
	}
	for _, test := range []struct {
		name, quality, size, want string
	}{
		{"default", "auto", "1:1", "1k"},
		{"low", "low", "16:9", "1k"},
		{"medium", "medium", "16:9", "2k"},
		{"high", "high", "16:9", "4k"},
		{"pixel overrides quality", "low", "2048x2048", "2k"},
	} {
		t.Run(test.name, func(t *testing.T) {
			intent := ModelRequestIntent{Capability: "image", Options: map[string]any{"quality": test.quality, "size": test.size}}
			if got := channelModelPriceTierForIntent(item, intent); got == nil || got.ID != test.want {
				t.Fatalf("quality=%q size=%q: tier=%+v, want %s", test.quality, test.size, got, test.want)
			}
		})
	}
	item.CapabilityConfigJSON = `{"image":{"size":{"parameter":"size"},"quality":{"supported":true}}}`
	if got := channelModelPriceTierForIntent(item, ModelRequestIntent{Capability: "image", Options: map[string]any{"quality": "high", "size": "1:1"}}); got != nil {
		t.Fatalf("ordinary OpenAI quality must not imply a resolution tier: %+v", got)
	}
}
