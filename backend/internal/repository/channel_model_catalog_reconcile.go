package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// ReconcileChannelModelCatalog only disables models previously observed in a
// complete upstream catalog. A second missing observation must be at least four
// hours later; an empty or failed response must never reach this method.
func (r *Repository) ReconcileChannelModelCatalog(channelID string, available map[string]bool, now time.Time) ([]string, error) {
	disabled := make([]string, 0)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := r.lockSystemChannelForModelMutation(tx, channelID); err != nil {
			return err
		}
		var items []model.ChannelModel
		if err := tx.Where("channel_id = ? AND enabled = ?", channelID, true).Find(&items).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		ids := make([]string, 0, len(items))
		for _, item := range items {
			ids = append(ids, item.ID)
		}
		var tiers []model.ChannelModelPriceTier
		if err := tx.Where("channel_model_id IN ? AND enabled = ?", ids, true).Find(&tiers).Error; err != nil {
			return err
		}
		tierKeys := make(map[string][]string, len(items))
		for _, tier := range tiers {
			if key := catalogIdentity(tier.ProviderModelKey); key != "" {
				tierKeys[tier.ChannelModelID] = append(tierKeys[tier.ChannelModelID], key)
			}
		}
		for _, item := range items {
			keys := tierKeys[item.ID]
			if len(keys) == 0 {
				keys = []string{catalogIdentity(firstNonEmptyModelKey(item.ProviderModelKey, item.ModelKey))}
			}
			present := len(keys) > 0
			for _, key := range keys {
				if key == "" || !available[key] {
					present = false
					break
				}
			}
			if present {
				if err := tx.Model(&model.ChannelModel{}).Where("id = ? AND enabled = ?", item.ID, true).
					Updates(map[string]any{"upstream_last_seen_at": now, "upstream_last_checked_at": now, "upstream_missing_checks": 0, "upstream_removed_at": nil}).Error; err != nil {
					return err
				}
				continue
			}
			// Never infer removal for manually mapped IDs that this upstream has
			// never advertised. Their availability needs an explicit provider check.
			if item.UpstreamLastSeenAt == nil || item.UpstreamLastCheckedAt != nil && now.Sub(*item.UpstreamLastCheckedAt) < 4*time.Hour {
				continue
			}
			missingChecks := item.UpstreamMissingChecks + 1
			updates := map[string]any{"upstream_last_checked_at": now, "upstream_missing_checks": missingChecks}
			if missingChecks >= 2 {
				updates["enabled"] = false
				updates["upstream_removed_at"] = now
				updates["price_version"] = gorm.Expr("price_version + 1")
			}
			result := tx.Model(&model.ChannelModel{}).Where("id = ? AND enabled = ?", item.ID, true).Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if missingChecks >= 2 && result.RowsAffected > 0 {
				disabled = append(disabled, item.ID)
			}
		}
		if len(disabled) > 0 {
			return refreshChannelModelNames(tx, channelID, now)
		}
		return nil
	})
	return disabled, err
}

func catalogIdentity(value string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "models/"))
}

func firstNonEmptyModelKey(primary, fallback string) string {
	if strings.TrimSpace(primary) != "" {
		return primary
	}
	return fallback
}
