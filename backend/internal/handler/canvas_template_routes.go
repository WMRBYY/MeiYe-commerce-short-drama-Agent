package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterCanvasTemplateRoutes 注册画布模版投稿、公开作品区、点赞/关注/举报和后台审核接口。
func RegisterCanvasTemplateRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/canvas-templates/:id/remix", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "ecommerce-work-remix:"+user.ID, 10, time.Minute) {
			return
		}
		result, err := svc.RemixEcommerceWork(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/public/canvas-authors/:id/avatar", func(c *gin.Context) {
		payload, err := svc.PublicCanvasAuthorAvatar(c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "public, max-age=300")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(http.StatusOK, "image/png", payload)
	})
	r.POST("/canvas-templates", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "canvas-template-submit:"+user.ID, 10, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req service.CanvasTemplateSubmitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errors.New("投稿内容格式无效"))
			return
		}
		template, err := svc.SubmitCanvasTemplate(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"template": template})
	})

	r.GET("/canvas-templates/mine", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		templates, err := svc.MyCanvasTemplates(user, c.Query("canvasId"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"items": templates})
	})

	setLike := func(liked bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if !enforceRateLimit(c, "canvas-template-like:"+user.ID, 60, time.Minute) {
				return
			}
			result, err := svc.SetCanvasTemplateLike(user, c.Param("id"), liked)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, result)
		}
	}
	r.POST("/canvas-templates/:id/like", setLike(true))
	r.DELETE("/canvas-templates/:id/like", setLike(false))

	r.POST("/canvas-templates/:id/report", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "canvas-template-report:"+user.ID, 10, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req service.CanvasTemplateReportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errors.New("举报内容格式无效"))
			return
		}
		if err := svc.ReportCanvasTemplate(user, c.Param("id"), req); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"reported": true})
	})

	setFollow := func(followed bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if !enforceRateLimit(c, "user-follow:"+user.ID, 60, time.Minute) {
				return
			}
			result, err := svc.SetUserFollow(user, c.Param("id"), followed)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, result)
		}
	}
	r.POST("/users/:id/follow", setFollow(true))
	r.DELETE("/users/:id/follow", setFollow(false))

	r.GET("/public/canvas-templates", func(c *gin.Context) {
		if !enforceRateLimit(c, "public-canvas-templates:"+c.ClientIP(), 120, time.Minute) {
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 24)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		list, err := svc.PublicCanvasTemplates(canvasTemplateViewer(c, svc), service.CanvasTemplateQuery{Category: c.Query("category"), Keyword: c.Query("q"), Page: page, PageSize: pageSize})
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, list)
	})

	r.GET("/public/canvas-templates/:id", func(c *gin.Context) {
		if !enforceRateLimit(c, "public-canvas-templates:"+c.ClientIP(), 120, time.Minute) {
			return
		}
		template, err := svc.PublicCanvasTemplate(canvasTemplateViewer(c, svc), c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"template": template})
	})

	r.GET("/public/canvas-templates/:id/canvas", func(c *gin.Context) {
		if !enforceRateLimit(c, "public-canvas-template-canvas:"+c.ClientIP(), 60, time.Minute) {
			return
		}
		project, err := svc.PublicCanvasTemplateCanvas(c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		c.Header("X-Robots-Tag", "noindex, nofollow")
		ok(c, project)
	})

	r.GET("/public/canvas-templates/:id/resources/:resourceId/file", func(c *gin.Context) {
		// 视频播放会产生大量 Range 请求，大画布还要加载全部缩略图，限额比分享页宽。
		if !enforceRateLimit(c, "public-canvas-template-resource:"+c.ClientIP(), 900, time.Minute) {
			return
		}
		delivery, err := svc.PreparePublicCanvasTemplateResourceDelivery(c.Param("id"), c.Param("resourceId"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Security-Policy", "sandbox")
		c.Header("X-Robots-Tag", "noindex, nofollow")
		serveResourceDelivery(c, delivery, "private, no-cache", canvasTemplateDisposition(c))
	})

	r.GET("/admin/canvas-templates", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 24)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		list, err := svc.AdminCanvasTemplates(user, service.CanvasTemplateQuery{Status: c.Query("status"), Category: c.Query("category"), Keyword: c.Query("q"), Page: page, PageSize: pageSize})
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, list)
	})

	r.GET("/admin/canvas-templates/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.AdminCanvasTemplate(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, detail)
	})

	r.POST("/admin/canvas-templates/:id/review", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req service.CanvasTemplateReviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errors.New("审核内容格式无效"))
			return
		}
		template, err := svc.ReviewCanvasTemplate(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"template": template})
	})

	r.GET("/admin/canvas-templates/:id/resources/:resourceId/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareAdminCanvasTemplateResourceDelivery(user, c.Param("id"), c.Param("resourceId"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Security-Policy", "sandbox")
		serveResourceDelivery(c, delivery, "private, no-cache", canvasTemplateDisposition(c))
	})
}

// canvasTemplateViewer 读取可选登录态：公开接口未登录也可访问，登录后附带点赞和关注状态。
func canvasTemplateViewer(c *gin.Context, svc *service.Service) *model.User {
	if strings.TrimSpace(sessionCookie(c)) == "" {
		return nil
	}
	user, err := currentUser(c, svc)
	if err != nil {
		return nil
	}
	return user
}

func canvasTemplateDisposition(c *gin.Context) string {
	if c.Query("download") == "1" {
		return "attachment"
	}
	return ""
}
