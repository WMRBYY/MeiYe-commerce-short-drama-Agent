package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func TestAgentHandoffHTTPWaitsBeforeHandler(t *testing.T) {
	path := filepath.Join(t.TempDir(), "handoff")
	t.Setenv("CANVAS_AGENT_HANDOFF_GATE_FILE", path)
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	var called atomic.Int32
	group := r.Group("/api", agentHandoffMiddleware(&service.Service{}))
	group.POST("/agent/runs/test", func(c *gin.Context) { called.Add(1); c.Status(http.StatusNoContent) })
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/agent/runs/test", nil).WithContext(ctx))
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("request returned while handoff is pending")
	case <-time.After(150 * time.Millisecond):
	}
	if called.Load() != 0 {
		t.Fatal("handler mutated state before admission")
	}
	cancel()
	<-done
	if called.Load() != 0 {
		t.Fatal("cancelled request reached handler")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/agent/runs/test", nil))
	if response.Code != http.StatusNoContent || called.Load() != 1 {
		t.Fatalf("request did not resume: code=%d calls=%d", response.Code, called.Load())
	}
}
