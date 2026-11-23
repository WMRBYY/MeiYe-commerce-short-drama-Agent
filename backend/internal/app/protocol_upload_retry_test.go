package app

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestProtocolUploadPUTReplaysCompleteBodyAfterTimeout(t *testing.T) {
	req, _ := http.NewRequestWithContext(context.Background(), "PUT", "https://upload.example/object", strings.NewReader("complete-file"))
	req.Header.Set("Content-Type", "image/png")
	calls := 0
	err := executeProtocolUploadTransfer(req, func(r *http.Request) ([]byte, string, error) {
		calls++
		data, _ := io.ReadAll(r.Body)
		r.Body.Close()
		if string(data) != "complete-file" || r.Header.Get("Content-Type") != "image/png" {
			t.Fatal("body/headers changed")
		}
		if calls == 1 {
			return nil, "", &url.Error{Op: "Put", URL: r.URL.String(), Err: errors.Join(&net.OpError{Op: "dial", Err: context.DeadlineExceeded}, &net.OpError{Op: "dial", Err: context.DeadlineExceeded})}
		}
		return nil, "", nil
	})
	if err != nil || calls != 2 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}
func TestProtocolUploadDoesNotReplayPOSTOrClientErrors(t *testing.T) {
	for _, method := range []string{"POST", "PUT"} {
		req, _ := http.NewRequest(method, "https://upload.example/object", strings.NewReader("file"))
		calls := 0
		err := executeProtocolUploadTransfer(req, func(*http.Request) ([]byte, string, error) {
			calls++
			if method == "POST" {
				return nil, "", &net.OpError{Op: "dial", Err: context.DeadlineExceeded}
			}
			return nil, "", providerHTTPError{StatusCode: 403}
		})
		if err == nil || calls != 1 {
			t.Fatalf("method=%s calls=%d err=%v", method, calls, err)
		}
	}
}
func TestProtocolUploadCancellationStopsRetry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "PUT", "https://upload.example/object", strings.NewReader("file"))
	calls := 0
	err := executeProtocolUploadTransfer(req, func(*http.Request) ([]byte, string, error) { calls++; cancel(); return nil, "", context.Canceled })
	if !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}
