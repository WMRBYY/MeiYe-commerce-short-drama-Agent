package handler

import (
	"errors"
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterLogicalModelRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/models", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		models, err := svc.PublicLogicalModelsForUser(actor, nil)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
	r.POST("/models/available", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var intent service.ModelRequestIntent
		if err := c.ShouldBindJSON(&intent); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型能力请求格式错误"))
			return
		}
		models, err := svc.PublicLogicalModelsForUser(actor, &intent)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
	r.POST("/models/:id/quote", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var intent service.ModelRequestIntent
		if err := c.ShouldBindJSON(&intent); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型报价请求格式错误"))
			return
		}
		visibleModels, err := svc.PublicLogicalModelsForUser(actor, &intent)
		if err != nil {
			failService(c, err)
			return
		}
		visible := false
		for _, item := range visibleModels {
			if item.ID == c.Param("id") {
				visible = true
				break
			}
		}
		if !visible {
			fail(c, http.StatusForbidden, errors.New("该模型未向当前用户发布或暂不可用"))
			return
		}
		quote, err := svc.QuoteLogicalModel(actor.ID, c.Param("id"), intent)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"quote": quote})
	})
	// Read-only list for the AI 虚拟助手 settings page; the 前台模型 editor was removed.
	r.GET("/admin/logical-models", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		models, err := svc.AdminLogicalModels(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
}
