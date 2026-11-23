package repository

import (
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CanvasTemplateFilter 是模版列表查询条件；Statuses 为空表示不限状态。
type CanvasTemplateFilter struct {
	Statuses []model.CanvasTemplateStatus
	Category string
	Keyword  string
	// IncludeUsername 允许关键词匹配登录名和用户 ID，仅后台使用。
	IncludeUsername bool
	UserID          string
	CanvasID        string
	Page            int
	Limit           int
	// OldestFirst 用于待审核队列：先提交的先审核。
	OldestFirst bool
	// ByPublished 用于公开列表：按上架时间倒序。
	ByPublished bool
}

// 列表不读取画布正文，正文可能有数 MB。
const canvasTemplateListColumns = "id, user_id, canvas_id, title, description, category, tags_json, video_resource_id, cover_resource_id, video_duration_ms, video_width, video_height, video_bytes, allow_download, node_count, connection_count, status, review_note, reviewed_by, reviewed_at, published_at, like_count, report_count, created_at, updated_at, CASE WHEN category = 'ecommerce' THEN payload_json ELSE '' END AS payload_json"

// ReplacePendingCanvasTemplate 在一个事务里撤下同一画布仍在审核中的旧投稿，再写入新投稿及其可公开资源。
func (r *Repository) ReplacePendingCanvasTemplate(template *model.CanvasTemplate, resourceIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var pendingIDs []string
		if err := tx.Model(&model.CanvasTemplate{}).
			Where("user_id = ? AND canvas_id = ? AND status = ?", template.UserID, template.CanvasID, model.CanvasTemplateStatusPending).
			Pluck("id", &pendingIDs).Error; err != nil {
			return err
		}
		if len(pendingIDs) > 0 {
			if err := tx.Where("template_id IN ?", pendingIDs).Delete(&model.CanvasTemplateResource{}).Error; err != nil {
				return err
			}
			if err := tx.Where("id IN ?", pendingIDs).Delete(&model.CanvasTemplate{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(template).Error; err != nil {
			return err
		}
		refs := make([]model.CanvasTemplateResource, 0, len(resourceIDs))
		seen := make(map[string]bool, len(resourceIDs))
		for _, id := range resourceIDs {
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			refs = append(refs, model.CanvasTemplateResource{TemplateID: template.ID, ResourceID: id})
		}
		if len(refs) == 0 {
			return nil
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(refs, 200).Error
	})
}

func (r *Repository) CanvasTemplate(id string) (*model.CanvasTemplate, error) {
	var template model.CanvasTemplate
	if err := r.db.First(&template, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

// CanvasTemplateSummary 读取不含画布正文的模版记录。
func (r *Repository) CanvasTemplateSummary(id string) (*model.CanvasTemplate, error) {
	var template model.CanvasTemplate
	if err := r.db.Select(canvasTemplateListColumns).First(&template, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

func (r *Repository) CountUserCanvasTemplates(userID string, status model.CanvasTemplateStatus, excludeCanvasID string) (int64, error) {
	var count int64
	query := r.db.Model(&model.CanvasTemplate{}).Where("user_id = ? AND status = ?", userID, status)
	if excludeCanvasID != "" {
		query = query.Where("canvas_id <> ?", excludeCanvasID)
	}
	err := query.Count(&count).Error
	return count, err
}

func (r *Repository) QueryCanvasTemplates(filter CanvasTemplateFilter) ([]model.CanvasTemplate, int64, error) {
	query := r.db.Model(&model.CanvasTemplate{})
	if len(filter.Statuses) > 0 {
		query = query.Where("status IN ?", filter.Statuses)
	}
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if filter.UserID != "" {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if filter.CanvasID != "" {
		query = query.Where("canvas_id = ?", filter.CanvasID)
	}
	if keyword := strings.ToLower(strings.TrimSpace(filter.Keyword)); keyword != "" {
		like := "%" + escapeLike(keyword) + "%"
		// 公开搜索只匹配昵称；登录名可能是手机号或邮箱，只允许后台按它检索。
		authors := r.db.Model(&model.User{}).Select("id").Where("LOWER(display_name) LIKE ? ESCAPE '\\'", like)
		if filter.IncludeUsername {
			authors = r.db.Model(&model.User{}).Select("id").Where("LOWER(display_name) LIKE ? ESCAPE '\\' OR LOWER(username) LIKE ? ESCAPE '\\' OR id = ?", like, like, strings.TrimSpace(filter.Keyword))
		}
		query = query.Where("(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(description) LIKE ? ESCAPE '\\' OR LOWER(tags_json) LIKE ? ESCAPE '\\' OR user_id IN (?))", like, like, like, authors)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	switch {
	case filter.ByPublished:
		query = query.Order("published_at DESC").Order("id DESC")
	case filter.OldestFirst:
		query = query.Order("created_at ASC").Order("id ASC")
	default:
		query = query.Order("created_at DESC").Order("id DESC")
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 24
	}
	page := filter.Page
	if page <= 0 {
		page = 1
	}
	var templates []model.CanvasTemplate
	err := query.Select(canvasTemplateListColumns).Limit(limit).Offset((page - 1) * limit).Find(&templates).Error
	return templates, total, err
}

func (r *Repository) CountCanvasTemplatesByStatus() (map[string]int64, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	if err := r.db.Model(&model.CanvasTemplate{}).Select("status, COUNT(*) AS count").Group("status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.Status] = row.Count
	}
	return result, nil
}

func (r *Repository) CanvasTemplateHasResource(templateID string, resourceID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.CanvasTemplateResource{}).Where("template_id = ? AND resource_id = ?", templateID, resourceID).Count(&count).Error
	return count > 0, err
}

// UpdateCanvasTemplateReview 只在模版仍处于 fromStatuses 之一时改写审核字段，避免并发审核互相覆盖。
func (r *Repository) UpdateCanvasTemplateReview(id string, fromStatuses []model.CanvasTemplateStatus, updates map[string]any) (bool, error) {
	updates["updated_at"] = time.Now()
	result := r.db.Model(&model.CanvasTemplate{}).Where("id = ? AND status IN ?", id, fromStatuses).Updates(updates)
	return result.RowsAffected > 0, result.Error
}

// SetCanvasTemplateLike 写入或撤销点赞，并按明细表重算计数，返回最新点赞数。
func (r *Repository) SetCanvasTemplateLike(templateID string, userID string, liked bool) (int64, error) {
	var count int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if liked {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.CanvasTemplateLike{TemplateID: templateID, UserID: userID, CreatedAt: time.Now()}).Error; err != nil {
				return err
			}
		} else if err := tx.Where("template_id = ? AND user_id = ?", templateID, userID).Delete(&model.CanvasTemplateLike{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.CanvasTemplateLike{}).Where("template_id = ?", templateID).Count(&count).Error; err != nil {
			return err
		}
		return tx.Model(&model.CanvasTemplate{}).Where("id = ?", templateID).UpdateColumn("like_count", count).Error
	})
	return count, err
}

func (r *Repository) CanvasTemplatesLikedBy(userID string, templateIDs []string) (map[string]bool, error) {
	result := map[string]bool{}
	if userID == "" || len(templateIDs) == 0 {
		return result, nil
	}
	var ids []string
	if err := r.db.Model(&model.CanvasTemplateLike{}).Where("user_id = ? AND template_id IN ?", userID, templateIDs).Pluck("template_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		result[id] = true
	}
	return result, nil
}

func (r *Repository) SetUserFollow(followerID string, followeeID string, followed bool) error {
	if followed {
		return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.UserFollow{FollowerID: followerID, FolloweeID: followeeID, CreatedAt: time.Now()}).Error
	}
	return r.db.Where("follower_id = ? AND followee_id = ?", followerID, followeeID).Delete(&model.UserFollow{}).Error
}

func (r *Repository) UserFollowees(followerID string, followeeIDs []string) (map[string]bool, error) {
	result := map[string]bool{}
	if followerID == "" || len(followeeIDs) == 0 {
		return result, nil
	}
	var ids []string
	if err := r.db.Model(&model.UserFollow{}).Where("follower_id = ? AND followee_id IN ?", followerID, followeeIDs).Pluck("followee_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		result[id] = true
	}
	return result, nil
}

func (r *Repository) UserHasCanvasTemplateWithStatus(userID string, status model.CanvasTemplateStatus) (bool, error) {
	var count int64
	err := r.db.Model(&model.CanvasTemplate{}).Where("user_id = ? AND status = ?", userID, status).Limit(1).Count(&count).Error
	return count > 0, err
}

// UpsertCanvasTemplateReport 每个用户对同一模版只保留一条举报（重复举报更新理由），并重算举报数。
func (r *Repository) UpsertCanvasTemplateReport(report *model.CanvasTemplateReport) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "template_id"}, {Name: "user_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"reason", "detail", "created_at"}),
		}).Create(report).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.CanvasTemplateReport{}).Where("template_id = ?", report.TemplateID).Count(&count).Error; err != nil {
			return err
		}
		return tx.Model(&model.CanvasTemplate{}).Where("id = ?", report.TemplateID).UpdateColumn("report_count", count).Error
	})
}

func (r *Repository) CanvasTemplateReports(templateID string, limit int) ([]model.CanvasTemplateReport, error) {
	var reports []model.CanvasTemplateReport
	err := r.db.Where("template_id = ?", templateID).Order("created_at DESC").Limit(limit).Find(&reports).Error
	return reports, err
}
