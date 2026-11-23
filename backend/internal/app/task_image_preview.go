package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

// 生成中预览只读：不提交生成、不改媒体/计费状态。
//
// 预览只用已经落到本机的字节（暂存文件或已登记资源），不再另外去上游拉原图：
// 上游临时链接往往很慢，预览再拉一遍会和正式下载抢同一条带宽，4K 批量时
// 下载、上传都被拖慢一倍。暂存文件一落地就缩成长边 taskPreviewMaxEdge 的小图
// 给前端展示，避免每张几 MB 的原图再占服务器出口带宽。
const (
	taskPreviewMaxEdge    = 1280
	taskPreviewCacheLimit = 64
	taskPreviewCacheTTL   = 15 * time.Minute
)

var errTaskPreviewNotReady = NewAppError(http.StatusConflict, "图片正在从上游取回，稍后自动显示")

// 解码 4K PNG 约占几十 MB 内存，限制同时缩图数量。
var taskPreviewBuildSlots = make(chan struct{}, 2)

type taskPreviewEntry struct {
	source   string
	ready    chan struct{}
	data     []byte
	mimeType string
	err      error
	created  time.Time
}

type taskPreviewStore struct {
	mu      sync.Mutex
	entries map[string]*taskPreviewEntry
}

var taskPreviews = &taskPreviewStore{entries: map[string]*taskPreviewEntry{}}

// cached 返回该任务已经生成好的预览（暂存文件已交接给对象存储后仍可用）。
func (c *taskPreviewStore) cached(key string) *taskPreviewEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry := c.entries[key]
	if entry == nil || time.Since(entry.created) > taskPreviewCacheTTL {
		return nil
	}
	select {
	case <-entry.ready:
		if entry.err != nil {
			return nil
		}
		return entry
	default:
		return nil
	}
}

func (c *taskPreviewStore) load(ctx context.Context, key, source string, build func() ([]byte, string, error)) (*taskPreviewEntry, error) {
	c.mu.Lock()
	entry := c.entries[key]
	if entry != nil && (entry.source != source || time.Since(entry.created) > taskPreviewCacheTTL) {
		select {
		case <-entry.ready:
			delete(c.entries, key)
			entry = nil
		default:
		}
	}
	if entry == nil {
		entry = &taskPreviewEntry{source: source, ready: make(chan struct{}), created: time.Now()}
		c.entries[key] = entry
		c.evictLocked()
		c.mu.Unlock()
		entry.data, entry.mimeType, entry.err = build()
		close(entry.ready)
		if entry.err != nil {
			c.mu.Lock()
			if c.entries[key] == entry {
				delete(c.entries, key)
			}
			c.mu.Unlock()
		}
	} else {
		c.mu.Unlock()
	}
	select {
	case <-entry.ready:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if entry.err != nil {
		return nil, entry.err
	}
	return entry, nil
}

func (c *taskPreviewStore) evictLocked() {
	for len(c.entries) > taskPreviewCacheLimit {
		oldestKey := ""
		var oldest time.Time
		for key, entry := range c.entries {
			select {
			case <-entry.ready:
			default:
				continue
			}
			if oldestKey == "" || entry.created.Before(oldest) {
				oldestKey, oldest = key, entry.created
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.entries, oldestKey)
	}
}

func taskPreviewStream(entry *taskPreviewEntry) *ResourceStream {
	return &ResourceStream{Resource: &model.Resource{MimeType: entry.mimeType}, Body: io.NopCloser(bytes.NewReader(entry.data)), StatusCode: http.StatusOK, ContentLength: int64(len(entry.data))}
}

func (s *Service) OpenTaskImagePreview(ctx context.Context, userID, id string) (*ResourceStream, error) {
	task, err := s.repo.TaskForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("任务不存在")
	}
	if err != nil {
		return nil, err
	}
	if task.Type != "canvas_image" {
		return nil, BadAuthRequest("该任务没有图片预览")
	}
	cacheKey := userID + "/" + task.ID
	if entry := taskPreviews.cached(cacheKey); entry != nil {
		return taskPreviewStream(entry), nil
	}
	if url, _ := taskMediaPreview(task.ResultJSON, task.Type); isResourceFileURL(url) {
		return s.openTaskPreviewResource(userID, canvasResourceID(url))
	}
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil || checkpoint.Mode != "image" || len(checkpoint.Items) == 0 {
		return nil, BadAuthRequest("图片预览暂不可用")
	}
	item := checkpoint.Items[0]
	// Staging is deleted after durable storage, before the task result is committed.
	// Keep preview available across that handoff, including inline-only results.
	if item.ResourceID != "" {
		return s.openTaskPreviewResource(userID, item.ResourceID)
	}
	path := s.mediaTempPath(item.TempName)
	if path == "" {
		// 还在从上游下载：快速返回，前端稍后重试，不重复拉取上游原图。
		return nil, errTaskPreviewNotReady
	}
	entry, err := taskPreviews.load(ctx, cacheKey, item.TempName, func() ([]byte, string, error) {
		return s.buildTaskPreviewFromFile(ctx, path)
	})
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// 暂存文件刚交接给对象存储，下次请求会读到已登记资源。
			return nil, errTaskPreviewNotReady
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, BadAuthRequest("图片预览暂不可用")
	}
	return taskPreviewStream(entry), nil
}

func (s *Service) buildTaskPreviewFromFile(ctx context.Context, path string) ([]byte, string, error) {
	select {
	case taskPreviewBuildSlots <- struct{}{}:
		defer func() { <-taskPreviewBuildSlots }()
	case <-ctx.Done():
		return nil, "", ctx.Err()
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, "", err
	}
	if !info.Mode().IsRegular() || info.Size() > thumbnailMaxSourceBytes {
		return nil, "", errThumbnailUnsupported
	}
	data, err := io.ReadAll(io.LimitReader(file, thumbnailMaxSourceBytes))
	if err != nil {
		return nil, "", err
	}
	mimeType := http.DetectContentType(data)
	if !strings.HasPrefix(mimeType, "image/") || mimeType == "image/svg+xml" {
		return nil, "", errThumbnailUnsupported
	}
	preview, previewMime, _, _, err := buildThumbnailAtSize(data, mimeType, taskPreviewMaxEdge, taskPreviewMaxEdge)
	if err != nil {
		// 解码失败（格式不支持、像素超限）时退回原图，仍比等上传完再显示快。
		return data, mimeType, nil
	}
	return preview, previewMime, nil
}

// 已登记资源优先读本机缩略图，避免为了预览再从对象存储拉几 MB 原图。
func (s *Service) openTaskPreviewResource(userID, resourceID string) (*ResourceStream, error) {
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return nil, err
	}
	if resource.ThumbnailStatus == model.ThumbnailStatusReady {
		if stream, err := s.openResourceThumbnail(resource, false); err == nil {
			return stream, nil
		}
	}
	return s.openResourceRange(userID, resource, "")
}
