// Package imagetext detects visible text from image pixels with local OCR.
// It never uses language-model guesses for text coordinates.
package imagetext

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

var ErrUnavailable = errors.New("text OCR engine or language data unavailable")

type Box struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Region struct {
	ID         string  `json:"id"`
	Text       string  `json:"text"`
	Box        Box     `json:"box"`
	Confidence float64 `json:"confidence"`
}

// A bounded native-resolution window avoids shrinking a long detail page to
// a thumbnail. Overlap preserves text crossing a tile edge; merge drops duplicates.
func windows(height int) []image.Rectangle {
	const tileHeight, overlap = 2048, 192
	var result []image.Rectangle
	for top := 0; top < height; top += tileHeight - overlap {
		bottom := min(height, top+tileHeight)
		result = append(result, image.Rect(0, top, 0, bottom))
		if bottom == height {
			break
		}
	}
	return result
}

func Detect(ctx context.Context, src image.Image) ([]Region, error) {
	binary, err := exec.LookPath("tesseract")
	if err != nil {
		return nil, ErrUnavailable
	}
	bounds := src.Bounds()
	var regions []Region
	for _, window := range windows(bounds.Dy()) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		window.Max.X = bounds.Dx()
		tile := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), window.Dy()))
		draw.Draw(tile, tile.Bounds(), src, bounds.Min.Add(window.Min), draw.Src)
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, tile); err != nil {
			return nil, err
		}
		// CLI arguments are constant. No URL, shell, user text, or user path is executed.
		// Local adaptive threshold keeps lettering on gradients and photographed
		// packaging from disappearing under a single whole-image threshold.
		cmd := exec.CommandContext(ctx, binary, "stdin", "stdout", "-l", "chi_sim+eng", "--psm", "11", "-c", "thresholding_method=2", "tsv")
		cmd.Stdin = &encoded
		cmd.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1")
		stdout, stderr := &boundedBuffer{remaining: 4 << 20}, &boundedBuffer{remaining: 16 << 10}
		cmd.Stdout, cmd.Stderr = stdout, stderr
		runErr := cmd.Run()
		// Tesseract may exit successfully after silently falling back to the one
		// installed language. Both requested languages are required by this API.
		if strings.Contains(stderr.String(), "Failed loading language") || strings.Contains(stderr.String(), "Error opening data file") {
			return nil, ErrUnavailable
		}
		if err := runErr; err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, fmt.Errorf("OCR process failed: %w", err)
		}
		lines, err := parseTSV(stdout.String(), bounds.Dx(), window.Dy(), window.Min.Y)
		if err != nil {
			return nil, err
		}
		regions = merge(regions, lines)
		if len(regions) > 2000 {
			return nil, errors.New("too many text regions")
		}
	}
	sort.SliceStable(regions, func(i, j int) bool {
		if regions[i].Box.Y == regions[j].Box.Y {
			return regions[i].Box.X < regions[j].Box.X
		}
		return regions[i].Box.Y < regions[j].Box.Y
	})
	for i := range regions {
		regions[i].ID = fmt.Sprintf("text-%d", i+1)
	}
	if regions == nil {
		regions = []Region{}
	}
	return regions, nil
}

type boundedBuffer struct {
	bytes.Buffer
	remaining int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.remaining {
		return 0, errors.New("OCR output exceeds limit")
	}
	b.remaining -= len(p)
	return b.Buffer.Write(p)
}

type lineAccumulator struct {
	region             Region
	weight, confidence float64
}

func parseTSV(raw string, width, height, offsetY int) ([]Region, error) {
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 4096), 64<<10)
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "level\tpage_num\t") {
		return nil, errors.New("invalid OCR response")
	}
	lines := map[string]*lineAccumulator{}
	var ordered []*lineAccumulator
	for scanner.Scan() {
		fields := strings.SplitN(scanner.Text(), "\t", 12)
		if len(fields) != 12 || fields[0] != "5" || strings.TrimSpace(fields[11]) == "" {
			continue
		}
		values := make([]int, 4)
		for i := range values {
			value, err := strconv.Atoi(fields[6+i])
			if err != nil {
				return nil, errors.New("invalid OCR coordinates")
			}
			values[i] = value
		}
		x, y, w, h := values[0], values[1], values[2], values[3]
		if x < 0 || y < 0 || w <= 0 || h <= 0 || x > width-w || y > height-h {
			return nil, errors.New("OCR coordinates outside source image")
		}
		confidence, err := strconv.ParseFloat(fields[10], 64)
		if err != nil || math.IsNaN(confidence) || math.IsInf(confidence, 0) || confidence < 0 || confidence > 100 {
			return nil, errors.New("invalid OCR confidence")
		}
		text := strings.TrimSpace(fields[11])
		key := strings.Join(fields[1:5], ":")
		line := lines[key]
		if line == nil {
			line = &lineAccumulator{region: Region{Box: Box{X: x, Y: y + offsetY, Width: w, Height: h}}}
			lines[key] = line
			ordered = append(ordered, line)
		} else {
			box := line.region.Box
			right, bottom := max(box.X+box.Width, x+w), max(box.Y+box.Height, y+offsetY+h)
			box.X, box.Y = min(box.X, x), min(box.Y, y+offsetY)
			box.Width, box.Height = right-box.X, bottom-box.Y
			line.region.Box = box
		}
		line.region.Text = joinWords(line.region.Text, text)
		weight := float64(utf8.RuneCountInString(text))
		line.weight += weight
		line.confidence += confidence * weight
	}
	if err := scanner.Err(); err != nil && err != io.EOF {
		return nil, err
	}
	result := make([]Region, 0, len(ordered))
	for _, line := range ordered {
		line.region.Confidence = math.Round(line.confidence/line.weight) / 100
		result = append(result, line.region)
	}
	return result, nil
}

func joinWords(left, right string) string {
	if left == "" {
		return right
	}
	a, _ := utf8.DecodeLastRuneInString(left)
	b, _ := utf8.DecodeRuneInString(right)
	if unicode.Is(unicode.Han, a) || unicode.Is(unicode.Han, b) || unicode.IsPunct(b) {
		return left + right
	}
	return left + " " + right
}

func merge(current, incoming []Region) []Region {
	for _, next := range incoming {
		duplicate := -1
		for i, prior := range current {
			a, b := prior.Box, next.Box
			intersection := max(0, min(a.X+a.Width, b.X+b.Width)-max(a.X, b.X)) * max(0, min(a.Y+a.Height, b.Y+b.Height)-max(a.Y, b.Y))
			if float64(intersection) > 0.65*float64(min(a.Width*a.Height, b.Width*b.Height)) {
				duplicate = i
				break
			}
		}
		if duplicate < 0 {
			current = append(current, next)
		} else if next.Confidence > current[duplicate].Confidence || (next.Confidence == current[duplicate].Confidence && len(next.Text) > len(current[duplicate].Text)) {
			current[duplicate] = next
		}
	}
	return current
}
