package repository

import (
	"gorm.io/gorm"
	"time"
	"yingce/backend/internal/model"
)

// A single conditional upsert enforces the limit across backend replicas.
func (r *Repository) ReserveYoruQuota(userID string, now time.Time, maxCalls int, maxDaily int64, perCall int64) (bool, error) {
	if maxCalls <= 0 || maxDaily <= 0 || perCall <= 0 || perCall > maxDaily {
		return false, nil
	}
	day := now.UTC().Format("2006-01-02")
	stamp := now.UTC()
	result := r.db.Exec(`INSERT INTO yoru_daily_quotas (user_id, day, call_count, reserved_microcredits, created_at, updated_at)
	VALUES (?, ?, 1, ?, ?, ?)
	ON CONFLICT (user_id, day) DO UPDATE SET
	call_count = yoru_daily_quotas.call_count + 1,
	reserved_microcredits = yoru_daily_quotas.reserved_microcredits + ?,
	updated_at = ?
	WHERE yoru_daily_quotas.call_count < ? AND yoru_daily_quotas.reserved_microcredits <= ?`, userID, day, perCall, stamp, stamp, perCall, stamp, maxCalls, maxDaily-perCall)
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) ReleaseYoruQuota(userID string, now time.Time, perCall int64) error {
	return r.db.Model(&model.YoruDailyQuota{}).Where("user_id = ? AND day = ? AND call_count > 0 AND reserved_microcredits >= ?", userID, now.UTC().Format("2006-01-02"), perCall).
		Updates(map[string]any{"call_count": gorm.Expr("call_count - 1"), "reserved_microcredits": gorm.Expr("reserved_microcredits - ?", perCall)}).Error
}
