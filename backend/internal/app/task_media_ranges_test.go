package app

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMediaRangesAssembleExactVideoAndPreserveHeaders(t *testing.T) {
	for _, broken := range []string{"", "range", "etag", "short", "transient"} {
		t.Run(broken, func(t *testing.T) {
			data := bytes.Repeat([]byte("exact-video-payload"), 100000)
			var firstChunkAttempts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("If-Range") != `"stable"` || r.Header.Get("Authorization") != "Bearer origin-only" || r.Header.Get("Accept-Encoding") != "identity" {
					t.Error("range headers changed")
				}
				var start, end int64
				if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("ETag", `"stable"`)
				w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(data)))
				if end > 0 && broken == "range" {
					w.Header().Set("Content-Range", "bytes 0-1/2")
				}
				if end > 0 && broken == "etag" {
					w.Header().Set("ETag", `"changed"`)
				}
				if broken == "transient" && start == 0 && end > 0 && firstChunkAttempts.Add(1) == 1 {
					w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
					w.WriteHeader(206)
					w.Write(data[start : (start+end)/2])
					return
				}
				w.WriteHeader(206)
				if end > 0 && broken == "short" {
					end--
				}
				w.Write(data[start : end+1])
			}))
			defer server.Close()
			file, _ := os.CreateTemp(t.TempDir(), "video")
			defer file.Close()
			req, _ := http.NewRequest("GET", server.URL, nil)
			req.Header.Set("Authorization", "Bearer origin-only")
			initial := &http.Response{ContentLength: int64(len(data)), Header: http.Header{"Etag": {`"stable"`}}, Body: io.NopCloser(bytes.NewReader(data))}
			stall := time.NewTimer(time.Minute)
			defer stall.Stop()
			used, size, err := downloadMediaRanges(context.Background(), server.Client(), req, initial, file, stall)
			if !used {
				t.Fatal("did not use valid ranges")
			}
			if broken != "" && broken != "transient" {
				if err == nil {
					t.Fatal("corrupt response accepted")
				}
				return
			}
			if err != nil || size != int64(len(data)) {
				t.Fatalf("size=%d err=%v", size, err)
			}
			file.Seek(0, io.SeekStart)
			actual, _ := io.ReadAll(file)
			if !bytes.Equal(actual, data) {
				t.Fatal("assembled video differs")
			}
			if broken == "transient" && firstChunkAttempts.Load() != 2 {
				t.Fatal("partial chunk was not replayed exactly once")
			}
		})
	}
}

func TestMediaRangesUnsupportedAndCanceled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("whole-file")) }))
	defer server.Close()
	req, _ := http.NewRequest("GET", server.URL, nil)
	file, _ := os.CreateTemp(t.TempDir(), "video")
	defer file.Close()
	stall := time.NewTimer(time.Minute)
	defer stall.Stop()
	initial := &http.Response{ContentLength: 10, Header: http.Header{"Etag": {`"stable"`}}, Body: io.NopCloser(strings.NewReader("whole-file"))}
	used, _, err := downloadMediaRanges(context.Background(), server.Client(), req, initial, file, stall)
	if used || err != nil {
		t.Fatalf("fallback: %v %v", used, err)
	}
	data, _ := io.ReadAll(initial.Body)
	if string(data) != "whole-file" {
		t.Fatal("fallback consumed original response")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	used, _, err = downloadMediaRanges(ctx, server.Client(), req, initial, file, stall)
	if !used || err == nil {
		t.Fatal("cancellation ignored")
	}
}

func TestParallelVideoDownloadEligibility(t *testing.T) {
	r := &http.Response{ContentLength: 9 << 20, Header: http.Header{"Etag": {`"stable"`}, "Accept-Ranges": {"bytes"}}}
	if !parallelVideoDownload("video", r) || parallelVideoDownload("image", r) {
		t.Fatal("wrong media eligibility")
	}
	r.Header.Set("ETag", `W/"weak"`)
	if parallelVideoDownload("video", r) {
		t.Fatal("weak object identity accepted")
	}
}
