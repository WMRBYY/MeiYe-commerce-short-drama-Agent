// 管理后台的 API 调用日志：分页、详情、CSV 导出、媒体预览与上游响应摘要补全。
//
// 日志只保存脱敏后的请求摘要；上游响应体中的媒体通过资源访问合同读取，不暴露原始地址。

package app

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) AdminAPICallLogs(actor *model.User, query APICallLogQuery) (*APICallLogPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if query.RecordType != "" && query.RecordType != "request" && query.RecordType != "download" && query.RecordType != "all" {
		return nil, BadAuthRequest("请求明细类型无效")
	}
	filter := normalizeAnalyticsFilter(query.AnalyticsQuery)
	logs, total, err := s.repo.QueryAPICallLogs(repository.APICallLogFilter{AnalyticsFilter: filter, RecordType: query.RecordType, Keyword: query.Keyword, Status: query.Status, Page: query.Page, Limit: query.Limit})
	if err != nil {
		return nil, err
	}
	if err := s.decorateAPICallLogs(logs); err != nil {
		return nil, err
	}
	for index := range logs {
		// 原始报文只允许通过详情接口按单条读取。
		logs[index].RequestBody = ""
		logs[index].ResponseBody = ""
		// 列表只带提示词摘要，全文在详情接口读取，避免长提示词放大分页响应。
		logs[index].TaskPrompt = adminAPICallLogPromptExcerpt(logs[index].TaskPrompt)
	}
	page, limit := query.Page, query.Limit
	if page <= 0 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return &APICallLogPage{Logs: logs, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) decorateAPICallLogs(logs []model.ApiCallLog) error {
	// 历史日志允许读取逻辑删除渠道的名称，但不读取或返回渠道密钥。
	channels, err := s.repo.HistoricalSystemChannelReferences()
	if err != nil {
		return err
	}
	channelNames := make(map[string]string, len(channels))
	for _, channel := range channels {
		channelNames[channel.ID] = channel.Name
	}
	users, err := s.repo.Users()
	if err != nil {
		return err
	}
	userByID := make(map[string]model.User, len(users))
	for _, user := range users {
		userByID[user.ID] = user
	}
	billingOrderIDs := make([]string, 0, len(logs))
	seenBillingOrderIDs := make(map[string]struct{}, len(logs))
	taskIDs := make([]string, 0, len(logs))
	seenTaskIDs := make(map[string]struct{}, len(logs))
	for _, log := range logs {
		if log.Billable && log.BillingOrderID != "" {
			if _, exists := seenBillingOrderIDs[log.BillingOrderID]; !exists {
				seenBillingOrderIDs[log.BillingOrderID] = struct{}{}
				billingOrderIDs = append(billingOrderIDs, log.BillingOrderID)
			}
		}
		if (log.Capability != "image" && log.Capability != "video" && log.Capability != "audio") || log.TaskID == "" {
			continue
		}
		if _, exists := seenTaskIDs[log.TaskID]; exists {
			continue
		}
		seenTaskIDs[log.TaskID] = struct{}{}
		taskIDs = append(taskIDs, log.TaskID)
	}
	tasks, err := s.repo.APICallLogTasks(taskIDs)
	if err != nil {
		return err
	}
	taskByID := make(map[string]model.Task, len(tasks))
	for _, task := range tasks {
		taskByID[task.ID] = task
	}
	billingOrderByID, err := s.repo.BillingOrdersByIDs(billingOrderIDs)
	if err != nil {
		return err
	}
	for index := range logs {
		if logs[index].StartedAt.IsZero() {
			logs[index].StartedAt = logs[index].CreatedAt
		}
		if logs[index].ChannelID == "" {
			logs[index].ChannelName = "自定义渠道"
		} else if name := channelNames[logs[index].ChannelID]; name != "" {
			logs[index].ChannelName = name
		} else {
			logs[index].ChannelName = "已删除渠道"
		}
		if user, exists := userByID[logs[index].UserID]; exists {
			logs[index].UserDisplayName = user.DisplayName
			logs[index].UserAccount = user.Username
			logs[index].UserAvatarMode = user.AvatarMode
			logs[index].UserAvatarPreset = user.AvatarPreset
			switch user.AvatarMode {
			case "custom":
				logs[index].UserAvatarURL = "/api/admin/api-log-users/" + url.PathEscape(user.ID) + "/avatar?v=" + url.QueryEscape(user.AvatarVersion)
			case "":
				logs[index].UserAvatarURL = user.AvatarURL
			}
		}
		if logs[index].Billable {
			if order, exists := billingOrderByID[logs[index].BillingOrderID]; exists && order.UserID == logs[index].UserID {
				logs[index].BillingAvailable = true
				logs[index].BillingStatus = order.Status
				if order.ChannelID == logs[index].ChannelID {
					logs[index].CreditCostConfigured = order.CostPricing.Configured
					cost, costErr := billingCreditCost(order)
					if costErr != nil {
						return costErr
					}
					logs[index].CreditCostMicrocredits = cost
				}
				// 预授权与实收分列：只有已结算订单才有实收，其余状态不能把预授权额当成扣费额。
				logs[index].BillingReservedAmount = order.ReservedAmountMicrocredits
				if order.Status == model.BillingStatusSettled {
					settled := order.ActualAmountMicrocredits
					logs[index].BillingSettledAmount = &settled
				}
			}
		}
		if task, exists := taskByID[logs[index].TaskID]; exists && task.UserID == logs[index].UserID {
			logs[index].TaskStatus = task.Status
			logs[index].MediaStage = task.MediaStage
			// 提示词与请求结果无关：失败请求（例如被上游审核拒绝）同样需要给管理员识别内容。
			logs[index].TaskPrompt = strings.TrimSpace(task.Prompt)
			// A failed primary route attempt must not display the backup's final media.
			if logs[index].Status == model.ApiCallStatusSucceeded {
				previewURL, previewKind := taskMediaPreview(task.ResultJSON, task.Type)
				if canvasResourceID(previewURL) != "" {
					logs[index].MediaPreviewURL = "/api/admin/api-logs/" + logs[index].ID + "/media"
					logs[index].MediaPreviewKind = previewKind
				} else if strings.HasPrefix(previewURL, "https://") || strings.HasPrefix(previewURL, "http://") {
					logs[index].MediaPreviewURL = previewURL
					logs[index].MediaPreviewKind = previewKind
				}
			}
		}
	}
	return nil
}

func (s *Service) AdminAPICallLogUserAvatar(actor *model.User, userID string) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	users, err := s.repo.UsersByIDs([]string{userID})
	if err != nil {
		return nil, err
	}
	if users[userID].AvatarMode != "custom" {
		return nil, NotFound("用户未设置自定义头像")
	}
	avatar, err := s.repo.UserAvatar(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("头像图片不存在")
	}
	if err != nil {
		return nil, err
	}
	return avatar.Data, nil
}

// 管理员媒体读取必须同时校验日志、任务和资源归属，不能绕过用户资源边界按资源 ID 任意读取。
func (s *Service) OpenAdminAPICallLogMediaRange(actor *model.User, logID string, rangeHeader string) (*ResourceStream, error) {
	userID, resource, err := s.adminAPICallLogMediaResource(actor, logID, 0)
	if err != nil {
		return nil, err
	}
	return s.openResourceRange(userID, resource, rangeHeader)
}

// mediaIndex 是任务结果中媒体的序号（0 为列表缩略图那一件），与详情接口 mediaItems 的顺序一致。
func (s *Service) PrepareAdminAPICallLogMediaDelivery(actor *model.User, logID string, mediaIndex int, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	userID, resource, err := s.adminAPICallLogMediaResource(actor, logID, mediaIndex)
	if err != nil {
		return nil, err
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(userID, resource, options, rangeHeader)
}

// PrepareAdminAPICallLogReferenceIndexDelivery 读取任务的第 refIndex 件参考素材（与详情 referenceItems 的顺序一致）。
func (s *Service) PrepareAdminAPICallLogReferenceIndexDelivery(actor *model.User, logID string, refIndex int, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	userID, resource, err := s.adminAPICallLogReferenceResource(actor, logID, refIndex)
	if err != nil {
		return nil, err
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(userID, resource, options, rangeHeader)
}

func (s *Service) adminAPICallLogMediaResource(actor *model.User, logID string, mediaIndex int) (string, *model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return "", nil, err
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(logID))
	if err != nil {
		return "", nil, err
	}
	if log.TaskID == "" || (log.Capability != "image" && log.Capability != "video") {
		return "", nil, BadAuthRequest("该请求没有可预览媒体")
	}
	task, err := s.repo.Task(log.TaskID)
	if err != nil {
		return "", nil, err
	}
	if task.UserID != log.UserID {
		return "", nil, BadAuthRequest("请求与媒体归属不一致")
	}
	var mediaURL string
	if mediaIndex == 0 {
		mediaURL, _ = taskMediaPreview(task.ResultJSON, task.Type)
	} else if refs := taskMediaRefs(task.ResultJSON, task.Type, adminAPICallLogMediaItemLimit); mediaIndex > 0 && mediaIndex < len(refs) {
		mediaURL = refs[mediaIndex].URL
	}
	resourceID := canvasResourceID(mediaURL)
	if resourceID == "" {
		return "", nil, BadAuthRequest("该请求没有已持久化媒体")
	}
	resource, err := s.repo.ResourceForUser(log.UserID, resourceID)
	if err != nil {
		return "", nil, err
	}
	return log.UserID, resource, nil
}

func (s *Service) AdminAPICallLog(actor *model.User, id string) (*model.ApiCallLog, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	logs := []model.ApiCallLog{*log}
	if err := s.decorateAPICallLogs(logs); err != nil {
		return nil, err
	}
	detail := &logs[0]
	// 参考素材与请求成败无关：失败请求同样要能核对带了哪些素材（编号与提示词里的 @视频N / @图片N 对应）。
	if detail.TaskID != "" {
		if task, taskErr := s.repo.Task(detail.TaskID); taskErr == nil && task.UserID == detail.UserID {
			detail.ReferenceItems = s.adminAPICallLogReferenceItems(detail.ID, task)
		}
	}
	// 有缩略图说明任务归属一致且本次请求成功；只在这种情况下列出全部作品，规则与列表缩略图相同。
	if detail.MediaPreviewURL != "" {
		tasks, err := s.repo.APICallLogTasks([]string{detail.TaskID})
		if err != nil {
			return nil, err
		}
		if len(tasks) == 1 && tasks[0].UserID == detail.UserID {
			detail.MediaItems = adminAPICallLogMediaItems(detail.ID, tasks[0].ResultJSON, tasks[0].Type)
		}
	}
	// 上游 v1.8.4：视频请求日志附带生成内容快照与原始参考媒体引用。
	if err := s.decorateAPILogGeneration(detail); err != nil {
		return nil, err
	}
	return detail, nil
}

const (
	adminAPICallLogPromptExcerptRunes = 300
	adminAPICallLogMediaItemLimit     = 24
)

func adminAPICallLogPromptExcerpt(prompt string) string {
	if utf8.RuneCountInString(prompt) <= adminAPICallLogPromptExcerptRunes {
		return prompt
	}
	return truncateRunes(prompt, adminAPICallLogPromptExcerptRunes) + "…"
}

// adminAPICallLogMediaItems 把任务结果中的媒体转成管理员读取地址：平台资源走带归属校验的
// /api/admin/api-logs/{id}/media?index=N，外链与列表缩略图一样原样返回。
func adminAPICallLogMediaItems(logID string, resultJSON string, taskType string) []model.ApiCallLogMediaItem {
	refs := taskMediaRefs(resultJSON, taskType, adminAPICallLogMediaItemLimit)
	items := make([]model.ApiCallLogMediaItem, 0, len(refs))
	for index, ref := range refs {
		url := ref.URL
		if canvasResourceID(url) != "" {
			url = "/api/admin/api-logs/" + logID + "/media"
			if index > 0 {
				url += "?index=" + strconv.Itoa(index)
			}
		} else if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
			continue
		}
		items = append(items, model.ApiCallLogMediaItem{URL: url, Kind: ref.Kind})
	}
	return items
}

type taskMediaRef struct {
	URL  string
	Kind string
}

// taskMediaRefs 按 findTaskMediaPreview 的遍历顺序收集任务结果里的全部媒体（去重），
// 因此第 0 项与列表缩略图、/media 默认读取的那一件相同。
func taskMediaRefs(raw string, taskType string, limit int) []taskMediaRef {
	if strings.TrimSpace(raw) == "" || limit <= 0 {
		return nil
	}
	var payload any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return nil
	}
	hint := "image"
	if strings.Contains(strings.ToLower(taskType), "video") {
		hint = "video"
	}
	refs := make([]taskMediaRef, 0, 4)
	collectTaskMediaRefs(payload, hint, map[string]struct{}{}, &refs, limit)
	return refs
}

func collectTaskMediaRefs(value any, hint string, seen map[string]struct{}, refs *[]taskMediaRef, limit int) {
	if len(*refs) >= limit {
		return
	}
	switch item := value.(type) {
	case string:
		url, kind := findTaskMediaPreview(item, hint)
		if url == "" {
			return
		}
		key := url
		if resourceID := canvasResourceID(url); resourceID != "" {
			key = "resource:" + resourceID
		}
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		*refs = append(*refs, taskMediaRef{URL: url, Kind: kind})
	case []any:
		for _, child := range item {
			collectTaskMediaRefs(child, hint, seen, refs, limit)
		}
	case map[string]any:
		for _, key := range []string{"images", "image", "video", "dataUrl", "url", "resultUrl", "outputUrl"} {
			child, exists := item[key]
			if !exists {
				continue
			}
			childHint := hint
			if key == "video" {
				childHint = "video"
			} else if key == "images" || key == "image" {
				childHint = "image"
			}
			collectTaskMediaRefs(child, childHint, seen, refs, limit)
		}
	}
}

func (s *Service) AdminAPICallLogsCSV(actor *model.User, query APICallLogQuery) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if query.RecordType != "" && query.RecordType != "request" && query.RecordType != "download" && query.RecordType != "all" {
		return nil, BadAuthRequest("请求明细类型无效")
	}
	filter := normalizeAnalyticsFilter(query.AnalyticsQuery)
	ids := uniqueNonEmpty(query.IDs)
	if len(query.IDs) > 0 && len(ids) == 0 {
		return nil, BadAuthRequest("请选择要导出的请求明细")
	}
	if len(ids) > 200 {
		return nil, BadAuthRequest("单次最多导出 200 条已选请求明细")
	}
	logs, err := s.repo.ExportAPICallLogs(repository.APICallLogFilter{AnalyticsFilter: filter, RecordType: query.RecordType, Keyword: query.Keyword, Status: query.Status, IDs: ids}, 10_000)
	if err != nil {
		return nil, err
	}
	if err := s.decorateAPICallLogs(logs); err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	buffer.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"时间", "用户", "用户账号", "渠道", "模型", "能力", "状态", "轮询次数", "耗时毫秒", "输入Token", "输出Token", "缓存Token", "预授权(微积分)", "实收(微积分)", "积分计费状态", "成本价格(微积分)", "上游估算费用(微单位)", "币种", "错误码", "错误"})
	for _, log := range logs {
		startedAt := log.StartedAt
		if startedAt.IsZero() {
			startedAt = log.CreatedAt
		}
		reservedAmount, settledAmount, billingStatus := "", "", ""
		if log.BillingAvailable {
			reservedAmount = strconv.FormatInt(log.BillingReservedAmount, 10)
			if log.BillingSettledAmount != nil {
				settledAmount = strconv.FormatInt(*log.BillingSettledAmount, 10)
			}
			billingStatus = string(log.BillingStatus)
		}
		upstreamCost := ""
		creditCost := ""
		if log.CreditCostMicrocredits != nil {
			creditCost = strconv.FormatInt(*log.CreditCostMicrocredits, 10)
		}
		if log.CostAvailable {
			upstreamCost = strconv.FormatInt(log.EstimatedCostMicros, 10)
		}
		_ = writer.Write([]string{startedAt.UTC().Format(time.RFC3339), log.UserDisplayName, log.UserAccount, log.ChannelName, log.Model, log.Capability, string(log.Status), strconv.Itoa(log.PollCount), strconv.FormatInt(log.DurationMs, 10), strconv.FormatInt(log.InputTokens, 10), strconv.FormatInt(log.OutputTokens, 10), strconv.FormatInt(log.CachedTokens, 10), reservedAmount, settledAmount, billingStatus, creditCost, upstreamCost, log.Currency, log.ErrorCode, log.Error})
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func (s *Service) AdminAnalyticsCSV(actor *model.User, query AnalyticsQuery) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter := normalizeAnalyticsFilter(query)
	logs, err := s.repo.AnalyticsAPICallLogs(filter)
	if err != nil {
		return nil, err
	}
	records, err := s.analyticsFinancialRecords(logs)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	buffer.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"时间", "用户ID", "渠道ID", "任务ID", "能力", "请求阶段", "模型", "状态", "状态码", "耗时毫秒", "输入Token", "输出Token", "缓存Token", "媒体数量", "视频秒数", "收入(微积分)", "成本(微积分)", "利润(微积分)", "错误类型"})
	for _, log := range logs {
		revenue, cost, profit := "", "", ""
		if record, exists := records[log.ID]; exists {
			revenue = strconv.FormatInt(record.Revenue, 10)
			if record.Cost != nil {
				cost = strconv.FormatInt(*record.Cost, 10)
				profit = strconv.FormatInt(record.Revenue-*record.Cost, 10)
			}
		}
		inputTokens, outputTokens, cachedTokens := "", "", ""
		if log.UsageAvailable {
			inputTokens = strconv.FormatInt(log.InputTokens, 10)
			outputTokens = strconv.FormatInt(log.OutputTokens, 10)
			cachedTokens = strconv.FormatInt(log.CachedTokens, 10)
		}
		_ = writer.Write([]string{log.CreatedAt.Format(time.RFC3339), log.UserID, log.ChannelID, log.TaskID, log.Capability, log.RequestKind, log.Model, string(log.Status), strconv.Itoa(log.StatusCode), strconv.FormatInt(log.DurationMs, 10), inputTokens, outputTokens, cachedTokens, strconv.Itoa(log.MediaCount), strconv.Itoa(log.VideoSeconds), revenue, cost, profit, classifyAPICallError(log)})
	}
	writer.Flush()
	return buffer.Bytes(), writer.Error()
}
