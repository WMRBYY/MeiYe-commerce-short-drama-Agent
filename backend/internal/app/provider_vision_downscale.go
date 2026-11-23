package app

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// ecommerceDirectionsVisionEdge is the long edge sent to the vision model when
// recommending directions. Identifying the product and its colors does not
// need full resolution, and a 1–2 MB original adds about ten seconds of upload
// and image-token processing per request.
const ecommerceDirectionsVisionEdge = 1024

// downscaleVisionImage returns a JPEG no larger than maxEdge on the long edge.
// It keeps the original when it is already small, cannot be decoded, or the
// re-encoded copy would not be smaller.
func downscaleVisionImage(data []byte, maxEdge int) ([]byte, string, bool) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return nil, "", false
	}
	if config.Width <= maxEdge && config.Height <= maxEdge && len(data) <= 400<<10 {
		return nil, "", false
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", false
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return nil, "", false
	}
	scale := 1.0
	if width >= height && width > maxEdge {
		scale = float64(maxEdge) / float64(width)
	} else if height > width && height > maxEdge {
		scale = float64(maxEdge) / float64(height)
	}
	dst := image.NewRGBA(image.Rect(0, 0, max(1, int(float64(width)*scale)), max(1, int(float64(height)*scale))))
	// Transparent PNG areas become white, as on a product page.
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(dst, dst.Bounds(), decoded, bounds, draw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 85}); err != nil || out.Len() >= len(data) {
		return nil, "", false
	}
	return out.Bytes(), "image/jpeg", true
}

func ecommerceDirectionsVisionTask(input *canvasGenerationInput) bool {
	return input.Mode == "text" && metadataString(input.Metadata, "source") == "ecommerce-agent" && metadataString(input.Metadata, "stage") == "creative-directions"
}

// shrinkInlineVisionMedia replaces an inlined image with a smaller JPEG copy.
// The stored resource is untouched; only this request's payload changes.
func shrinkInlineVisionMedia(media *providerMedia, maxEdge int) {
	_, encoded, ok := splitDataURL(media.DataURL)
	if !ok {
		return
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return
	}
	smaller, smallerType, ok := downscaleVisionImage(raw, maxEdge)
	if !ok {
		return
	}
	media.DataURL = dataURL(smallerType, smaller)
	media.MimeType = smallerType
	media.Bytes = int64(len(smaller))
}
