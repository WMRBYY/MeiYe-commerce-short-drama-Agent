package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOriginObjectCancellationStopsHeadersAndBody(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, provider := range []string{aliyunOSSProvider, tencentCOSProvider, s3Provider} {
		for _, phase := range []string{"headers", "body"} {
			t.Run(provider+"/"+phase, func(t *testing.T) {
				started, disconnected := make(chan struct{}), make(chan struct{})
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if phase == "body" {
						w.Header().Set("Content-Length", "100")
						_, _ = io.WriteString(w, "part")
						w.(http.Flusher).Flush()
					}
					close(started)
					<-r.Context().Done()
					close(disconnected)
				}))
				t.Cleanup(server.Close)
				t.Cleanup(server.CloseClientConnections)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				done := make(chan error, 1)
				setting := Settings{Provider: provider, Region: "test-region", Endpoint: server.URL, Bucket: "bucket", AccessKeyID: "fixture-id", AccessKeySecret: "fixture-secret"}
				go func() {
					stream, err := GetOriginObjectRangeContext(ctx, setting, "reference.png", "")
					if err == nil {
						_, err = io.Copy(io.Discard, stream.Body)
						_ = stream.Body.Close()
					}
					done <- err
				}()
				select {
				case <-started:
				case err := <-done:
					t.Fatalf("origin read ended before fixture: %v", err)
				case <-time.After(3 * time.Second):
					t.Fatal("origin request did not reach fixture")
				}
				cancel()
				select {
				case err := <-done:
					if err == nil {
						t.Fatal("cancelled origin read succeeded")
					}
				case <-time.After(time.Second):
					t.Fatal("cancelled origin read kept waiting for storage timeout")
				}
				select {
				case <-disconnected:
				case <-time.After(time.Second):
					t.Fatal("cancel did not close the origin HTTP request")
				}
			})
		}
	}
}
