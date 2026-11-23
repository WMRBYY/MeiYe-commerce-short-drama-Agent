package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Only large videos with a strong, stable object identifier use parallel reads.
// Images and servers without explicit byte-range support retain the original GET.
func parallelVideoDownload(mode string, response *http.Response) bool {
	etag := strings.TrimSpace(response.Header.Get("ETag"))
	return mode == "video" && response.ContentLength >= 8<<20 &&
		strings.EqualFold(response.Header.Get("Accept-Ranges"), "bytes") &&
		etag != "" && !strings.HasPrefix(etag, "W/") && response.Header.Get("Content-Encoding") == ""
}

func mediaRangeRequest(ctx context.Context, original *http.Request, start, end int64, etag string) *http.Request {
	req := original.Clone(ctx)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	req.Header.Set("If-Range", etag)
	req.Header.Set("Accept-Encoding", "identity")
	return req
}

func validMediaRange(response *http.Response, start, end, total int64, etag string) bool {
	return response.StatusCode == http.StatusPartialContent &&
		response.Header.Get("Content-Range") == fmt.Sprintf("bytes %d-%d/%d", start, end, total) &&
		response.Header.Get("ETag") == etag &&
		(response.ContentLength < 0 || response.ContentLength == end-start+1) &&
		(response.Header.Get("Content-Encoding") == "" || response.Header.Get("Content-Encoding") == "identity")
}

const mediaRangeChunkBytes int64 = 512 << 10

func downloadMediaRangePart(ctx context.Context, client *http.Client, req *http.Request, file *os.File, start, end, total int64, etag string, stall *time.Timer) error {
	partCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	response, err := client.Do(mediaRangeRequest(partCtx, req, start, end, etag))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusPartialContent {
		return providerHTTPError{StatusCode: response.StatusCode, Status: "结果分段响应异常", RetryAfter: parseRetryAfter(response.Header.Get("Retry-After"), time.Now())}
	}
	if !validMediaRange(response, start, end, total, etag) {
		return errors.New("结果分段响应与原文件不一致")
	}
	reader := mediaDownloadProgress{reader: response.Body, stall: stall}
	if _, err := io.CopyN(io.NewOffsetWriter(file, start), reader, end-start+1); err != nil {
		return err
	}
	var extra [1]byte
	if count, err := reader.Read(extra[:]); count != 0 || err != io.EOF {
		if err == nil {
			err = errors.New("结果分段长度不一致")
		}
		return err
	}
	return nil
}

// Probe before closing the initial GET. Unsupported or inconsistent ranges fall
// back to that untouched response; errors after parallel writes fail the attempt
// so recovery never registers a partially assembled file.
func downloadMediaRanges(ctx context.Context, client *http.Client, req *http.Request, initial *http.Response, file *os.File, stall *time.Timer) (used bool, size int64, err error) {
	total, etag := initial.ContentLength, initial.Header.Get("ETag")
	probe, err := client.Do(mediaRangeRequest(ctx, req, 0, 0, etag))
	if err != nil {
		if ctx.Err() != nil {
			return true, 0, ctx.Err()
		}
		return false, 0, nil
	}
	valid := validMediaRange(probe, 0, 0, total, etag)
	if valid {
		data, readErr := io.ReadAll(io.LimitReader(mediaDownloadProgress{reader: probe.Body, stall: stall}, 2))
		valid = readErr == nil && len(data) == 1
	}
	probe.Body.Close()
	if !valid {
		return false, 0, nil
	}
	initial.Body.Close()
	parallelCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	var once sync.Once
	var failure error
	fail := func(err error) { once.Do(func() { failure = err; cancel() }) }
	var queueMu sync.Mutex
	var next int64
	claim := func() (int64, int64, bool) {
		queueMu.Lock()
		defer queueMu.Unlock()
		if next >= total {
			return 0, 0, false
		}
		start := next
		end := min(total, start+mediaRangeChunkBytes) - 1
		next = end + 1
		return start, end, true
	}
	const workers = 4
	for index := 0; index < workers; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for parallelCtx.Err() == nil {
				start, end, ok := claim()
				if !ok {
					return
				}
				for attempt := 0; ; attempt++ {
					partErr := downloadMediaRangePart(parallelCtx, client, req, file, start, end, total, etag, stall)
					if partErr == nil {
						break
					}
					if attempt >= 2 || parallelCtx.Err() != nil || !retryableMediaRecovery(partErr) {
						fail(partErr)
						return
					}
					if err := sleepContext(parallelCtx, max(time.Duration(attempt+1)*time.Second, providerRetryAfter(partErr))); err != nil {
						fail(err)
						return
					}
				}
			}
		}()
	}
	wg.Wait()
	if failure != nil {
		return true, 0, failure
	}
	if ctx.Err() != nil {
		return true, 0, ctx.Err()
	}
	return true, total, nil
}
