package app

import "yingce/backend/internal/model"

type ShopClipCue struct {
	StartMs int64  `json:"startMs"`
	EndMs   int64  `json:"endMs"`
	Text    string `json:"text"`
}

type ShopClipPlacement struct {
	ResourceID    string `json:"resourceId"`
	StartMs       int64  `json:"startMs"`
	EndMs         int64  `json:"endMs"`
	SourceStartMs int64  `json:"sourceStartMs"`
	Reason        string `json:"reason,omitempty"`
}

type ShopClipPlan struct {
	PricingVersion   int                 `json:"pricingVersion,omitempty"`
	Credits          int64               `json:"credits"`
	AutoRender       bool                `json:"autoRender,omitempty"`
	ReferenceText    string              `json:"referenceText,omitempty"`
	Visual           ShopClipVisual      `json:"visual"`
	Director         *ShopClipDirection  `json:"director,omitempty"`
	TrimStartMs      int64               `json:"trimStartMs,omitempty"`
	TrimEndMs        int64               `json:"trimEndMs,omitempty"`
	SourceDurationMs int64               `json:"sourceDurationMs,omitempty"`
	MusicResourceID  string              `json:"musicResourceId,omitempty"`
	MusicVolume      float64             `json:"musicVolume"`
	Version          int                 `json:"version"`
	TemplateVersion  int                 `json:"templateVersion"`
	SourceResourceID string              `json:"sourceResourceId"`
	Materials        []string            `json:"materials"`
	Transcript       []ShopClipCue       `json:"transcript"`
	Placements       []ShopClipPlacement `json:"placements"`
	TemplateID       string              `json:"templateId"`
	Title            string              `json:"title"`
	BehindText       string              `json:"behindText"`
	BehindPosition   string              `json:"behindPosition,omitempty"`
	SubjectBox       []float64           `json:"subjectBox,omitempty"`
	Width            int                 `json:"width"`
	Height           int                 `json:"height"`
	DurationMs       int64               `json:"durationMs"`
}

type ShopClipCreateRequest struct {
	ProjectID           string         `json:"projectId,omitempty"`
	ExpectedCredits     *int64         `json:"expectedCredits,omitempty"`
	AutoRender          bool           `json:"autoRender,omitempty"`
	ReferenceText       string         `json:"referenceText,omitempty"`
	Visual              ShopClipVisual `json:"visual"`
	TrimStartMs         int64          `json:"trimStartMs,omitempty"`
	TrimEndMs           int64          `json:"trimEndMs,omitempty"`
	MusicResourceID     string         `json:"musicResourceId,omitempty"`
	MusicVolume         float64        `json:"musicVolume"`
	IdempotencyKey      string         `json:"idempotencyKey"`
	Mode                string         `json:"mode"`
	SourceResourceID    string         `json:"sourceResourceId"`
	MaterialResourceIDs []string       `json:"materialResourceIds"`
	TemplateID          string         `json:"templateId"`
	Title               string         `json:"title"`
	BehindText          string         `json:"behindText"`
	BehindPosition      string         `json:"behindPosition"`
	SubjectBox          []float64      `json:"subjectBox"`
}

type ShopClipAttemptRequest struct {
	ExpectedCredits *int64        `json:"expectedCredits,omitempty"`
	IdempotencyKey  string        `json:"idempotencyKey"`
	Plan            *ShopClipPlan `json:"plan,omitempty"`
}

type ShopClipView struct {
	model.ShopClipProject
	Plan       ShopClipPlan `json:"plan"`
	RetryStage string       `json:"retryStage"`
}

type ShopClipCapability struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason"`
}

type ShopClipTemplate struct {
	ID          string                  `json:"id"`
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	Group       string                  `json:"group"`
	Tags        []string                `json:"tags"`
	Modes       []string                `json:"modes"`
	Visual      ShopClipVisual          `json:"visual"`
	Preview     ShopClipTemplatePreview `json:"preview"`
}

type ShopClipVisual struct {
	SubtitleStyle string `json:"subtitleStyle,omitempty"`
	Animation     string `json:"animation,omitempty"`
	Filter        string `json:"filter,omitempty"`
	Transition    string `json:"transition,omitempty"`
	Widget        string `json:"widget,omitempty"`
	Layout        string `json:"layout,omitempty"`
}

type ShopClipTemplatePreview struct {
	Foreground string `json:"foreground"`
	Background string `json:"background"`
	Accent     string `json:"accent"`
	Font       string `json:"font"`
}

type ShopClipDirection struct {
	CaptionMaxChars int      `json:"captionMaxChars"`
	CategoryID      string   `json:"categoryId"`
	CategoryPath    string   `json:"categoryPath"`
	KnowledgeIDs    []string `json:"knowledgeIds"`
	KnowledgeDigest string   `json:"knowledgeDigest"`
	Summary         string   `json:"summary"`
	Evidence        []string `json:"evidence"`
}

type ShopClipCapabilities struct {
	AutoModes   map[string]ShopClipCapability `json:"autoModes"`
	Modes       map[string]ShopClipCapability `json:"modes"`
	RenderModes map[string]ShopClipCapability `json:"renderModes"`
	Templates   []ShopClipTemplate            `json:"templates"`
}
