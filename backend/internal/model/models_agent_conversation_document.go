package model

import "time"

// AgentConversationDocument is the account-owned history index for one canvas.
// Agent execution and billing remain in their existing durable tables.
type AgentConversationDocument struct {
	UserID       string `gorm:"primaryKey;size:36"`
	CanvasID     string `gorm:"primaryKey;size:80"`
	Revision     int64  `gorm:"not null"`
	DocumentJSON string `gorm:"type:text;not null"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
