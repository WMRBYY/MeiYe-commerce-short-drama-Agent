package model

import "time"

// CanvasTemplateStatus 是用户投稿模版的审核状态。
type CanvasTemplateStatus string

const (
	CanvasTemplateStatusPending  CanvasTemplateStatus = "pending"
	CanvasTemplateStatusApproved CanvasTemplateStatus = "approved"
	CanvasTemplateStatusRejected CanvasTemplateStatus = "rejected"
	CanvasTemplateStatusOffline  CanvasTemplateStatus = "offline"
)

// CanvasTemplate 是用户投稿的画布模版：投稿时冻结的画布正文、成片视频和封面。
// 正文只保存结构，媒体仍在 Resource 中；可公开访问的资源范围由 CanvasTemplateResource 限定。
type CanvasTemplate struct {
	ID              string               `json:"id" gorm:"primaryKey;size:36"`
	UserID          string               `json:"userId" gorm:"size:36;not null;index:idx_canvas_templates_user_created,priority:1"`
	CanvasID        string               `json:"canvasId" gorm:"size:80;not null;index"`
	Title           string               `json:"title" gorm:"size:160;not null"`
	Description     string               `json:"description" gorm:"size:2000"`
	Category        string               `json:"category" gorm:"size:32;not null;index"`
	TagsJSON        string               `json:"-" gorm:"size:1000"`
	VideoResourceID string               `json:"-" gorm:"size:36;not null"`
	CoverResourceID string               `json:"-" gorm:"size:36;not null"`
	VideoDurationMs int64                `json:"videoDurationMs"`
	VideoWidth      int                  `json:"videoWidth"`
	VideoHeight     int                  `json:"videoHeight"`
	VideoBytes      int64                `json:"videoBytes"`
	AllowDownload   bool                 `json:"allowDownload" gorm:"not null;default:false"`
	PayloadJSON     string               `json:"-" gorm:"type:text;not null"`
	NodeCount       int                  `json:"nodeCount"`
	ConnectionCount int                  `json:"connectionCount"`
	Status          CanvasTemplateStatus `json:"status" gorm:"size:16;not null;index:idx_canvas_templates_status_published,priority:1"`
	ReviewNote      string               `json:"reviewNote" gorm:"size:500"`
	ReviewedBy      string               `json:"-" gorm:"size:36"`
	ReviewedAt      *time.Time           `json:"reviewedAt"`
	PublishedAt     *time.Time           `json:"publishedAt" gorm:"index:idx_canvas_templates_status_published,priority:2"`
	LikeCount       int64                `json:"likeCount" gorm:"not null;default:0"`
	ReportCount     int64                `json:"reportCount" gorm:"not null;default:0"`
	CreatedAt       time.Time            `json:"createdAt" gorm:"index:idx_canvas_templates_user_created,priority:2"`
	UpdatedAt       time.Time            `json:"updatedAt"`
}

// CanvasTemplateResource 记录模版可公开的资源。不加外键：素材删除流程不感知模版，
// 资源被作者删除后对应媒体自然不可访问，不阻塞删除。
type CanvasTemplateResource struct {
	TemplateID string `json:"-" gorm:"primaryKey;size:36"`
	ResourceID string `json:"-" gorm:"primaryKey;size:36;index"`
}

type CanvasTemplateLike struct {
	TemplateID string    `json:"-" gorm:"primaryKey;size:36"`
	UserID     string    `json:"-" gorm:"primaryKey;size:36;index"`
	CreatedAt  time.Time `json:"createdAt" gorm:"not null"`
}

type CanvasTemplateReport struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	TemplateID string    `json:"templateId" gorm:"size:36;not null;uniqueIndex:idx_canvas_template_reports_user,priority:1"`
	UserID     string    `json:"userId" gorm:"size:36;not null;uniqueIndex:idx_canvas_template_reports_user,priority:2"`
	Reason     string    `json:"reason" gorm:"size:32;not null"`
	Detail     string    `json:"detail" gorm:"size:500"`
	CreatedAt  time.Time `json:"createdAt" gorm:"not null;index"`
}

// UserFollow 是用户之间的关注关系。
type UserFollow struct {
	FollowerID string    `json:"-" gorm:"primaryKey;size:36"`
	FolloweeID string    `json:"-" gorm:"primaryKey;size:36;index"`
	CreatedAt  time.Time `json:"createdAt" gorm:"not null"`
}
