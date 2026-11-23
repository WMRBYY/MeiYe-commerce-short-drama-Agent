package model

import "time"

// YoruDailyQuota reserves the worst-case charge before a billable task exists.
type YoruDailyQuota struct {
	UserID               string `gorm:"primaryKey;size:36"`
	Day                  string `gorm:"primaryKey;size:10"`
	CallCount            int    `gorm:"not null"`
	ReservedMicrocredits int64  `gorm:"not null"`
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

func (YoruDailyQuota) TableName() string { return "yoru_daily_quotas" }
