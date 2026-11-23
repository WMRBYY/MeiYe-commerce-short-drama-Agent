package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// The initial debit already has a consume entry. Only the difference is posted
// at settlement, so ledger totals never count the initial charge twice.
func directBillingAdjustment(tx *gorm.DB, order *model.BillingOrder, delta int64, note string) error {
	if delta == 0 {
		return nil
	}
	updated := billingAccountQuery(tx, *order).
		Updates(map[string]any{"available_microcredits": gorm.Expr("available_microcredits + ?", delta), "version": gorm.Expr("version + 1"), "updated_at": time.Now()})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return errors.New("credit account does not exist")
	}
	var account model.CreditAccount
	if err := billingAccountQuery(tx, *order).First(&account).Error; err != nil {
		return err
	}
	kind := model.CreditLedgerRefund
	if delta < 0 {
		kind = model.CreditLedgerConsume
	}
	return tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: kind,
		AccountID: order.BillingAccountID, TeamID: order.TeamID, MembershipID: order.MembershipID,
		AmountMicrocredits: delta, AvailableDeltaMicrocredits: delta,
		AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
		BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: note}).Error
}

func settleDirectBillingOrder(tx *gorm.DB, order *model.BillingOrder, requestID string, durationMs *int64) error {
	actual := order.AmountMicrocredits
	updates := map[string]any{}
	if order.BillingMode == "token" && !zeroPricedTokenOrder(*order) {
		usage, source, err := tokenSettlementUsage(tx, *order)
		if err != nil {
			return err
		}
		var priceRule int
		actual, priceRule, err = tokenUsageAmount(*order, usage)
		if err != nil {
			return err
		}
		updates["input_tokens"], updates["output_tokens"], updates["cached_tokens"] = usage.InputTokens, usage.OutputTokens, usage.CachedTokens
		updates["cache_write_tokens"] = usage.CacheWriteTokens
		updates["usage_source"], updates["usage_available"] = source, source == billingUsageSourceProvider
		updates["token_price_rule"] = priceRule
	} else if order.BillingMode == "per_second" && (order.Capability == "audio" || (order.Capability == "video" && durationMs != nil)) {
		if durationMs == nil || *durationMs <= 0 {
			return errors.New("实际时长不可用")
		}
		quantity := (*durationMs + 999) / 1000
		if order.Capability == "video" && order.ReferenceVideoBilled {
			// 与预留一致：开启参考视频计费的按秒订单 = 输出秒数 + 后端实测的参考视频秒数。
			quantity += (order.ReferenceVideoMillis + 999) / 1000
		}
		var err error
		actual, err = audioBillingAmount(order.UnitPriceMicrocredits, quantity, order.MultiplierBasisPoints)
		if err != nil {
			return err
		}
		updates["quantity"] = quantity
		if order.CostBillingMode == "per_second" {
			updates["cost_quantity"] = quantity
		}
	}
	updates["uncapped_amount_microcredits"] = actual
	if billingChargeLimitApplies(*order) && actual > order.ChargeLimitMicrocredits {
		actual = order.ChargeLimitMicrocredits
	}
	if err := validateBillingChargeLimit(*order, actual); err != nil {
		return err
	}
	if err := directBillingAdjustment(tx, order, order.AmountMicrocredits-actual, "按实际用量结算差额"); err != nil {
		return err
	}
	now := time.Now()
	updates["status"], updates["settled_at"], updates["updated_at"] = model.BillingStatusSettled, now, now
	updates["actual_amount_microcredits"] = actual
	updates["refunded_amount_microcredits"] = max(order.AmountMicrocredits-actual, int64(0))
	if requestID != "" {
		updates["provider_request_id"] = requestID
	}
	return updateBillingOrderState(tx, *order, updates)
}
