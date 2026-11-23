// Copyright (c) 2026 meiyeai. MIT License.
package app

import (
	"context"
	"time"
)

// Editing shares the ordinary ecommerce image recognition model. It does not
// read a separate private video-agent settings object or prompt corpus.
func (s *Service) shopClipTextConfig(userID string) (ecommerceProviderConfig, error) {
	settings, err := s.EcommerceAgentSetting()
	if err != nil {
		return ecommerceProviderConfig{}, err
	}
	return s.ecommerceConfiguredTextFor(userID, ecommerceProviderConfig{Mode: "live", TextTimeout: 240 * time.Second}, settings.visionRef(), "剪辑素材理解")
}

func (s *Service) shopClipChatJSON(ctx context.Context, cfg ecommerceProviderConfig, stage, projectID, system, prompt string, images, videos []string, out any) error {
	return s.ecommerceMultimodalJSON(ctx, cfg, projectID+":"+stage, system, prompt, images, videos, out)
}
