package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func registerEcommerceTextRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/ecommerce/detail/text-detection", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var req struct {
			ResourceID string `json:"resourceId" binding:"required,max=256"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.DetectEcommerceImageText(c.Request.Context(), user.ID, req.ResourceID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
