package app

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"yingce/backend/internal/model"
)

// 服务器本地缩略图：图片资源就绪后在 dataDir/thumbnails 生成一份小图，
// 画布、素材库等列表展示直接由本服务读取，查看大图时才去对象存储读取原件。
// 新资源复用上传时已经流过本机的字节生成；存量资源在首次请求缩略图时按需
// 从存储读取一次原件生成，之后不再为展示消耗对象存储流量。

const (
	thumbnailDirName         = "thumbnails"
	thumbnailStagingDirName  = ".staging"
	thumbnailMaxWidth        = 640
	thumbnailMaxHeight       = 1920
	thumbnailMaxSourceBytes  = 64 << 20
	thumbnailMaxSourcePixels = 40_000_000
	thumbnailJPEGQuality     = 82
	thumbnailWorkers         = 2
	thumbnailQueueSize       = 512
)

var errThumbnailUnsupported = errors.New("缩略图不支持该图片")

type thumbnailJob struct {
	userID     string
	resourceID string
	// sourcePath 是上传时暂存的原件副本；为空时从资源存储位置读取。
	sourcePath string
}

type thumbnailQueue struct {
	once     sync.Once
	jobs     chan thumbnailJob
	mu       sync.Mutex
	inflight map[string]chan struct{}
	retries  map[string]thumbnailRetry
}

// localThumbnailsEnabled 允许通过 CANVAS_LOCAL_THUMBNAILS=off 关闭生成（已生成的缩略图仍会使用）。
func localThumbnailsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CANVAS_LOCAL_THUMBNAILS"))) {
	case "off", "false", "0", "disabled":
		return false
	}
	return true
}

func thumbnailSourceMimeSupported(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif":
		return true
	}
	return false
}

// thumbnailPending 判断资源是否还需要生成缩略图（ready/none/failed 均为终态）。
func thumbnailPending(resource *model.Resource) bool {
	if resource == nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return false
	}
	switch resource.ThumbnailStatus {
	case model.ThumbnailStatusReady, model.ThumbnailStatusNone, model.ThumbnailStatusFailed:
		return false
	}
	return true
}

// enqueueResourceThumbnail 把缩略图生成放入有界后台队列；队列已满或已有同一资源在处理时直接放弃，
// 状态保持未生成，下次展示时再排队。sourcePath 无论是否入队都由本函数负责最终删除。
func (s *Service) enqueueResourceThumbnail(resource *model.Resource, sourcePath string) {
	if !localThumbnailsEnabled() || !thumbnailPending(resource) {
		removeThumbnailStaging(sourcePath)
		return
	}
	if !thumbnailSourceMimeSupported(resource.MimeType) || resource.Size > thumbnailMaxSourceBytes ||
		int64(resource.Width)*int64(resource.Height) > thumbnailMaxSourcePixels {
		removeThumbnailStaging(sourcePath)
		s.markResourceThumbnail(resource, model.ThumbnailStatusNone, "", 0, 0, 0)
		return
	}
	queue := s.localThumbnailQueue()
	if _, started := queue.begin(resource.ID, sourcePath != "", time.Now()); !started {
		removeThumbnailStaging(sourcePath)
		return
	}
	select {
	case queue.jobs <- thumbnailJob{userID: resource.UserID, resourceID: resource.ID, sourcePath: sourcePath}:
	default:
		queue.finish(resource.ID)
		removeThumbnailStaging(sourcePath)
	}
}

func (s *Service) runThumbnailWorker(queue *thumbnailQueue) {
	for job := range queue.jobs {
		s.runThumbnailJob(job)
		queue.finish(job.resourceID)
	}
}

// ensureResourceThumbnail 使首次缩略图访问等待服务器副本生成，避免把原图回落给浏览器。
// 上传后台任务已在运行时等待它结束；历史资源则在当前请求中生成一次。
func (s *Service) ensureResourceThumbnail(resource *model.Resource) {
	if !localThumbnailsEnabled() || !thumbnailPending(resource) {
		return
	}
	queue := s.localThumbnailQueue()
	done, started := queue.begin(resource.ID, false, time.Now())
	if started {
		s.runThumbnailJob(thumbnailJob{userID: resource.UserID, resourceID: resource.ID})
		queue.finish(resource.ID)
	} else if done != nil {
		<-done
	}
	if refreshed, err := s.repo.ResourceForUser(resource.UserID, resource.ID); err == nil && refreshed != nil {
		resource.ThumbnailStatus = refreshed.ThumbnailStatus
		resource.ThumbnailMimeType = refreshed.ThumbnailMimeType
		resource.ThumbnailSize = refreshed.ThumbnailSize
		resource.ThumbnailWidth = refreshed.ThumbnailWidth
		resource.ThumbnailHeight = refreshed.ThumbnailHeight
	}
}

func (s *Service) runThumbnailJob(job thumbnailJob) {
	defer removeThumbnailStaging(job.sourcePath)
	defer func() {
		if r := recover(); r != nil {
			slog.Warn("resource thumbnail panic", "resourceId", job.resourceID, "panic", fmt.Sprint(r))
		}
	}()
	resource, err := s.repo.ResourceForUser(job.userID, job.resourceID)
	if err != nil || !thumbnailPending(resource) {
		return
	}
	if !thumbnailSourceMimeSupported(resource.MimeType) || resource.Size > thumbnailMaxSourceBytes ||
		int64(resource.Width)*int64(resource.Height) > thumbnailMaxSourcePixels {
		s.markResourceThumbnail(resource, model.ThumbnailStatusNone, "", 0, 0, 0)
		return
	}
	data, err := s.readThumbnailSource(resource, job.sourcePath)
	if errors.Is(err, errThumbnailUnsupported) {
		s.markResourceThumbnail(resource, model.ThumbnailStatusNone, "", 0, 0, 0)
		return
	}
	if err != nil {
		// 保持资源可恢复，但刷新和并发列表不应反复读取失败的原件。
		s.thumbnails.sourceFailed(resource.ID, err, time.Now())
		slog.Warn("resource thumbnail source unavailable", "resourceId", resource.ID, "error", err)
		return
	}
	s.thumbnails.sourceSucceeded(resource.ID)
	encoded, mimeType, width, height, err := buildThumbnail(data, resource.MimeType)
	if errors.Is(err, errThumbnailUnsupported) {
		s.markResourceThumbnail(resource, model.ThumbnailStatusNone, "", 0, 0, 0)
		return
	}
	if err != nil {
		slog.Warn("resource thumbnail encode failed", "resourceId", resource.ID, "error", err)
		s.markResourceThumbnail(resource, model.ThumbnailStatusFailed, "", 0, 0, 0)
		return
	}
	path, err := s.resourceThumbnailPath(resource.ID, mimeType)
	if err == nil {
		err = writeFileAtomic(path, encoded)
	}
	if err != nil {
		slog.Warn("resource thumbnail write failed", "resourceId", resource.ID, "error", err)
		return
	}
	s.markResourceThumbnail(resource, model.ThumbnailStatusReady, mimeType, int64(len(encoded)), width, height)
}

func (s *Service) markResourceThumbnail(resource *model.Resource, status, mimeType string, size int64, width, height int) error {
	// 只写缩略图字段：整行 Save 会覆盖并发写入的其他字段；已删除的资源不会被复活。
	if _, err := s.repo.UpdateResourceThumbnail(resource.UserID, resource.ID, map[string]any{
		"thumbnail_status":    status,
		"thumbnail_mime_type": mimeType,
		"thumbnail_size":      size,
		"thumbnail_width":     width,
		"thumbnail_height":    height,
	}); err != nil {
		slog.Warn("resource thumbnail status update failed", "resourceId", resource.ID, "status", status, "error", err)
		return err
	}
	resource.ThumbnailStatus, resource.ThumbnailMimeType, resource.ThumbnailSize = status, mimeType, size
	resource.ThumbnailWidth, resource.ThumbnailHeight = width, height
	return nil
}

// readThumbnailSource 优先读上传暂存副本，其次本地原件，最后才从对象存储读取一次原件。
func (s *Service) readThumbnailSource(resource *model.Resource, sourcePath string) ([]byte, error) {
	var body io.ReadCloser
	switch {
	case sourcePath != "":
		file, err := os.Open(sourcePath)
		if err != nil {
			return nil, err
		}
		body = file
	default:
		stream, err := s.openResourceRange(resource.UserID, resource, "")
		if err != nil {
			return nil, err
		}
		if stream.StatusCode != 0 && stream.StatusCode != http.StatusOK {
			stream.Body.Close()
			return nil, fmt.Errorf("读取原件返回状态 %d", stream.StatusCode)
		}
		body = stream.Body
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, thumbnailMaxSourceBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > thumbnailMaxSourceBytes {
		return nil, errThumbnailUnsupported
	}
	return data, nil
}

// buildThumbnail 把原图缩放到 640px 宽（高不超过 1920px）以内：不透明图输出 JPEG，带透明通道输出 PNG。
// 原图本身已不超过尺寸且比重新编码更小时直接沿用原图字节。
func buildThumbnail(data []byte, sourceMime string) ([]byte, string, int, int, error) {
	return buildThumbnailAtSize(data, sourceMime, thumbnailMaxWidth, thumbnailMaxHeight)
}

func buildThumbnailAtSize(data []byte, sourceMime string, maxWidth, maxHeight int) ([]byte, string, int, int, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, errThumbnailUnsupported
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > thumbnailMaxSourcePixels {
		return nil, "", 0, 0, errThumbnailUnsupported
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, err
	}
	bounds := source.Bounds()
	scale := math.Min(1, math.Min(float64(maxWidth)/float64(bounds.Dx()), float64(maxHeight)/float64(bounds.Dy())))
	width := max(1, int(math.Round(float64(bounds.Dx())*scale)))
	height := max(1, int(math.Round(float64(bounds.Dy())*scale)))
	target := image.NewNRGBA(image.Rect(0, 0, width, height))
	if scale < 1 {
		xdraw.CatmullRom.Scale(target, target.Bounds(), source, bounds, xdraw.Src, nil)
	} else {
		xdraw.Draw(target, target.Bounds(), source, bounds.Min, xdraw.Src)
	}
	var out bytes.Buffer
	mimeType := "image/jpeg"
	if target.Opaque() {
		err = jpeg.Encode(&out, flattenOpaque(target), &jpeg.Options{Quality: thumbnailJPEGQuality})
	} else {
		mimeType = "image/png"
		err = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, target)
	}
	if err != nil {
		return nil, "", 0, 0, err
	}
	if scale >= 1 && len(data) <= out.Len() {
		original := strings.ToLower(strings.TrimSpace(sourceMime))
		if original == "image/jpg" {
			original = "image/jpeg"
		}
		if thumbnailSourceMimeSupported(original) {
			return data, original, width, height, nil
		}
	}
	return out.Bytes(), mimeType, width, height, nil
}

// flattenOpaque 把不透明 NRGBA 转为 RGBA，jpeg 编码器对 *image.RGBA 走快速路径。
func flattenOpaque(source *image.NRGBA) *image.RGBA {
	target := image.NewRGBA(source.Bounds())
	xdraw.Draw(target, target.Bounds(), source, source.Bounds().Min, xdraw.Src)
	return target
}

func thumbnailExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func (s *Service) resourceThumbnailPath(resourceID, mimeType string) (string, error) {
	id := strings.TrimSpace(resourceID)
	if len(id) < 2 || strings.ContainsAny(id, `/\.:`) {
		return "", fmt.Errorf("资源 ID %q 不能用于缩略图路径", resourceID)
	}
	return filepath.Join(s.dataDir, thumbnailDirName, id[:2], id+thumbnailExtension(mimeType)), nil
}

func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".thumb-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	_, writeErr := temp.Write(data)
	closeErr := temp.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return nil
}

// OpenResourceThumbnail 打开服务器本地缩略图；文件丢失时把状态重置为未生成，由下次展示重新生成。
func (s *Service) openResourceThumbnail(resource *model.Resource, small bool) (*ResourceStream, error) {
	path, err := s.resourceThumbnailPath(resource.ID, resource.ThumbnailMimeType)
	if err != nil {
		return nil, err
	}
	mimeType, width, height := resource.ThumbnailMimeType, resource.ThumbnailWidth, resource.ThumbnailHeight
	if small {
		path, mimeType, width, height, err = smallThumbnailFile(path, mimeType)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				_ = s.markResourceThumbnail(resource, "", "", 0, 0, 0)
			}
			return nil, err
		}
	}
	body, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			s.markResourceThumbnail(resource, "", "", 0, 0, 0)
		}
		return nil, err
	}
	size := int64(0)
	if info, statErr := body.Stat(); statErr == nil {
		size = info.Size()
	}
	thumbnail := *resource
	thumbnail.MimeType = mimeType
	thumbnail.Size = size
	thumbnail.Width, thumbnail.Height = width, height
	thumbnail.ObjectKey = filepath.ToSlash(filepath.Join(thumbnailDirName, filepath.Base(path)))
	return &ResourceStream{Resource: &thumbnail, Body: body, StatusCode: http.StatusOK, ContentLength: size, AcceptRanges: "bytes"}, nil
}

func (s *Service) removeResourceThumbnails(resourceID string) {
	if base, err := s.resourceThumbnailPath(resourceID, "image/jpeg"); err == nil {
		removeSmallThumbnailFiles(base)
	}
	for _, mimeType := range []string{"image/jpeg", "image/png", "image/webp"} {
		path, err := s.resourceThumbnailPath(resourceID, mimeType)
		if err != nil {
			return
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("resource thumbnail cleanup failed", "resourceId", resourceID, "error", err)
		}
	}
}

// beginThumbnailStaging 让新上传/新生成的图片无需再从对象存储读回即可生成缩略图：
// 可 Seek 的来源（上传文件、生成结果暂存文件）在原件写入成功后回到起点复制一份到本地暂存；
// 不可 Seek 的流在写入存储的同时旁路复制。返回的 finish(stored) 给出暂存路径（失败或不适用时为空）。
// 存储驱动会对 io.ReadSeeker 走免缓冲路径，所以可 Seek 的来源不能包一层 TeeReader。
func (s *Service) beginThumbnailStaging(kind, mimeType string, size int64, body io.Reader) (io.Reader, func(stored bool) string) {
	skip := func(bool) string { return "" }
	if body == nil || kind != "image" || !localThumbnailsEnabled() || !thumbnailSourceMimeSupported(mimeType) || size > thumbnailMaxSourceBytes {
		return body, skip
	}
	if seeker, ok := body.(io.ReadSeeker); ok {
		start, err := seeker.Seek(0, io.SeekCurrent)
		if err != nil {
			return body, skip
		}
		return body, func(stored bool) string {
			if !stored {
				return ""
			}
			if _, err := seeker.Seek(start, io.SeekStart); err != nil {
				return ""
			}
			writer := s.newThumbnailStaging()
			if writer == nil {
				return ""
			}
			_, _ = io.Copy(writer, io.LimitReader(seeker, thumbnailMaxSourceBytes+1))
			return writer.finish(size)
		}
	}
	writer := s.newThumbnailStaging()
	if writer == nil {
		return body, skip
	}
	return io.TeeReader(body, writer), func(stored bool) string {
		path := writer.finish(size)
		if !stored {
			removeThumbnailStaging(path)
			return ""
		}
		return path
	}
}

// thumbnailStagingWriter 把原件字节复制到本地暂存文件；任何写入失败只放弃暂存，不影响原件写入。
type thumbnailStagingWriter struct {
	file    *os.File
	written int64
	failed  bool
}

func (s *Service) newThumbnailStaging() *thumbnailStagingWriter {
	dir := filepath.Join(s.dataDir, thumbnailDirName, thumbnailStagingDirName)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil
	}
	file, err := os.CreateTemp(dir, "src-*")
	if err != nil {
		return nil
	}
	return &thumbnailStagingWriter{file: file}
}

func (w *thumbnailStagingWriter) Write(p []byte) (int, error) {
	if w.failed {
		return len(p), nil
	}
	if w.written+int64(len(p)) > thumbnailMaxSourceBytes {
		w.failed = true
		return len(p), nil
	}
	n, err := w.file.Write(p)
	w.written += int64(n)
	if err != nil {
		w.failed = true
	}
	// 暂存失败不能影响原件写入，始终报告写满。
	return len(p), nil
}

// finish 关闭暂存文件；只有字节数与资源一致时返回路径，否则删除并返回空串。
func (w *thumbnailStagingWriter) finish(expectedSize int64) string {
	if w == nil {
		return ""
	}
	path := w.file.Name()
	closeErr := w.file.Close()
	if w.failed || closeErr != nil || w.written == 0 || (expectedSize > 0 && w.written != expectedSize) {
		removeThumbnailStaging(path)
		return ""
	}
	return path
}

func removeThumbnailStaging(path string) {
	if path == "" {
		return
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Warn("resource thumbnail staging cleanup failed", "path", path, "error", err)
	}
}

// CleanupThumbnailStaging 在启动时清掉上次进程遗留的暂存原件（只删 1 小时前的，避免误删其他实例正在用的文件）。
func (s *Service) CleanupThumbnailStaging() {
	dir := filepath.Join(s.dataDir, thumbnailDirName, thumbnailStagingDirName)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-time.Hour)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "src-") {
			continue
		}
		if info, err := entry.Info(); err == nil && info.ModTime().Before(cutoff) {
			removeThumbnailStaging(filepath.Join(dir, entry.Name()))
		}
	}
}
