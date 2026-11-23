package model

import "time"

const (
	TaskTypeShopClipAnalysis = "shop_clip_analysis"
	TaskTypeShopClipRender   = "shop_clip_render"
)

// ShopClipProject stores the editable plan independently of a worker attempt.
type ShopClipProject struct {
	ID               string    `gorm:"primaryKey;size:64" json:"id"`
	UserID           string    `gorm:"size:64;not null;uniqueIndex:idx_shop_clip_request;index" json:"-"`
	RequestKey       string    `gorm:"size:128;not null;uniqueIndex:idx_shop_clip_request" json:"-"`
	RequestHash      string    `gorm:"size:64;not null" json:"-"`
	Mode             string    `gorm:"size:24;not null" json:"mode"`
	Title            string    `gorm:"size:400" json:"title"`
	Status           string    `gorm:"size:24;index" json:"status"`
	Stage            string    `gorm:"size:200" json:"stage"`
	Progress         int       `json:"progress"`
	Error            string    `gorm:"type:text" json:"error"`
	PlanJSON         string    `gorm:"type:text;not null" json:"-"`
	TaskID           string    `gorm:"size:64;index" json:"taskId"`
	AttemptKey       string    `gorm:"size:128" json:"-"`
	AttemptHash      string    `gorm:"size:64" json:"-"`
	AnalysisStep     string    `gorm:"size:32" json:"-"`
	OutputResourceID string    `gorm:"size:128;index" json:"outputResourceId"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type ShopClipResource struct {
	ProjectID  string `gorm:"primaryKey;size:64"`
	ResourceID string `gorm:"primaryKey;size:128;index"`
	UserID     string `gorm:"size:64;index"`
}

type ShopClipAttempt struct {
	ProjectID string `gorm:"primaryKey;size:64"`
	Key       string `gorm:"primaryKey;size:128"`
	UserID    string `gorm:"size:64;index"`
	Hash      string `gorm:"size:64"`
	TaskID    string `gorm:"size:64;uniqueIndex"`
	CreatedAt time.Time
}
