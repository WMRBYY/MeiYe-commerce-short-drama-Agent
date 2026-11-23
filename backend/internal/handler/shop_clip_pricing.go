package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func RegisterShopClipPricingRoutes(r *gin.RouterGroup, svc *service.Service) {
	g := r.Group("/admin/shop-clips/pricing")
	g.GET("", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ShopClipPricingAdmin(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
	g.PUT("", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var input service.ShopClipPricingUpdate
		if err := c.ShouldBindJSON(&input); err != nil {
			failService(c, service.BadAuthRequest("每条剪辑积分需为 0 至 100000 的整数"))
			return
		}
		result, err := svc.UpdateShopClipPricing(actor, input)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
}
