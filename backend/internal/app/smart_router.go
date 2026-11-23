package app

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const smartRouterGlobalSettingKey = "smart_router_global"

type SmartRouterGlobalSetting struct {
	Enabled      bool     `json:"enabled"`
	AllowUserIDs []string `json:"allowUserIds,omitempty"`
	// This confirmation is accepted on writes only. It is never persisted as
	// permission for a later save to clear the cohort accidentally.
	AllUsersConfirmed bool `json:"allUsersConfirmed,omitempty"`
}

type SmartRoutePolicyRequest struct {
	Enabled                     bool     `json:"enabled"`
	Mode                        string   `json:"mode"`
	FailoverEnabled             bool     `json:"failoverEnabled"`
	GrayPercent                 int      `json:"grayPercent"`
	MaxAttempts                 int      `json:"maxAttempts"`
	MaxUpstreamCostMicrocredits int64    `json:"maxUpstreamCostMicrocredits"`
	CompatibleChannelModelIDs   []string `json:"compatibleChannelModelIds"`
}

type AdminSmartRoutePolicy struct {
	model.SmartRoutePolicy
	CompatibleChannelModelIDs []string `json:"compatibleChannelModelIds"`
}

type AdminSmartRouterConfig struct {
	Global       SmartRouterGlobalSetting   `json:"global"`
	Policies     []AdminSmartRoutePolicy    `json:"policies"`
	Stats        map[string]SmartRouteStats `json:"stats"`
	ChannelStats map[string]SmartRouteStats `json:"channelStats"`
}

type SmartRouteStats struct {
	Attempts            int            `json:"attempts"`
	Succeeded           int            `json:"succeeded"`
	Failed              int            `json:"failed"`
	Pending             int            `json:"pending"`
	Switches            int            `json:"switches"`
	P50LatencyMs        int64          `json:"p50LatencyMs"`
	P95LatencyMs        int64          `json:"p95LatencyMs"`
	FailureCodes        map[string]int `json:"failureCodes"`
	ConsecutiveFailures int            `json:"consecutiveFailures"`
	CircuitOpen         bool           `json:"circuitOpen"`
}

func (s *Service) smartRouterGlobal() (SmartRouterGlobalSetting, error) {
	setting, err := s.repo.SystemSettingOptional(smartRouterGlobalSettingKey)
	if err != nil || setting == nil {
		return SmartRouterGlobalSetting{}, err
	}
	var value SmartRouterGlobalSetting
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return SmartRouterGlobalSetting{}, err
	}
	return value, nil
}

func (s *Service) AdminSmartRouter(actor *model.User) (*AdminSmartRouterConfig, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	global, err := s.smartRouterGlobal()
	if err != nil {
		return nil, err
	}
	policies, err := s.repo.SmartRoutePolicies()
	if err != nil {
		return nil, err
	}
	result := &AdminSmartRouterConfig{Global: global, Policies: make([]AdminSmartRoutePolicy, 0, len(policies)), Stats: map[string]SmartRouteStats{}, ChannelStats: map[string]SmartRouteStats{}}
	for _, policy := range policies {
		result.Policies = append(result.Policies, adminSmartRoutePolicy(policy))
	}
	outcomes, err := s.repo.RecentSmartRouteAttempts(time.Now().Add(-24*time.Hour), 10000)
	if err != nil {
		return nil, err
	}
	result.Stats = buildSmartRouteStats(outcomes)
	result.ChannelStats = buildSmartRouteChannelStats(outcomes)
	for modelID, channelStats := range result.ChannelStats {
		channel, err := s.repo.ChannelModel(modelID)
		if err != nil {
			continue
		}
		now := time.Now()
		s.routeHealthMu.Lock()
		channelStats.CircuitOpen = s.routeHealthBlocked["channel:"+channel.ChannelID].After(now) || s.routeHealthBlocked["channel-model:"+modelID].After(now)
		s.routeHealthMu.Unlock()
		if !channelStats.CircuitOpen && s.coordinator != nil && s.coordinator.HasRedis() {
			ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
			open, circuitErr := s.coordinator.CircuitOpen(ctx, channel.ChannelID)
			cancel()
			channelStats.CircuitOpen = circuitErr == nil && open
		}
		result.ChannelStats[modelID] = channelStats
	}
	return result, nil
}

func buildSmartRouteChannelStats(outcomes []repository.SmartRouteAttemptOutcome) map[string]SmartRouteStats {
	result := make(map[string]SmartRouteStats)
	latencies := make(map[string][]int64)
	streakOpen := make(map[string]bool)
	for _, outcome := range outcomes {
		id := outcome.ChannelModelID
		if id == "" {
			continue
		}
		stats := result[id]
		if stats.FailureCodes == nil {
			stats.FailureCodes = map[string]int{}
		}
		stats.Attempts++
		switch {
		case outcome.Status == "failed":
			stats.Failed++
			if outcome.FailureCode != "" {
				stats.FailureCodes[outcome.FailureCode]++
			}
			if !streakOpen[id] {
				stats.ConsecutiveFailures++
			}
		case outcome.Status == "succeeded" && outcome.TaskStatus == string(model.TaskStatusSucceeded):
			stats.Succeeded++
			streakOpen[id] = true
			if outcome.CompletedAt != nil {
				latencies[id] = append(latencies[id], outcome.CompletedAt.Sub(outcome.StartedAt).Milliseconds())
			}
		default:
			stats.Pending++
		}
		result[id] = stats
	}
	for id, values := range latencies {
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		stats := result[id]
		stats.P50LatencyMs = percentileDuration(values, 50)
		stats.P95LatencyMs = percentileDuration(values, 95)
		result[id] = stats
	}
	return result
}

func buildSmartRouteStats(outcomes []repository.SmartRouteAttemptOutcome) map[string]SmartRouteStats {
	result := make(map[string]SmartRouteStats)
	latencies := make(map[string][]int64)
	for _, outcome := range outcomes {
		stats := result[outcome.LogicalModelID]
		if stats.FailureCodes == nil {
			stats.FailureCodes = map[string]int{}
		}
		stats.Attempts++
		if outcome.AttemptNumber > 1 {
			stats.Switches++
		}
		switch {
		case outcome.Status == "failed":
			stats.Failed++
			if outcome.FailureCode != "" {
				stats.FailureCodes[outcome.FailureCode]++
			}
		case outcome.Status == "succeeded" && outcome.TaskStatus == string(model.TaskStatusSucceeded):
			stats.Succeeded++
			if outcome.CompletedAt != nil {
				latencies[outcome.LogicalModelID] = append(latencies[outcome.LogicalModelID], outcome.CompletedAt.Sub(outcome.StartedAt).Milliseconds())
			}
		default:
			// An accepted HTTP response or an in-progress task is never success.
			stats.Pending++
		}
		result[outcome.LogicalModelID] = stats
	}
	for id, durations := range latencies {
		sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
		stats := result[id]
		stats.P50LatencyMs = percentileDuration(durations, 50)
		stats.P95LatencyMs = percentileDuration(durations, 95)
		result[id] = stats
	}
	return result
}

func percentileDuration(sorted []int64, percentile int) int64 {
	if len(sorted) == 0 {
		return 0
	}
	index := (len(sorted)*percentile+99)/100 - 1
	if index < 0 {
		index = 0
	}
	return sorted[index]
}

func (s *Service) SetAdminSmartRouterGlobal(actor *model.User, value SmartRouterGlobalSetting) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	seen := map[string]bool{}
	allowed := make([]string, 0, len(value.AllowUserIDs))
	for _, raw := range value.AllowUserIDs {
		id := strings.TrimSpace(raw)
		if id == "" || len(id) > 120 {
			return BadAuthRequest("灰度用户 ID 无效")
		}
		if !seen[id] {
			seen[id] = true
			allowed = append(allowed, id)
		}
	}
	if len(allowed) > 1000 {
		return BadAuthRequest("灰度用户过多")
	}
	if value.Enabled && len(allowed) == 0 && !value.AllUsersConfirmed {
		return BadAuthRequest("启用所有用户前，请明确确认清空灰度名单")
	}
	value.AllowUserIDs = allowed
	value.AllUsersConfirmed = false
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	now := time.Now()
	setting, err := s.repo.SystemSettingOptional(smartRouterGlobalSettingKey)
	if err != nil {
		return err
	}
	if setting == nil {
		setting = &model.SystemSetting{Key: smartRouterGlobalSettingKey, CreatedAt: now}
	}
	setting.ValueJSON, setting.UpdatedBy, setting.UpdatedAt = string(encoded), actor.ID, now
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "smart_router.global", "system_setting", smartRouterGlobalSettingKey, "更新智能路由全局开关", map[string]any{"enabled": value.Enabled, "allowUserCount": len(value.AllowUserIDs)})
}

func (s *Service) SetAdminSmartRoutePolicy(actor *model.User, logicalModelID string, req SmartRoutePolicyRequest) (*AdminSmartRoutePolicy, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	logicalModelID = strings.TrimSpace(logicalModelID)
	if req.Mode == "" {
		req.Mode = "priority"
	}
	if req.Mode != "priority" {
		return nil, BadAuthRequest("当前仅开放严格优先级模式")
	}
	if req.GrayPercent < 0 || req.GrayPercent > 100 || req.MaxAttempts < 1 || req.MaxAttempts > 10 || req.MaxUpstreamCostMicrocredits < 0 {
		return nil, BadAuthRequest("灰度比例、尝试次数或成本上限无效")
	}
	graph, err := s.repo.LogicalModelGraph(logicalModelID, true)
	if err != nil || graph == nil || graph.Model.ArchivedAt != nil {
		return nil, BadAuthRequest("路由组引用的前台模型不存在")
	}
	if existing, existingErr := s.repo.SmartRoutePolicy(logicalModelID); existingErr != nil {
		return nil, existingErr
	} else if existing != nil && existing.ArchivedAt != nil {
		return nil, BadAuthRequest("该智能路由组已归档，请先恢复")
	}
	if graph.Model.Capability == "video" && (req.Enabled || req.FailoverEnabled) {
		return nil, BadAuthRequest("视频异步查单与重复生成保护尚未通过生产验收，当前版本禁止开启视频智能路由")
	}
	if req.Enabled && graph.Model.Capability == "image" && req.MaxUpstreamCostMicrocredits == 0 {
		return nil, BadAuthRequest("图片智能路由必须设置上游总成本上限")
	}
	member := make(map[string]bool, len(graph.Routes))
	for _, route := range graph.Routes {
		member[route.ChannelModelID] = true
	}
	compatible := make([]string, 0, len(req.CompatibleChannelModelIDs))
	if graph.Model.Capability != "image" && len(req.CompatibleChannelModelIDs) > 0 {
		return nil, BadAuthRequest("文本和视频的跨模型能力契约尚未完成验证，当前仅允许同模型跨渠道切换")
	}
	seen := make(map[string]bool)
	for _, id := range req.CompatibleChannelModelIDs {
		id = strings.TrimSpace(id)
		if !member[id] {
			return nil, BadAuthRequest("兼容模型必须属于当前路由组")
		}
		if !seen[id] {
			compatible = append(compatible, id)
			seen[id] = true
		}
	}
	req.CompatibleChannelModelIDs = compatible
	if err := s.validateSmartRouteCandidates(&graph.Model, graph.Routes, req); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(compatible)
	if err != nil {
		return nil, err
	}
	item, err := s.repo.SmartRoutePolicy(logicalModelID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if item == nil {
		item = &model.SmartRoutePolicy{LogicalModelID: logicalModelID, CreatedAt: now}
	}
	item.Enabled, item.Mode, item.FailoverEnabled = req.Enabled, req.Mode, req.FailoverEnabled
	item.GrayPercent, item.MaxAttempts = req.GrayPercent, req.MaxAttempts
	item.MaxUpstreamCostMicrocredits = req.MaxUpstreamCostMicrocredits
	item.CompatibleChannelModelIDsJSON, item.UpdatedAt = string(encoded), now
	if err := s.repo.SaveSmartRoutePolicy(item); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "smart_router.policy", "logical_model", logicalModelID, "更新智能路由组策略", map[string]any{"enabled": req.Enabled, "mode": req.Mode, "grayPercent": req.GrayPercent, "maxAttempts": req.MaxAttempts, "compatibleModelCount": len(compatible)}); err != nil {
		return nil, err
	}
	result := adminSmartRoutePolicy(*item)
	return &result, nil
}

func (s *Service) ArchiveAdminSmartRouteGroup(actor *model.User, logicalModelID, kind string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if kind != "archived" && kind != "deleted" {
		return BadAuthRequest("无效的路由组操作")
	}
	audit, err := newAdminAuditEvent(actor, "smart_router."+kind, "logical_model", logicalModelID, "归档智能路由组并停止分配新任务", map[string]any{"kind": kind})
	if err != nil {
		return err
	}
	if err := s.repo.ArchiveSmartRoutePolicy(strings.TrimSpace(logicalModelID), kind, audit, time.Now()); err != nil {
		if errors.Is(err, repository.ErrLogicalModelInUse) {
			return BadAuthRequest("该路由组仍有排队、运行或对账中的任务，请完成后再归档或删除")
		}
		return err
	}
	return nil
}

func (s *Service) RestoreAdminSmartRouteGroup(actor *model.User, logicalModelID string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	audit, err := newAdminAuditEvent(actor, "smart_router.restore", "logical_model", logicalModelID, "恢复智能路由组为关闭状态", nil)
	if err != nil {
		return err
	}
	return s.repo.RestoreSmartRoutePolicy(strings.TrimSpace(logicalModelID), audit, time.Now())
}

func adminSmartRoutePolicy(item model.SmartRoutePolicy) AdminSmartRoutePolicy {
	result := AdminSmartRoutePolicy{SmartRoutePolicy: item, CompatibleChannelModelIDs: []string{}}
	_ = json.Unmarshal([]byte(item.CompatibleChannelModelIDsJSON), &result.CompatibleChannelModelIDs)
	if result.CompatibleChannelModelIDs == nil {
		result.CompatibleChannelModelIDs = []string{}
	}
	return result
}

// The cohort is stable across retries and server restarts. The task stores the
// decision so later admin changes cannot silently move an in-flight task.
func (s *Service) smartRouteAdmission(userID, logicalModelID string) (bool, error) {
	policy, err := s.repo.SmartRoutePolicy(logicalModelID)
	if err != nil || policy == nil || policy.ArchivedAt != nil || !policy.Enabled || policy.GrayPercent == 0 {
		return false, err
	}
	group, err := s.repo.LogicalModel(logicalModelID)
	if err != nil {
		return false, err
	}
	if !group.Enabled || group.ArchivedAt != nil || group.Capability == "video" {
		return false, nil
	}
	global, err := s.smartRouterGlobal()
	if err != nil || !global.Enabled {
		return false, err
	}
	if len(global.AllowUserIDs) > 0 {
		allowed := false
		for _, id := range global.AllowUserIDs {
			if id == userID {
				allowed = true
				break
			}
		}
		if !allowed {
			return false, nil
		}
	}
	if policy.GrayPercent == 100 {
		return true, nil
	}
	digest := sha256.Sum256([]byte(userID + ":" + logicalModelID))
	return int(binary.BigEndian.Uint64(digest[:8])%100) < policy.GrayPercent, nil
}

func smartRouteCostWithinCap(snapshot model.BillingCostSnapshot, capability string, maxAttempts int, cap int64, tokenEstimate tokenBillingEstimate) bool {
	if cap <= 0 {
		return true
	}
	if maxAttempts <= 0 || !snapshot.CostPricing.Configured {
		return false
	}
	if snapshot.CostBillingMode == "token" && capability == "text" {
		// A new task has no provider usage yet. Reserve against a conservative
		// request envelope instead of treating the absent usage as zero cost.
		// Cached input is priced at the full input rate here.
		cost := snapshot.CostPricing
		amount, err := tokenEstimateAmount(&model.ChannelModel{
			InputTokenPriceMicrocredits:  cost.InputTokenPriceMicrocredits,
			OutputTokenPriceMicrocredits: cost.OutputTokenPriceMicrocredits,
		}, tokenEstimate, 10_000)
		return err == nil && amount >= 0 && amount <= cap/int64(maxAttempts)
	}
	order := model.BillingOrder{BillingCostSnapshot: snapshot, Capability: capability, Status: model.BillingStatusSettled}
	amount, err := billingCreditCost(order)
	return err == nil && amount != nil && *amount >= 0 && *amount <= cap/int64(maxAttempts)
}

func (s *Service) smartRouteTokenCostEnvelope(channelModel model.ChannelModel, input map[string]any, prompt string) tokenBillingEstimate {
	profile, err := normalizedChannelModelCapability(&channelModel, s.protocolRegistry())
	if err != nil || profile == nil || profile.Text == nil || profile.Text.MaxOutputTokens <= 0 {
		return tokenBillingEstimate{}
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return tokenBillingEstimate{}
	}
	// One UTF-8 byte per input token plus room for provider framing is a
	// conservative bound for ordinary text requests. Include the task prompt
	// separately because callers may omit it from the input map.
	return tokenBillingEstimate{InputTokens: int64(len(encoded)+len(prompt)) + 2_048, OutputTokens: int64(profile.Text.MaxOutputTokens)}
}
