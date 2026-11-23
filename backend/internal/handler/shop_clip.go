package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func RegisterShopClipRoutes(r *gin.RouterGroup, svc *service.Service) {
	g := r.Group("/ecommerce/clips")
	g.GET("/capabilities", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, svc.ShopClipCapabilities(user.ID))
	})
	g.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.ShopClips(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items})
	})
	g.POST("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var req service.ShopClipCreateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("剪辑参数无效"))
			return
		}
		result, err := svc.CreateShopClip(c.Request.Context(), user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	g.GET("/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ShopClip(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	g.POST("/quote", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var req service.ShopClipCreateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("剪辑参数无效"))
			return
		}
		result, err := svc.QuoteShopClip(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
	g.PUT("/:id/plan", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var req struct {
			Plan service.ShopClipPlan `json:"plan"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("剪辑方案无效"))
			return
		}
		result, err := svc.UpdateShopClipPlan(c.Request.Context(), user.ID, c.Param("id"), req.Plan)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	for _, action := range []string{"render", "retry"} {
		action := action
		g.POST("/:id/"+action, func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
			var req service.ShopClipAttemptRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				failService(c, service.BadAuthRequest("剪辑提交参数无效"))
				return
			}
			result, err := svc.StartShopClipAttempt(c.Request.Context(), user.ID, c.Param("id"), req, action == "retry")
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, result)
		})
	}
	g.POST("/:id/cancel", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.CancelShopClip(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
