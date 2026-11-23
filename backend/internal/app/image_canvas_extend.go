package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"strconv"
	"strings"

	"golang.org/x/image/draw"
)

// Some image relays compose tall canvases (e.g. 9:16) at 2:3 and centre-crop
// the result, cutting text and product at the left and right edges. The
// ecommerce Agent therefore requests tall pages at 2:3 and records the wanted
// canvas as workbench parameter "canvasSize". When the generated image is
// saved, it is placed whole on that canvas and the missing top and bottom
// bands are filled with a soft extension of the image's own edge colours.
const (
	canvasExtendMinGain   = 0.01 // ignore differences under 1%
	canvasExtendMaxRatio  = 3.0  // height/width sanity limit
	canvasExtendMaxHeight = 8192
	canvasExtendFeather   = 40
)

// requestedCanvasSize reads metadata.workbench.parameters.canvasSize.
func requestedCanvasSize(inputJSON string) string {
	var input struct {
		Metadata struct {
			Workbench struct {
				Parameters struct {
					CanvasSize string `json:"canvasSize"`
				} `json:"parameters"`
			} `json:"workbench"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(inputJSON), &input) != nil {
		return ""
	}
	return strings.TrimSpace(input.Metadata.Workbench.Parameters.CanvasSize)
}

// canvasExtendTarget returns the canvas height for an image of the given width
// when canvas ("WxH" or "W:H") is taller than the image; otherwise false.
func canvasExtendTarget(canvas string, width, height int) (int, bool) {
	canvas = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(canvas), "×", "x"))
	sep := "x"
	if strings.Contains(canvas, ":") {
		sep = ":"
	}
	w, h, ok := strings.Cut(canvas, sep)
	if !ok || width <= 0 || height <= 0 {
		return 0, false
	}
	cw, errW := strconv.ParseFloat(strings.TrimSpace(w), 64)
	ch, errH := strconv.ParseFloat(strings.TrimSpace(h), 64)
	if errW != nil || errH != nil || cw <= 0 || ch <= 0 || ch/cw > canvasExtendMaxRatio {
		return 0, false
	}
	target := int(math.Round(float64(width) * ch / cw))
	if float64(target) < float64(height)*(1+canvasExtendMinGain) || target > canvasExtendMaxHeight {
		return 0, false
	}
	return target, true
}

// canvasPixels parses an explicit "WxH" canvas.
func canvasPixels(canvas string) (int, int, bool) {
	w, h, ok := strings.Cut(strings.ToLower(strings.ReplaceAll(strings.TrimSpace(canvas), "×", "x")), "x")
	if !ok {
		return 0, 0, false
	}
	width, errW := strconv.Atoi(strings.TrimSpace(w))
	height, errH := strconv.Atoi(strings.TrimSpace(h))
	if errW != nil || errH != nil || width < 64 || height < 64 || width > canvasExtendMaxHeight || height > canvasExtendMaxHeight {
		return 0, 0, false
	}
	return width, height, true
}

// edgeBand renders a strip of rows from src (rows [y0,y1)) blurred into rect of dst.
func edgeBand(dst *image.RGBA, rect image.Rectangle, src image.Image, y0, y1 int) {
	b := src.Bounds()
	small := image.NewRGBA(image.Rect(0, 0, max(4, b.Dx()/24), 1))
	draw.BiLinear.Scale(small, small.Bounds(), src, image.Rect(b.Min.X, y0, b.Max.X, y1), draw.Src, nil)
	draw.BiLinear.Scale(dst, rect, small, small.Bounds(), draw.Src, nil)
}

// extendImageToCanvas rewrites path when canvas is taller than the image: the
// whole image is kept, centred vertically, and the bands are filled from its
// edge colours with a feathered seam. Returns the new MIME type and whether the
// file changed. A file already at the canvas ratio is left untouched, so a
// retried save is a no-op.
func extendImageToCanvas(path, mimeType, canvas string) (string, bool) {
	if canvas == "" {
		return mimeType, false
	}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 {
		return mimeType, false
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return mimeType, false
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	targetH, ok := canvasExtendTarget(canvas, w, h)
	if !ok {
		return mimeType, false
	}
	top := (targetH - h) / 2
	bottom := targetH - h - top
	dst := image.NewRGBA(image.Rect(0, 0, w, targetH))
	strip := max(8, h*6/100)
	edgeBand(dst, image.Rect(0, 0, w, top+canvasExtendFeather), img, b.Min.Y, b.Min.Y+strip)
	edgeBand(dst, image.Rect(0, targetH-bottom-canvasExtendFeather, w, targetH), img, b.Max.Y-strip, b.Max.Y)

	// Feather the image's top and bottom rows into the extension.
	feather := min(canvasExtendFeather, h/4)
	mask := image.NewAlpha(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		alpha := uint8(255)
		if d := min(y, h-1-y); d < feather {
			alpha = uint8(255 * (d + 1) / (feather + 1))
		}
		row := mask.Pix[y*mask.Stride : y*mask.Stride+w]
		for x := range row {
			row[x] = alpha
		}
	}
	draw.DrawMask(dst, image.Rect(0, top, w, top+h), img, b.Min, mask, image.Point{}, draw.Over)

	// A pixel canvas ("1536x2752") is honoured exactly even when the model
	// rendered at a different width (e.g. 1664x2496 for the 2k tier).
	if cw, ch, ok := canvasPixels(canvas); ok && (cw != w || ch != targetH) {
		scaled := image.NewRGBA(image.Rect(0, 0, cw, ch))
		draw.CatmullRom.Scale(scaled, scaled.Bounds(), dst, dst.Bounds(), draw.Src, nil)
		dst = scaled
	}

	var out bytes.Buffer
	newMime := "image/png"
	if mimeType == "image/jpeg" {
		newMime = "image/jpeg"
		err = jpeg.Encode(&out, dst, &jpeg.Options{Quality: 92})
	} else {
		err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&out, dst)
	}
	if err != nil || os.WriteFile(path, out.Bytes(), 0o600) != nil {
		return mimeType, false
	}
	return newMime, true
}
