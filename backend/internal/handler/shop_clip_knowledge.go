package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func RegisterShopClipKnowledgeRoutes(r *gin.RouterGroup, svc *service.Service) {
	g := r.Group("/admin/shop-clips/knowledge")
	g.GET("", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ShopClipKnowledgeAdmin(actor)
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
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req struct {
			Entries []service.ShopClipKnowledgeEntry `json:"entries"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("剪辑知识库内容无效"))
			return
		}
		result, err := svc.UpdateShopClipKnowledge(actor, req.Entries)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
	g.GET("/categories", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page := 1
		if value := c.Query("page"); value != "" {
			page, err = strconv.Atoi(value)
			if err != nil || page < 1 {
				failService(c, service.BadAuthRequest("品类页码无效"))
				return
			}
		}
		result, err := svc.ShopClipKnowledgeCategoryList(actor, strings.TrimSpace(c.Query("parent")), strings.TrimSpace(c.Query("q")), page)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
}
