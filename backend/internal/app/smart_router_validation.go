package app

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"yingce/backend/internal/model"
)

// validateSmartRouteCandidates runs on both policy and route-group saves. A
// disabled policy may be staged, but an enabled policy must never publish a
// candidate that the dispatcher cannot price or safely allocate.
func (s *Service) validateSmartRouteCandidates(group *model.LogicalModel, routes []model.LogicalModelRoute, req SmartRoutePolicyRequest) error {
	if group == nil || !req.Enabled {
		return nil
	}
	if !group.Enabled {
		return BadAuthRequest("请先启用路由组对应的前台模型")
	}
	if group.Capability == "video" {
		return BadAuthRequest("视频异步查单与重复生成保护尚未通过生产验收，不能开启视频智能路由")
	}
	if req.MaxUpstreamCostMicrocredits <= 0 {
		return BadAuthRequest("启用智能路由前必须设置大于 0 的上游总成本上限")
	}
	ordered := append([]model.LogicalModelRoute(nil), routes...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Priority > ordered[j].Priority })
	ids := make([]string, 0, len(ordered))
	for _, route := range ordered {
		if route.Enabled && route.Weight > 0 {
			ids = append(ids, route.ChannelModelID)
		}
	}
	if len(ids) == 0 {
		return BadAuthRequest("启用智能路由前至少需要一条已启用的供应线路")
	}
	models, err := s.repo.ChannelModelsByIDs(ids)
	if err != nil {
		return err
	}
	byID := make(map[string]model.ChannelModel, len(models))
	channelIDs := make([]string, 0, len(models))
	for _, item := range models {
		byID[item.ID] = item
		channelIDs = append(channelIDs, item.ChannelID)
	}
	channels, err := s.repo.SystemChannelsByIDs(channelIDs, false)
	if err != nil {
		return err
	}
	channelEnabled := make(map[string]bool, len(channels))
	for _, channel := range channels {
		channelEnabled[channel.ID] = true
	}
	active := make([]model.ChannelModel, 0, len(ids))
	maxFixedAttemptCost := int64(0)
	allFixedCost := true
	allowed := make(map[string]bool, len(req.CompatibleChannelModelIDs))
	for _, id := range req.CompatibleChannelModelIDs {
		allowed[id] = true
	}
	for _, id := range ids {
		item, ok := byID[id]
		if !ok || !item.Enabled || !channelEnabled[item.ChannelID] || item.UpstreamRemovedAt != nil {
			return BadAuthRequest("启用的供应线路包含已停用或上游已移除的渠道模型，请先调整候选")
		}
		if normalizeCapability(item.Capability) != normalizeCapability(group.Capability) {
			return BadAuthRequest("供应线路能力类型与路由组不一致")
		}
		if len(item.PriceTiers) == 0 {
			return BadAuthRequest("供应线路缺少可结算价格档")
		}
		hasActiveTier := false
		for _, tier := range item.PriceTiers {
			if !tier.Enabled || (group.PricePolicy == "channel" && !tier.PriceConfigured) {
				continue
			}
			hasActiveTier = true
			if !tier.CostPricing.Configured {
				return BadAuthRequest("供应线路存在未配置上游成本的可售规格，请先补全成本")
			}
			if tier.BillingMode == "fixed_request" {
				maxFixedAttemptCost = max(maxFixedAttemptCost, tier.CostPricing.UnitPriceMicrocredits)
			} else {
				allFixedCost = false
			}
		}
		if !hasActiveTier {
			return BadAuthRequest("供应线路缺少已启用且可结算的价格档")
		}
		active = append(active, item)
	}
	if req.MaxAttempts > len(active) {
		return BadAuthRequest(fmt.Sprintf("最多尝试 %d 次，但当前只有 %d 个已启用且可用的候选；每条线路最多提交一次", req.MaxAttempts, len(active)))
	}
	if allFixedCost && maxFixedAttemptCost > 0 && maxFixedAttemptCost > math.MaxInt64/int64(req.MaxAttempts) {
		return BadAuthRequest("候选上游成本超出可表示范围")
	}
	if allFixedCost && maxFixedAttemptCost*int64(req.MaxAttempts) > req.MaxUpstreamCostMicrocredits {
		return BadAuthRequest(fmt.Sprintf("上游总成本上限低于候选所需预算；按 %d 次尝试至少需要 %.4f 积分", req.MaxAttempts, float64(maxFixedAttemptCost*int64(req.MaxAttempts))/1_000_000))
	}
	for id := range allowed {
		if group.Capability != "image" {
			return BadAuthRequest("当前仅图片路由支持显式兼容模型")
		}
		found := false
		for _, item := range active {
			if item.ID == id {
				found = true
				break
			}
		}
		if !found {
			return BadAuthRequest("显式兼容模型必须是已启用且可用的图片候选")
		}
	}
	if !req.FailoverEnabled {
		return nil
	}
	if len(active) < 2 {
		return BadAuthRequest("自动切换需要至少 2 个已启用且可用的渠道候选")
	}
	if req.MaxAttempts < 2 {
		return BadAuthRequest("当前最多尝试 1 次，无法进行备用切换；请设为至少 2 次或关闭自动切换")
	}
	primary := active[0]
	primaryKey := firstNonEmpty(primary.ProviderModelKey, primary.ModelKey)
	var primarySpec CapabilitySpec
	if group.Capability == "image" && len(allowed) > 0 {
		primarySpec, err = channelModelCapabilitySpec(primary)
		if err != nil {
			return BadAuthRequest("首选图片模型能力配置无法核实，不能开启兼容模型切换")
		}
	}
	compatibleBackup := false
	for _, item := range active[1:] {
		key := firstNonEmpty(item.ProviderModelKey, item.ModelKey)
		if group.Capability == "image" && allowed[item.ID] && !strings.EqualFold(primaryKey, key) {
			backupSpec, specErr := channelModelCapabilitySpec(item)
			if specErr != nil || validateProductSpecWithinRoutes(primarySpec, []CapabilitySpec{backupSpec}) != nil {
				return BadAuthRequest("兼容图片候选不能完整覆盖首选模型的参考图、尺寸或参数能力，请先收窄能力范围")
			}
		}
		if strings.EqualFold(primaryKey, key) || (group.Capability == "image" && allowed[item.ID]) {
			compatibleBackup = true
		}
	}
	if !compatibleBackup {
		return BadAuthRequest("首选线路没有同模型备用；跨图片模型必须先显式允许兼容候选")
	}
	if group.Capability == "text" {
		var base *model.ChannelModel
		for index := range active {
			item := &active[index]
			if !strings.EqualFold(primaryKey, firstNonEmpty(item.ProviderModelKey, item.ModelKey)) {
				continue
			}
			if base == nil {
				base = item
				continue
			}
			original, originalErr := normalizedChannelModelCapability(base)
			backup, backupErr := normalizedChannelModelCapability(item)
			if originalErr != nil || backupErr != nil || original == nil || backup == nil || original.Text == nil || backup.Text == nil {
				return BadAuthRequest("文本渠道能力配置无法核实，不能开启自动切换")
			}
			if original.Text.ContextWindowTokens != backup.Text.ContextWindowTokens || original.Text.MaxOutputTokens != backup.Text.MaxOutputTokens ||
				original.Text.References.MaxImages != backup.Text.References.MaxImages || original.Text.References.MaxVideos != backup.Text.References.MaxVideos ||
				(original.Text.Streaming != nil && backup.Text.Streaming != nil && *original.Text.Streaming != *backup.Text.Streaming) {
				return BadAuthRequest("文本主备的上下文、输出、视觉或流式能力不一致，不能开启自动切换")
			}
		}
	}
	return nil
}

func smartRoutePolicyRequestFromStored(item *model.SmartRoutePolicy) (SmartRoutePolicyRequest, error) {
	if item == nil {
		return SmartRoutePolicyRequest{}, nil
	}
	req := SmartRoutePolicyRequest{Enabled: item.Enabled, Mode: item.Mode, FailoverEnabled: item.FailoverEnabled, GrayPercent: item.GrayPercent, MaxAttempts: item.MaxAttempts, MaxUpstreamCostMicrocredits: item.MaxUpstreamCostMicrocredits}
	if strings.TrimSpace(item.CompatibleChannelModelIDsJSON) != "" {
		if err := json.Unmarshal([]byte(item.CompatibleChannelModelIDsJSON), &req.CompatibleChannelModelIDs); err != nil {
			return SmartRoutePolicyRequest{}, err
		}
	}
	return req, nil
}
