// Copyright (c) 2026 meiyeai. MIT License.
package app

// Media references belong to the ordinary generation/clip workflow. No
// feature-specific settings or project schema are used by these limits.
const mediaReferenceMaxBytes int64 = 200 << 20
const mediaReferenceMaxSourceMs int64 = 10 * 60 * 1000

type MediaReferenceLinkInput struct {
	URL string `json:"url"`
}

func (s *Service) requireMediaReferenceAccess() error {
	if err := s.RequireFeature(FeatureVideoWorkbench); err == nil {
		return nil
	}
	return s.RequireFeature(FeatureEcommerceVideo)
}
