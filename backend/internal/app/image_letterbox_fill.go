package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"strconv"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Some image relays render at their native ratio (2:3, 3:4, 1:1) and pad the
// result with solid black bars to reach the requested size. Those bars are
// never intended content, so they are replaced by a soft extension of the
// picture; the content itself is never cropped, so no text is cut off.
// Conservative detection: each band must be a run of near-black,
// near-uniform rows/columns of at least 3% on both sides.
const (
	letterboxMinBand      = 0.03
	letterboxMaxLuma      = 24
	letterboxMaxSpread    = 10
	letterboxMaxBandRatio = 0.30
)

// requestedImageSize reads an explicit "WxH" size from the task input.
func requestedImageSize(inputJSON string) (int, int) {
	var input struct {
		Config struct {
			Size string `json:"size"`
		} `json:"config"`
	}
	if json.Unmarshal([]byte(inputJSON), &input) != nil {
		return 0, 0
	}
	w, h, ok := strings.Cut(strings.ToLower(strings.TrimSpace(input.Config.Size)), "x")
	if !ok {
		return 0, 0
	}
	width, errW := strconv.Atoi(w)
	height, errH := strconv.Atoi(h)
	if errW != nil || errH != nil || width < 64 || height < 64 {
		return 0, 0
	}
	return width, height
}

func letterboxLineIsBar(img image.Image, horizontal bool, at int) bool {
	b := img.Bounds()
	var minL, maxL uint32 = 255, 0
	length := b.Dx()
	if !horizontal {
		length = b.Dy()
	}
	step := max(1, length/160)
	for i := 0; i < length; i += step {
		var r, g, bl uint32
		if horizontal {
			r, g, bl, _ = img.At(b.Min.X+i, at).RGBA()
		} else {
			r, g, bl, _ = img.At(at, b.Min.Y+i).RGBA()
		}
		luma := (r*299 + g*587 + bl*114) / 1000 >> 8
		minL, maxL = min(minL, luma), max(maxL, luma)
		if maxL > letterboxMaxLuma || maxL-minL > letterboxMaxSpread {
			return false
		}
	}
	return true
}

// detectLetterbox returns the content rectangle inside symmetric black bars.
func detectLetterbox(img image.Image) (image.Rectangle, bool) {
	b := img.Bounds()
	count := func(horizontal bool, fromStart bool) int {
		limit := b.Dy()
		if !horizontal {
			limit = b.Dx()
		}
		n := 0
		for n < int(float64(limit)*letterboxMaxBandRatio) {
			var at int
			switch {
			case horizontal && fromStart:
				at = b.Min.Y + n
			case horizontal:
				at = b.Max.Y - 1 - n
			case fromStart:
				at = b.Min.X + n
			default:
				at = b.Max.X - 1 - n
			}
			if !letterboxLineIsBar(img, horizontal, at) {
				break
			}
			n++
		}
		return n
	}
	top, bottom := count(true, true), count(true, false)
	left, right := count(false, true), count(false, false)
	minRows, minCols := int(float64(b.Dy())*letterboxMinBand), int(float64(b.Dx())*letterboxMinBand)
	content := b
	found := false
	if top >= minRows && bottom >= minRows {
		content.Min.Y, content.Max.Y = b.Min.Y+top, b.Max.Y-bottom
		found = true
	}
	if left >= minCols && right >= minCols {
		content.Min.X, content.Max.X = b.Min.X+left, b.Max.X-right
		found = true
	}
	return content, found && content.Dx() > b.Dx()/3 && content.Dy() > b.Dy()/3
}

// fitWithExtendedEdges places the whole content (nothing cropped, so no text
// is cut) scaled to fit the target canvas, and fills the remaining bands with
// a soft, blurred extension of the content's nearest edge strip. The seam is
// feathered so the background reads as one continuous picture.
func fitWithExtendedEdges(img image.Image, content image.Rectangle, targetW, targetH int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	scale := min(float64(targetW)/float64(content.Dx()), float64(targetH)/float64(content.Dy()))
	fitW, fitH := max(1, int(float64(content.Dx())*scale+0.5)), max(1, int(float64(content.Dy())*scale+0.5))
	fit := image.Rect((targetW-fitW)/2, (targetH-fitH)/2, (targetW-fitW)/2+fitW, (targetH-fitH)/2+fitH)

	// blurInto scales a source strip into dst rectangle through a tiny
	// intermediate image, which gives a smooth blur without extra libraries.
	// The band is the edge strip averaged across its thickness (one row for
	// top/bottom, one column for left/right) and softly blurred along it, so it
	// reads as a smooth continuation of the background without copied detail.
	blurInto := func(target image.Rectangle, strip image.Rectangle) {
		if target.Empty() || strip.Empty() {
			return
		}
		horizontal := target.Dx() >= target.Dy()
		size := image.Rect(0, 0, max(2, target.Dx()/24), 1)
		if !horizontal {
			size = image.Rect(0, 0, 1, max(2, target.Dy()/24))
		}
		tiny := image.NewRGBA(size)
		draw.ApproxBiLinear.Scale(tiny, tiny.Bounds(), img, strip, draw.Src, nil)
		draw.BiLinear.Scale(dst, target, tiny, tiny.Bounds(), draw.Src, nil)
	}
	// Only the outermost 2.5% is extended: it is almost always plain background,
	// so titles and products near the edge do not smear into the bands.
	stripRows := max(1, content.Dy()/40)
	stripCols := max(1, content.Dx()/40)
	if fit.Min.Y > 0 { // top and bottom bands
		blurInto(image.Rect(0, 0, targetW, fit.Min.Y), image.Rect(content.Min.X, content.Min.Y, content.Max.X, content.Min.Y+stripRows))
		blurInto(image.Rect(0, fit.Max.Y, targetW, targetH), image.Rect(content.Min.X, content.Max.Y-stripRows, content.Max.X, content.Max.Y))
	}
	if fit.Min.X > 0 { // left and right bands
		blurInto(image.Rect(0, 0, fit.Min.X, targetH), image.Rect(content.Min.X, content.Min.Y, content.Min.X+stripCols, content.Max.Y))
		blurInto(image.Rect(fit.Max.X, 0, targetW, targetH), image.Rect(content.Max.X-stripCols, content.Min.Y, content.Max.X, content.Max.Y))
	}
	draw.CatmullRom.Scale(dst, fit, img, content, draw.Src, nil)
	// Feather the seams: blend the outer rows/columns of the content into the band.
	feather := max(4, min(targetW, targetH)/30)
	blend := func(x, y int, outsideX, outsideY int, weight float64) {
		inside := dst.RGBAAt(x, y)
		outside := dst.RGBAAt(outsideX, outsideY)
		mix := func(a, b uint8) uint8 { return uint8(float64(a)*weight + float64(b)*(1-weight) + 0.5) }
		dst.SetRGBA(x, y, color.RGBA{mix(inside.R, outside.R), mix(inside.G, outside.G), mix(inside.B, outside.B), 255})
	}
	if fit.Min.Y > 0 {
		for i := 0; i < feather; i++ {
			weight := float64(i+1) / float64(feather+1)
			for x := 0; x < targetW; x++ {
				blend(x, fit.Min.Y+i, x, max(0, fit.Min.Y-1), weight)
				blend(x, fit.Max.Y-1-i, x, min(targetH-1, fit.Max.Y), weight)
			}
		}
	}
	if fit.Min.X > 0 {
		for i := 0; i < feather; i++ {
			weight := float64(i+1) / float64(feather+1)
			for y := 0; y < targetH; y++ {
				blend(fit.Min.X+i, y, max(0, fit.Min.X-1), y, weight)
				blend(fit.Max.X-1-i, y, min(targetW-1, fit.Max.X), y, weight)
			}
		}
	}
	return dst
}

// fillLetterboxedImage rewrites the file at path in place when it contains
// padding bars: the bars are removed and the content is centre-cropped to the
// target ratio and scaled to targetW x targetH. It returns the new MIME type
// and whether the file changed. Processing an already filled file is a no-op,
// so a retried save produces the same bytes.
func fillLetterboxedImage(path, mimeType string, targetW, targetH int) (string, bool) {
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 {
		return mimeType, false
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return mimeType, false
	}
	content, ok := detectLetterbox(img)
	if !ok {
		return mimeType, false
	}
	if targetW <= 0 || targetH <= 0 {
		targetW, targetH = img.Bounds().Dx(), img.Bounds().Dy()
	}
	dst := fitWithExtendedEdges(img, content, targetW, targetH)
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
