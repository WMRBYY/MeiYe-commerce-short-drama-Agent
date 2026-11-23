package repository

import (
	"encoding/json"
	"errors"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type LogicalModelGraph struct {
	Model         model.LogicalModel
	Revision      *model.LogicalModelRevision
	Routes        []model.LogicalModelRoute
	ChannelModels []model.ChannelModel
}

var ErrLogicalModelInUse = errors.New("该模型正在被使用，无法删除或停用")
var ErrLogicalModelUnavailable = errors.New("所选模型已停用或不可用，请重新选择")
var ErrLogicalModelCodeInUse = errors.New("模型代码已被其他活动模型使用")

func (r *Repository) HasLogicalModelCatalog() bool {
	return r.db.Migrator().HasTable(&model.LogicalModel{})
}

func (r *Repository) LogicalModels(includeDisabled bool) ([]model.LogicalModel, error) {
	var items []model.LogicalModel
	query := r.db.Where("archived_at IS NULL").Order("sort_order asc, created_at asc")
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	return items, query.Find(&items).Error
}

func (r *Repository) ArchivedLogicalModels() ([]model.LogicalModel, error) {
	items := make([]model.LogicalModel, 0)
	return items, r.db.Where("archived_at IS NOT NULL").Order("archived_at desc").Find(&items).Error
}

func (r *Repository) LogicalModel(id string) (*model.LogicalModel, error) {
	var item model.LogicalModel
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) LogicalModelsBySourceChannelModelID(channelModelID string) ([]model.LogicalModel, error) {
	var items []model.LogicalModel
	return items, r.db.Where("source_channel_model_id = ? AND archived_at IS NULL", channelModelID).Order("sort_order asc, created_at asc").Find(&items).Error
}

func (r *Repository) LogicalModelsByOnlyActiveChannelModelID(channelModelID string) ([]model.LogicalModel, error) {
	var items []model.LogicalModel
	query := r.db.Model(&model.LogicalModel{}).
		Joins("JOIN logical_model_routes AS route ON route.logical_model_revision_id = logical_models.active_revision_id").
		Where("logical_models.archived_at IS NULL").
		Group("logical_models.id").
		Having("COUNT(route.id) = 1 AND MAX(route.channel_model_id) = ?", channelModelID).
		Order("logical_models.sort_order asc, logical_models.created_at asc")
	return items, query.Find(&items).Error
}

func (r *Repository) LogicalModelRevision(id string) (*model.LogicalModelRevision, error) {
	var item model.LogicalModelRevision
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) LogicalModelRevisions(logicalModelID string) ([]model.LogicalModelRevision, error) {
	var items []model.LogicalModelRevision
	return items, r.db.Where("logical_model_id = ?", logicalModelID).Order("version desc").Find(&items).Error
}

func (r *Repository) LogicalModelRoutes(revisionID string, includeDisabled bool) ([]model.LogicalModelRoute, error) {
	var items []model.LogicalModelRoute
	query := r.db.Where("logical_model_revision_id = ?", revisionID).Order("priority desc, created_at asc")
	if !includeDisabled {
		query = query.Where("enabled = ? AND weight > ?", true, 0)
	}
	return items, query.Find(&items).Error
}

func (r *Repository) LogicalModelRoute(id string) (*model.LogicalModelRoute, error) {
	var item model.LogicalModelRoute
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) SmartRoutePolicy(logicalModelID string) (*model.SmartRoutePolicy, error) {
	if !r.db.Migrator().HasTable(&model.SmartRoutePolicy{}) {
		return nil, nil
	}
	var item model.SmartRoutePolicy
	if err := r.db.Where("logical_model_id = ?", logicalModelID).Limit(1).Find(&item).Error; err != nil {
		return nil, err
	}
	if item.LogicalModelID == "" {
		return nil, nil
	}
	return &item, nil
}

func (r *Repository) SaveSmartRoutePolicy(item *model.SmartRoutePolicy) error {
	return r.db.Save(item).Error
}

func (r *Repository) SmartRoutePolicies() ([]model.SmartRoutePolicy, error) {
	items := make([]model.SmartRoutePolicy, 0)
	if !r.db.Migrator().HasTable(&model.SmartRoutePolicy{}) {
		return items, nil
	}
	return items, r.db.Order("logical_model_id asc").Find(&items).Error
}

func (r *Repository) ArchiveSmartRoutePolicy(id string, kind string, audit *model.AdminAuditEvent, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var group model.LogicalModel
		query := tx.Where("id = ? AND archived_at IS NULL", id)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&group).Error; err != nil {
			return err
		}
		var active int64
		if err := tx.Model(&model.Task{}).Where("logical_model_id = ? AND smart_route_active = ? AND status IN ?", id, true, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusReconciling}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return ErrLogicalModelInUse
		}
		var policy model.SmartRoutePolicy
		if err := tx.Where("logical_model_id = ?", id).First(&policy).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			policy = model.SmartRoutePolicy{LogicalModelID: id, Mode: "priority", MaxAttempts: 1, CompatibleChannelModelIDsJSON: "[]", CreatedAt: now}
		} else if err != nil {
			return err
		}
		if policy.ArchivedAt != nil {
			return gorm.ErrRecordNotFound
		}
		policy.Enabled = false
		policy.ArchivedAt = &now
		policy.ArchiveKind = kind
		policy.UpdatedAt = now
		if err := tx.Save(&policy).Error; err != nil {
			return err
		}
		if audit != nil {
			return tx.Create(audit).Error
		}
		return nil
	})
}

func (r *Repository) RestoreSmartRoutePolicy(id string, audit *model.AdminAuditEvent, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var group model.LogicalModel
		groupQuery := tx.Where("id = ? AND archived_at IS NULL", id)
		if r.Dialect() == "postgres" {
			groupQuery = groupQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := groupQuery.First(&group).Error; err != nil {
			return err
		}
		var policy model.SmartRoutePolicy
		query := tx.Where("logical_model_id = ? AND archived_at IS NOT NULL", id)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&policy).Error; err != nil {
			return err
		}
		if err := tx.Model(&policy).Updates(map[string]any{"enabled": false, "archived_at": nil, "archive_kind": "", "updated_at": now}).Error; err != nil {
			return err
		}
		// Previously referenced channel models may have been deleted while the
		// group was archived. Keep the restored model unavailable until reviewed.
		if err := tx.Model(&group).Updates(map[string]any{"enabled": false, "updated_at": now}).Error; err != nil {
			return err
		}
		if audit != nil {
			return tx.Create(audit).Error
		}
		return nil
	})
}

type SmartRouteAttemptOutcome struct {
	LogicalModelID string
	RouteID        string
	ChannelID      string
	ChannelModelID string
	AttemptNumber  int
	Status         string
	FailureCode    string
	TaskStatus     string
	StartedAt      time.Time
	CompletedAt    *time.Time
}

func (r *Repository) RecentSmartRouteAttempts(since time.Time, limit int) ([]SmartRouteAttemptOutcome, error) {
	items := make([]SmartRouteAttemptOutcome, 0)
	if !r.db.Migrator().HasTable(&model.RouteAttempt{}) || !r.db.Migrator().HasTable(&model.Task{}) {
		return items, nil
	}
	if limit <= 0 || limit > 10000 {
		limit = 10000
	}
	err := r.db.Table("route_attempts AS attempt").
		Select("attempt.logical_model_id, attempt.route_id, attempt.channel_id, attempt.channel_model_id, attempt.attempt_number, attempt.status, attempt.failure_code, attempt.started_at, attempt.completed_at, tasks.status AS task_status").
		Joins("JOIN tasks ON tasks.id = attempt.task_id").
		Where("attempt.logical_model_id <> '' AND attempt.started_at >= ?", since).
		Order("attempt.started_at DESC").Limit(limit).Scan(&items).Error
	return items, err
}

func (r *Repository) ChannelModelsByIDs(ids []string) ([]model.ChannelModel, error) {
	var items []model.ChannelModel
	if len(ids) == 0 {
		return items, nil
	}
	if err := r.db.Where("id IN ?", ids).Find(&items).Error; err != nil {
		return nil, err
	}
	return items, r.PopulateChannelModelPriceTiers(items)
}

func (r *Repository) SystemChannelsByIDs(ids []string, includeDisabled bool) ([]model.ModelChannel, error) {
	var items []model.ModelChannel
	if len(ids) == 0 {
		return items, nil
	}
	query := r.db.Where("id IN ? AND scope = ?", uniqueStrings(ids), model.ChannelScopeSystem)
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	return items, query.Find(&items).Error
}

func (r *Repository) ChannelModel(id string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	if err := r.PopulateChannelModelPriceTier(&item); err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) LogicalModelGraph(id string, includeDisabled bool) (*LogicalModelGraph, error) {
	item, err := r.LogicalModel(id)
	if err != nil {
		return nil, err
	}
	if !includeDisabled && !item.Enabled {
		return nil, gorm.ErrRecordNotFound
	}
	graphs, err := r.LogicalModelGraphs([]model.LogicalModel{*item}, includeDisabled)
	if err != nil {
		return nil, err
	}
	return graphs[item.ID], nil
}

// LogicalModelGraphs 批量加载前台模型的当前 revision、供应线路和渠道模型。
// 管理列表与路由目录都需要同一张关系图，集中按 IN 查询避免逐模型 N+1。
func (r *Repository) LogicalModelGraphs(items []model.LogicalModel, includeDisabled bool) (map[string]*LogicalModelGraph, error) {
	graphs := make(map[string]*LogicalModelGraph, len(items))
	if len(items) == 0 {
		return graphs, nil
	}

	revisionIDs := make([]string, 0, len(items))
	for _, item := range items {
		graphs[item.ID] = &LogicalModelGraph{Model: item}
		if item.ActiveRevisionID != "" {
			revisionIDs = append(revisionIDs, item.ActiveRevisionID)
		}
	}
	if len(revisionIDs) == 0 {
		return graphs, nil
	}

	var revisions []model.LogicalModelRevision
	if err := r.db.Where("id IN ?", uniqueStrings(revisionIDs)).Find(&revisions).Error; err != nil {
		return nil, err
	}
	revisionByID := make(map[string]model.LogicalModelRevision, len(revisions))
	for _, revision := range revisions {
		revisionByID[revision.ID] = revision
	}

	routeRevisionIDs := make([]string, 0, len(revisions))
	for _, item := range items {
		graph := graphs[item.ID]
		revision, ok := revisionByID[item.ActiveRevisionID]
		if !ok {
			continue
		}
		r := revision
		graph.Revision = &r
		routeRevisionIDs = append(routeRevisionIDs, revision.ID)
	}

	var routes []model.LogicalModelRoute
	if len(routeRevisionIDs) > 0 {
		query := r.db.Where("logical_model_revision_id IN ?", uniqueStrings(routeRevisionIDs)).Order("priority desc, created_at asc")
		if !includeDisabled {
			query = query.Where("enabled = ? AND weight > ?", true, 0)
		}
		if err := query.Find(&routes).Error; err != nil {
			return nil, err
		}
	}
	routesByRevision := make(map[string][]model.LogicalModelRoute, len(routeRevisionIDs))
	channelModelIDs := make([]string, 0, len(routes))
	for _, route := range routes {
		routesByRevision[route.LogicalModelRevisionID] = append(routesByRevision[route.LogicalModelRevisionID], route)
		channelModelIDs = append(channelModelIDs, route.ChannelModelID)
	}

	channelModels, err := r.ChannelModelsByIDs(uniqueStrings(channelModelIDs))
	if err != nil {
		return nil, err
	}
	channelModelByID := make(map[string]model.ChannelModel, len(channelModels))
	for _, channelModel := range channelModels {
		channelModelByID[channelModel.ID] = channelModel
	}

	for _, item := range items {
		graph := graphs[item.ID]
		if graph.Revision == nil {
			continue
		}
		graph.Routes = routesByRevision[graph.Revision.ID]
		graph.ChannelModels = make([]model.ChannelModel, 0, len(graph.Routes))
		seenChannelModels := make(map[string]bool, len(graph.Routes))
		for _, route := range graph.Routes {
			if channelModel, channelOK := channelModelByID[route.ChannelModelID]; channelOK && !seenChannelModels[channelModel.ID] {
				seenChannelModels[channelModel.ID] = true
				graph.ChannelModels = append(graph.ChannelModels, channelModel)
			}
		}
	}
	return graphs, nil
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func (r *Repository) SaveLogicalModel(item *model.LogicalModel) error { return r.db.Save(item).Error }
func (r *Repository) CreateLogicalModel(item *model.LogicalModel) error {
	return r.db.Create(item).Error
}
func (r *Repository) CreateLogicalModelRevision(item *model.LogicalModelRevision) error {
	return r.db.Create(item).Error
}
func (r *Repository) SaveLogicalModelRevision(item *model.LogicalModelRevision) error {
	return r.db.Save(item).Error
}
func (r *Repository) CreateLogicalModelRoute(item *model.LogicalModelRoute) error {
	return r.db.Create(item).Error
}
func (r *Repository) SaveLogicalModelRoute(item *model.LogicalModelRoute) error {
	return r.db.Save(item).Error
}
func (r *Repository) CreateRouteAttempt(item *model.RouteAttempt) error {
	return r.db.Create(item).Error
}
func (r *Repository) SaveRouteAttempt(item *model.RouteAttempt) error { return r.db.Save(item).Error }

func (r *Repository) MarkRouteAttemptDispatching(id string) error {
	result := r.db.Model(&model.RouteAttempt{}).Where("id = ? AND dispatch_state = ?", id, "not_sent").
		Updates(map[string]any{"status": "dispatching", "dispatch_state": "submission_unknown"})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	return nil
}

// Persist the exact boundary before the first upstream create request leaves
// this process. A restarted worker cannot mistake local preparation for an
// accepted job, or send a second create after this marker was written.
func (r *Repository) MarkRouteAttemptOutboundStarted(id string) error {
	now := time.Now()
	result := r.db.Model(&model.RouteAttempt{}).
		Where("id = ? AND status = ? AND dispatch_state = ? AND outbound_started_at IS NULL", id, "dispatching", "submission_unknown").
		Update("outbound_started_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	return nil
}

func (r *Repository) ResetUnsentRouteAttempt(id string) error {
	result := r.db.Model(&model.RouteAttempt{}).
		Where("id = ? AND status = ? AND dispatch_state = ? AND outbound_started_at IS NULL", id, "dispatching", "submission_unknown").
		Updates(map[string]any{"status": "selected", "dispatch_state": "not_sent"})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCreationConflict
	}
	return nil
}

func (r *Repository) LatestRouteAttempt(taskID string) (*model.RouteAttempt, error) {
	var item model.RouteAttempt
	if err := r.db.Where("task_id = ?", taskID).Order("route_run desc, attempt_number desc").First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) RouteAttempts(taskID string, routeRun int) ([]model.RouteAttempt, error) {
	var items []model.RouteAttempt
	query := r.db.Where("task_id = ? AND route_run = ?", taskID, routeRun)
	return items, query.Order("attempt_number asc").Find(&items).Error
}

// SwitchTaskLogicalRoute 同时更新任务执行目标和账单。跟随供应价格时会原子调整预留积分，
// 保证明确未创建上游任务后的故障切线不会沿用上一条线路的价格快照。
func (r *Repository) SwitchTaskLogicalRoute(taskID string, expectedRouteID string, routeID string, inputJSON string, billingOrderID string, channelID string, channelModelID string, replacement *model.BillingOrder, cost model.BillingCostSnapshot, binding string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var task model.Task
		if err := tx.Select("id", "selected_execution_model_id").First(&task, "id = ?", taskID).Error; err != nil {
			return err
		}
		actualModelID := task.SelectedExecutionModelID
		if tx.Migrator().HasTable(&model.ChannelModel{}) {
			var selected model.ChannelModel
			if err := tx.Select("id", "model_key", "provider_model_key").First(&selected, "id = ?", channelModelID).Error; err != nil {
				return err
			}
			actualModelID = selected.ProviderModelKey
			if actualModelID == "" {
				actualModelID = selected.ModelKey
			}
		}
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND status = ? AND route_id = ?", taskID, model.TaskStatusRunning, expectedRouteID).
			Updates(map[string]any{"route_id": routeID, "channel_model_id": channelModelID, "actual_execution_model_id": actualModelID, "compatible_model_fallback": task.SelectedExecutionModelID != "" && task.SelectedExecutionModelID != actualModelID, "protocol_binding_json": binding, "input_json": inputJSON, "updated_at": time.Now()})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		if billingOrderID == "" {
			return nil
		}
		var order model.BillingOrder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ? AND task_id = ? AND status IN ?", billingOrderID, taskID, []model.BillingStatus{model.BillingStatusReserved, model.BillingStatusRunning}).Error; err != nil {
			return err
		}
		now := time.Now()
		updates := map[string]any{"channel_id": channelID, "channel_model_id": channelModelID, "updated_at": now}
		updates["cost_configured"] = cost.CostPricing.Configured
		costImagePricing, err := json.Marshal(cost.CostPricing.ImagePricing)
		if err != nil {
			return err
		}
		updates["cost_image_pricing"] = string(costImagePricing)
		updates["cost_unit_price_microcredits"] = cost.CostPricing.UnitPriceMicrocredits
		updates["cost_input_token_price_microcredits"] = cost.CostPricing.InputTokenPriceMicrocredits
		updates["cost_output_token_price_microcredits"] = cost.CostPricing.OutputTokenPriceMicrocredits
		updates["cost_cached_token_price_microcredits"] = cost.CostPricing.CachedTokenPriceMicrocredits
		updates["cost_cache_write_token_price_microcredits"] = cost.CostPricing.CacheWriteTokenPriceMicrocredits
		updates["cost_reference_video_unit_price_microcredits"] = cost.CostPricing.ReferenceVideoUnitPriceMicrocredits
		updates["cost_reference_video_output_token_price_microcredits"] = cost.CostPricing.ReferenceVideoOutputTokenPriceMicrocredits
		updates["cost_billing_mode"] = cost.CostBillingMode
		updates["cost_quantity"] = cost.CostQuantity
		updates["cost_video_formula_tokens"] = cost.CostVideoFormulaTokens
		if replacement != nil {
			if replacement.UserID != order.UserID || replacement.TaskID != taskID || replacement.AmountMicrocredits <= 0 {
				return ErrBillingStateConflict
			}
			// The new supplier price cannot expand the user's original authorization.
			// Keep the existing cap; replacement is a price snapshot, not a new grant.
			if err := validateBillingChargeLimit(order, replacement.AmountMicrocredits); err != nil {
				return err
			}
			reserved := order.ReservedAmountMicrocredits
			if reserved <= 0 {
				reserved = order.AmountMicrocredits
			}
			delta := replacement.AmountMicrocredits - reserved
			accountUpdates := map[string]any{"version": gorm.Expr("version + 1"), "updated_at": now}
			accountQuery := billingAccountQuery(tx, order)
			if delta > 0 {
				accountQuery = accountQuery.Where("available_microcredits >= ?", delta)
				accountUpdates["available_microcredits"] = gorm.Expr("available_microcredits - ?", delta)
				accountUpdates["reserved_microcredits"] = gorm.Expr("reserved_microcredits + ?", delta)
			} else if delta < 0 {
				release := -delta
				accountQuery = accountQuery.Where("reserved_microcredits >= ?", release)
				accountUpdates["available_microcredits"] = gorm.Expr("available_microcredits + ?", release)
				accountUpdates["reserved_microcredits"] = gorm.Expr("reserved_microcredits - ?", release)
			}
			if order.DeductedUpfront {
				if delta > 0 {
					var account model.CreditAccount
					if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&account, "user_id = ?", order.UserID).Error; err != nil {
						return err
					}
					if account.AvailableMicrocredits < delta {
						return ErrInsufficientCredits
					}
				}
				if err := directBillingAdjustment(tx, &order, -delta, "备用供应线路价格调整"); err != nil {
					return err
				}
			} else if delta != 0 {
				accountUpdated := accountQuery.Updates(accountUpdates)
				if accountUpdated.Error != nil {
					return accountUpdated.Error
				}
				if accountUpdated.RowsAffected != 1 {
					if delta > 0 {
						return ErrInsufficientCredits
					}
					return errors.New("reserved credit balance is inconsistent")
				}
				var account model.CreditAccount
				if err := billingAccountQuery(tx, order).First(&account).Error; err != nil {
					return err
				}
				entryType := model.CreditLedgerReserve
				if delta < 0 {
					entryType = model.CreditLedgerRefund
				}
				if err := tx.Create(&model.CreditLedgerEntry{
					ID: newRepositoryID(), UserID: order.UserID, Type: entryType,
					AccountID: order.BillingAccountID, TeamID: order.TeamID, MembershipID: order.MembershipID,
					AvailableDeltaMicrocredits: -delta, ReservedDeltaMicrocredits: delta,
					AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
					BillingOrderID: order.ID, Model: order.Model, ChannelID: channelID, Scene: order.Scene,
					Note: "备用供应线路价格调整",
				}).Error; err != nil {
					return err
				}
			}
			updates["billing_mode"] = replacement.BillingMode
			imagePricing, err := json.Marshal(replacement.ImagePricing)
			if err != nil {
				return err
			}
			updates["image_pricing"] = string(imagePricing)
			updates["image_input_images"] = replacement.ImageInputImages
			updates["image_max_output_images"] = replacement.ImageMaxOutputImages
			updates["price_version"] = replacement.PriceVersion
			updates["price_tier_id"] = replacement.PriceTierID
			updates["price_tier_version"] = replacement.PriceTierVersion
			updates["unit_price_microcredits"] = replacement.UnitPriceMicrocredits
			updates["multiplier_basis_points"] = replacement.MultiplierBasisPoints
			updates["quantity"] = replacement.Quantity
			updates["amount_microcredits"] = replacement.AmountMicrocredits
			updates["reserved_amount_microcredits"] = replacement.AmountMicrocredits
			updates["input_token_price_microcredits"] = replacement.InputTokenPriceMicrocredits
			updates["output_token_price_microcredits"] = replacement.OutputTokenPriceMicrocredits
			updates["cached_token_price_microcredits"] = replacement.CachedTokenPriceMicrocredits
			updates["cache_write_token_price_microcredits"] = replacement.CacheWriteTokenPriceMicrocredits
			updates["token_price_rules_json"] = replacement.TokenPriceRulesJSON
			// 结算按这些快照判断：公式用量、参考视频是否计费与计入的毫秒数必须跟着新线路的单价一起换，
			// 否则新单价会配上旧线路的参考视频口径（如带参考视频单价却不计参考视频秒数）。
			updates["video_formula_tokens"] = replacement.VideoFormulaTokens
			updates["reference_video_count"] = replacement.ReferenceVideoCount
			updates["reference_video_millis"] = replacement.ReferenceVideoMillis
			updates["reference_video_billed"] = replacement.ReferenceVideoBilled
		}
		billingUpdated := tx.Model(&model.BillingOrder{}).
			Where("id = ? AND task_id = ? AND status IN ?", billingOrderID, taskID, []model.BillingStatus{model.BillingStatusReserved, model.BillingStatusRunning}).
			Updates(updates)
		if billingUpdated.Error != nil {
			return billingUpdated.Error
		}
		if billingUpdated.RowsAffected != 1 {
			return ErrBillingStateConflict
		}
		return nil
	})
}

func (r *Repository) SaveLogicalModelBundle(item *model.LogicalModel, revision *model.LogicalModelRevision, routes []model.LogicalModelRoute, creating bool) error {
	imagePricing, err := json.Marshal(item.ImagePricing)
	if err != nil {
		return err
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if creating {
			if err := tx.Create(item).Error; err != nil {
				return err
			}
		} else {
			result := tx.Model(&model.LogicalModel{}).Where("id = ?", item.ID).Updates(map[string]any{
				"code":                            item.Code,
				"name":                            item.Name,
				"icon":                            item.Icon,
				"description":                     item.Description,
				"capability":                      item.Capability,
				"enabled":                         item.Enabled,
				"sort_order":                      item.SortOrder,
				"publication_scope":               item.PublicationScope,
				"publication_allow_user_ids_json": item.PublicationAllowUserIDsJSON,
				"source_channel_model_id":         item.SourceChannelModelID,
				"price_policy":                    item.PricePolicy,
				"billing_mode":                    item.BillingMode,
				"unit_price_microcredits":         item.UnitPriceMicrocredits,
				"input_price_microcredits":        item.InputPriceMicrocredits,
				"output_price_microcredits":       item.OutputPriceMicrocredits,
				"cached_price_microcredits":       item.CachedPriceMicrocredits,
				"cache_write_price_microcredits":  item.CacheWritePriceMicrocredits,
				"legacy_model_ids_json":           item.LegacyModelIDsJSON,
				"updated_at":                      item.UpdatedAt,
				"image_pricing":                   string(imagePricing),
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}

		// 版本号必须由模型行原子递增。MAX(version)+1 会让两个并发事务分配同一版本。
		result := tx.Model(&model.LogicalModel{}).
			Where("id = ?", item.ID).
			UpdateColumn("revision_sequence", gorm.Expr("revision_sequence + ?", 1))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		var sequence struct{ RevisionSequence int }
		if err := tx.Model(&model.LogicalModel{}).
			Select("revision_sequence").
			Where("id = ?", item.ID).
			Take(&sequence).Error; err != nil {
			return err
		}
		revision.Version = sequence.RevisionSequence
		if err := tx.Create(revision).Error; err != nil {
			return err
		}
		for index := range routes {
			routes[index].LogicalModelRevisionID = revision.ID
			if err := tx.Create(&routes[index]).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.LogicalModel{}).Where("id = ?", item.ID).Updates(map[string]any{"active_revision_id": revision.ID, "updated_at": item.UpdatedAt}).Error; err != nil {
			return err
		}
		item.ActiveRevisionID = revision.ID
		item.RevisionSequence = revision.Version
		return nil
	})
}

func (r *Repository) ArchiveLogicalModel(id string, audit *model.AdminAuditEvent, now time.Time) error {
	return r.ArchiveLogicalModelWithKind(id, audit, now, "archived")
}

func (r *Repository) ArchiveLogicalModelWithKind(id string, audit *model.AdminAuditEvent, now time.Time, kind string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// PostgreSQL 下锁定主体，使任务创建与归档在同一行上串行，避免检查后仍写入新任务。
		var item model.LogicalModel
		query := tx.Where("id = ? AND archived_at IS NULL", id)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&item).Error; err != nil {
			return err
		}
		var activeTasks int64
		if err := tx.Model(&model.Task{}).
			Where("logical_model_id = ? AND status IN ?", id, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusReconciling}).
			Count(&activeTasks).Error; err != nil {
			return err
		}
		if activeTasks > 0 {
			return ErrLogicalModelInUse
		}
		archived := tx.Model(&model.LogicalModel{}).
			Where("id = ? AND archived_at IS NULL", id).
			Updates(map[string]any{"enabled": false, "archived_at": now, "archive_kind": kind, "updated_at": now})
		if archived.Error != nil {
			return archived.Error
		}
		if archived.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if audit != nil {
			if err := tx.Create(audit).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) RestoreLogicalModel(id string, audit *model.AdminAuditEvent, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var item model.LogicalModel
		query := tx.Where("id = ? AND archived_at IS NOT NULL", id)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&item).Error; err != nil {
			return err
		}
		var duplicate int64
		if err := tx.Model(&model.LogicalModel{}).Where("code = ? AND id <> ? AND archived_at IS NULL", item.Code, id).Count(&duplicate).Error; err != nil {
			return err
		}
		if duplicate > 0 {
			return ErrLogicalModelCodeInUse
		}
		if err := tx.Model(&item).Updates(map[string]any{"enabled": false, "archived_at": nil, "archive_kind": "", "updated_at": now}).Error; err != nil {
			return err
		}
		if audit != nil {
			return tx.Create(audit).Error
		}
		return nil
	})
}

// requireActiveLogicalModelForTask 与归档共用主体行锁，保证新任务只引用仍在目录中的当前 revision。
func (r *Repository) requireActiveLogicalModelForTask(tx *gorm.DB, task *model.Task) error {
	if task == nil || task.LogicalModelID == "" {
		return nil
	}
	var item model.LogicalModel
	query := tx.Select("id").Where(
		"id = ? AND enabled = ? AND archived_at IS NULL AND active_revision_id = ?",
		task.LogicalModelID,
		true,
		task.LogicalModelRevisionID,
	)
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.First(&item).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLogicalModelUnavailable
		}
		return err
	}
	if tx.Migrator().HasTable(&model.SmartRoutePolicy{}) {
		var archived int64
		if err := tx.Model(&model.SmartRoutePolicy{}).Where("logical_model_id = ? AND archived_at IS NOT NULL", task.LogicalModelID).Count(&archived).Error; err != nil {
			return err
		}
		if archived > 0 {
			return ErrLogicalModelUnavailable
		}
	}
	return nil
}

func (r *Repository) DeleteLogicalModelRoute(id string) error {
	return r.db.Model(&model.LogicalModelRoute{}).Where("id = ?", id).Updates(map[string]any{"enabled": false, "weight": 0, "updated_at": time.Now()}).Error
}
