package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/platform"

	"github.com/gin-gonic/gin"
)

func TestTrustedProxyClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, trusted, remote, forwarded, want string
	}{
		{"untrusted header ignored", "192.0.2.10", "198.51.100.8:1234", "203.0.113.99", "198.51.100.8"},
		{"web proxy accepted", "192.0.2.10", "192.0.2.10:1234", "198.51.100.8", "198.51.100.8"},
		{"empty trust fails closed", "", "192.0.2.10:1234", "203.0.113.99", "192.0.2.10"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			if err := configureTrustedProxies(r, tc.trusted); err != nil { t.Fatal(err) }
			r.GET("/ip", func(c *gin.Context) { c.String(http.StatusOK, c.ClientIP()) })
			req := httptest.NewRequest(http.MethodGet, "/ip", nil)
			req.RemoteAddr = tc.remote
			req.Header.Set("X-Forwarded-For", tc.forwarded)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Body.String() != tc.want { t.Fatalf("ClientIP = %q, want %q", w.Body.String(), tc.want) }
		})
	}
}

func TestForgedForwardingCannotResetLoginIPLimit(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	coordinator, err := platform.NewCoordinator("sqlite")
	if err != nil { t.Fatal(err) }
	r := gin.New()
	r.RemoteIPHeaders = []string{"X-Forwarded-For"}
	if err := configureTrustedProxies(r, "192.0.2.10"); err != nil { t.Fatal(err) }
	r.POST("/login", func(c *gin.Context) {
		allowed, err := coordinator.Allow(c.Request.Context(), "login-ip:"+c.ClientIP(), 2, time.Minute)
		if err != nil { t.Fatal(err) }
		if !allowed { c.Status(http.StatusTooManyRequests); return }
		c.Status(http.StatusUnauthorized)
	})
	for attempt, fakeIP := range []string{"203.0.113.1", "203.0.113.2", "203.0.113.3"} {
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		req.RemoteAddr = "198.51.100.8:1234"
		req.Header.Set("X-Forwarded-For", fakeIP)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		want := http.StatusUnauthorized
		if attempt == 2 { want = http.StatusTooManyRequests }
		if w.Code != want { t.Fatalf("attempt %d status = %d, want %d", attempt+1, w.Code, want) }
	}
}

func TestTrustedProxyRejectsGlobalTrust(t *testing.T) {
	for _, value := range []string{"0.0.0.0/0", "::/0", "invalid"} {
		if err := configureTrustedProxies(gin.New(), value); err == nil { t.Fatalf("accepted %q", value) }
	}
}
