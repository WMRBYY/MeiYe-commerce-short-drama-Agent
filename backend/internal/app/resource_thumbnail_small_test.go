package app

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func posterTestImage(t *testing.T, width, height int, alpha uint8) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x * 7), uint8(y * 3), uint8((x + y) * 5), alpha})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestSmallThumbnailLocalCacheAndInvalidation(t *testing.T) {
	t.Setenv(renderFfmpegEnv, filepath.Join(t.TempDir(), "no-encoder"))
	svc, db := newMediaRecoveryTestService(t)
	video := model.Resource{ID: newID(), UserID: "poster-owner", Kind: "video", Provider: "local", ObjectKey: "missing-original.mp4", MimeType: "video/mp4", Status: model.ResourceStatusReady, Size: 99999, CreatedAt: time.Now()}
	if err := db.Create(&video).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveVideoPoster(video.UserID, video.ID, bytes.NewReader(posterTestImage(t, 640, 960, 255))); err != nil {
		t.Fatal(err)
	}
	read := func(variant assets.ResourceVariant) ([]byte, string) {
		t.Helper()
		d, err := svc.PrepareResourceDelivery(video.UserID, video.ID, assets.AccessOptions{Variant: variant}, "")
		if err != nil {
			t.Fatal(err)
		}
		defer d.Stream.Body.Close()
		data, err := io.ReadAll(d.Stream.Body)
		if err != nil {
			t.Fatal(err)
		}
		config, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if variant == assets.VariantThumbnailSmall && (config.Width != 320 || config.Height > 960 || d.Resource.Width != config.Width) {
			t.Fatalf("invalid small dimensions: %+v", config)
		}
		if d.Access.Delivery != assets.DeliveryLocal || d.Access.ActualVariant != variant {
			t.Fatal("incorrect delivery")
		}
		u, err := url.Parse(d.Access.URL)
		if err != nil {
			t.Fatal(err)
		}
		if variant == assets.VariantThumbnailSmall && u.Query().Get("v") != smallThumbnailVersion {
			t.Fatal("small URL must invalidate old 640px cache")
		}
		return data, d.Resource.ObjectKey
	}
	large, _ := read(assets.VariantThumbnail)
	small, key := read(assets.VariantThumbnailSmall)
	repeated, key2 := read(assets.VariantThumbnailSmall)
	if len(small) >= len(large) || !bytes.Equal(small, repeated) || key != key2 {
		t.Fatal("small cache not reused or not smaller")
	}
	large2, _ := read(assets.VariantThumbnail)
	if !bytes.Equal(large, large2) {
		t.Fatal("base preview changed")
	}
	if err := svc.SaveVideoPoster(video.UserID, video.ID, bytes.NewReader(posterTestImage(t, 640, 480, 255))); err != nil {
		t.Fatal(err)
	}
	updated, key3 := read(assets.VariantThumbnailSmall)
	if key == key3 || bytes.Equal(small, updated) {
		t.Fatal("updated poster reused stale derivative")
	}
	svc.removeResourceThumbnails(video.ID)
	entries, _ := os.ReadDir(filepath.Join(svc.dataDir, thumbnailDirName, video.ID[:2]))
	for _, entry := range entries {
		if !entry.IsDir() {
			t.Fatalf("derivative left after deletion: %s", entry.Name())
		}
	}
}

func TestSmallThumbnailKeepsAlphaAndSafeEncoderFallback(t *testing.T) {
	t.Setenv(renderFfmpegEnv, filepath.Join(t.TempDir(), "missing-ffmpeg"))
	dir := t.TempDir()
	base := filepath.Join(dir, "transparent.png")
	data := posterTestImage(t, 640, 480, 128)
	if err := os.WriteFile(base, data, 0600); err != nil {
		t.Fatal(err)
	}
	path, mime, width, height, err := smallThumbnailFile(base, "image/png")
	if err != nil || mime != "image/png" || width != 320 || height != 240 {
		t.Fatalf("invalid alpha preview %s %dx%d: %v", mime, width, height, err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, alpha := img.At(30, 30).RGBA()
	if alpha == 0 || alpha == 65535 {
		t.Fatal("alpha was flattened")
	}
	encoded, mime := encodeSmallThumbnailWebP(data, "image/png")
	if !bytes.Equal(encoded, data) || mime != "image/png" {
		t.Fatal("unavailable encoder must preserve input")
	}
}

func TestSmallThumbnailWebPEncoderIfAvailable(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("runtime encoder test runs in the production candidate image")
	}
	source := image.NewNRGBA(image.Rect(0, 0, 320, 240))
	for y := 0; y < 240; y++ {
		for x := 0; x < 320; x++ {
			source.SetNRGBA(x, y, color.NRGBA{uint8(x), uint8(y), 120, 128})
		}
	}
	var buf bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.NoCompression}).Encode(&buf, source); err != nil {
		t.Fatal(err)
	}
	encoded, mime := encodeSmallThumbnailWebP(buf.Bytes(), "image/png")
	if mime != "image/webp" || len(encoded) >= buf.Len() {
		t.Fatalf("runtime WebP encoding did not reduce fixture: %s %d/%d", mime, len(encoded), buf.Len())
	}
	result, _, err := image.Decode(bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	for y := 0; y < 240; y++ {
		for x := 0; x < 320; x++ {
			r, g, b, a := source.At(x, y).RGBA()
			rr, gg, bb, aa := result.At(x, y).RGBA()
			if r != rr || g != gg || b != bb || a != aa {
				t.Fatalf("lossless transparency changed pixel at %d,%d", x, y)
			}
		}
	}
}
