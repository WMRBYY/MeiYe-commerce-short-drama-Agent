package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterStorageGrantRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/resources/storage-grants", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		grants, err := svc.UserStorageGrants(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"grants": grants})
	})
	r.GET("/admin/users/:id/storage", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		storage, err := svc.AdminUserStorage(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, storage)
	})
	r.POST("/admin/users/:id/storage-grants", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.AdminStorageGrantRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		grant, err := svc.AdminGrantUserStorage(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"grant": grant})
	})
	r.GET("/admin/storage-quota", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.AdminStorageQuotaOverview(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})
	r.PUT("/admin/storage-quota/default", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req service.AdminStorageQuotaDefaultRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		overview, err := svc.AdminUpdateDefaultStorageQuota(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})
	r.PUT("/admin/users/:id/storage-quota", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req service.AdminUserStorageQuotaRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		storage, err := svc.AdminSetUserStorageQuota(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, storage)
	})
	r.POST("/admin/storage-grants/:id/revoke", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.RevokeStorageGrantRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		grant, err := svc.AdminRevokeUserStorageGrant(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"grant": grant})
	})
}
