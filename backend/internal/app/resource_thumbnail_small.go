package app

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"
)

const smallThumbnailVersion = "small-v1"

var smallThumbnailBuilds singleflight.Group
var smallThumbnailSlots = make(chan struct{}, 2)

// Derive small previews only from the server's existing thumbnail. The source
// fingerprint invalidates derivatives when a browser replaces a video poster.
func smallThumbnailFile(sourcePath, sourceMime string) (string, string, int, int, error) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return "", "", 0, 0, err
	}
	stem := strings.TrimSuffix(sourcePath, filepath.Ext(sourcePath))
	path := fmt.Sprintf("%s.%s.%x-%x.bin", stem, smallThumbnailVersion, info.ModTime().UnixNano(), info.Size())
	mimeType, width, height, err := smallThumbnailInfo(path)
	if err == nil {
		return path, mimeType, width, height, nil
	}
	_, err, _ = smallThumbnailBuilds.Do(path, func() (any, error) {
		smallThumbnailSlots <- struct{}{}
		defer func() { <-smallThumbnailSlots }()
		if _, _, _, cachedErr := smallThumbnailInfo(path); cachedErr == nil {
			return nil, nil
		}
		file, openErr := os.Open(sourcePath)
		if openErr != nil {
			return nil, openErr
		}
		defer file.Close()
		data, readErr := io.ReadAll(io.LimitReader(file, thumbnailMaxSourceBytes+1))
		if readErr != nil {
			return nil, readErr
		}
		if len(data) > thumbnailMaxSourceBytes {
			return nil, errThumbnailUnsupported
		}
		encoded, mimeType, _, _, encodeErr := buildThumbnailAtSize(data, sourceMime, 320, 960)
		if encodeErr != nil {
			return nil, encodeErr
		}
		encoded, _ = encodeSmallThumbnailWebP(encoded, mimeType)
		return nil, writeFileAtomic(path, encoded)
	})
	if err != nil {
		return "", "", 0, 0, err
	}
	mimeType, width, height, err = smallThumbnailInfo(path)
	return path, mimeType, width, height, err
}

func smallThumbnailInfo(path string) (string, int, int, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, 0, err
	}
	defer file.Close()
	config, format, err := image.DecodeConfig(file)
	if err != nil {
		return "", 0, 0, err
	}
	if config.Width < 1 || config.Width > 320 || config.Height < 1 || config.Height > 960 {
		return "", 0, 0, errThumbnailUnsupported
	}
	mimeType := "image/" + format
	if format != "jpeg" && format != "png" && format != "webp" && format != "gif" {
		return "", 0, 0, errThumbnailUnsupported
	}
	return mimeType, config.Width, config.Height, nil
}

// WebP is optional: preserve PNG alpha losslessly and keep JPEG/PNG whenever
// the encoder is missing, slow, fails, or produces a larger result.
func encodeSmallThumbnailWebP(data []byte, mimeType string) ([]byte, string) {
	if len(data) < 2048 {
		return data, mimeType
	}
	binary, err := renderFfmpegBinary()
	if err != nil {
		return data, mimeType
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	args := []string{"-hide_banner", "-loglevel", "error", "-threads", "1", "-i", "pipe:0", "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", "-compression_level", "4", "-threads", "1"}
	if mimeType == "image/png" {
		args = append(args, "-lossless", "1")
	}
	args = append(args, "-f", "image2pipe", "pipe:1")
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Stdin = bytes.NewReader(data)
	encoded, err := cmd.Output()
	if err != nil || len(encoded) == 0 || len(encoded) >= len(data) {
		return data, mimeType
	}
	original, _, originalErr := image.DecodeConfig(bytes.NewReader(data))
	result, format, decodeErr := image.DecodeConfig(bytes.NewReader(encoded))
	if originalErr != nil || decodeErr != nil || format != "webp" || original.Width != result.Width || original.Height != result.Height {
		return data, mimeType
	}
	return encoded, "image/webp"
}

func removeSmallThumbnailFiles(basePath string) {
	dir := filepath.Dir(basePath)
	prefix := strings.TrimSuffix(filepath.Base(basePath), filepath.Ext(basePath)) + "." + smallThumbnailVersion + "."
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), prefix) {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}
