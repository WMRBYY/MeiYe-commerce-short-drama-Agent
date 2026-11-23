package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math"
	"strconv"
	"strings"

	"golang.org/x/image/draw"
	"yingce/backend/internal/model"
)

// Workbench canvasSize is the user's output contract, including older tasks
// whose provider size was deliberately changed to 2:3.
func workbenchImageCanvas(raw string) string {
	var input struct {
		Metadata struct {
			Workbench struct {
				Kind       string `json:"kind"`
				Parameters struct {
					CanvasSize string `json:"canvasSize"`
					Size       string `json:"size"`
				} `json:"parameters"`
			} `json:"workbench"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(raw), &input) != nil || input.Metadata.Workbench.Kind != "image" {
		return ""
	}
	return firstNonEmptyString(input.Metadata.Workbench.Parameters.CanvasSize, input.Metadata.Workbench.Parameters.Size)
}

func (s *Service) persistGeneratedTaskMediaResult(task *model.Task, result map[string]interface{}) (map[string]interface{}, error) {
	if task.Type != "canvas_image" {
		return s.persistGeneratedMediaResult(task.UserID, result)
	}
	raw, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	return s.persistGeneratedMediaResultMode(task.UserID, result, false, true, workbenchImageCanvas(raw))
}

// Prefer native composition at the requested ratio. If a provider ignores it,
// keep all content at its original scale and extend the canvas, never stretch
// the product or crop text. The same operation serves both save paths.
func fitGeneratedImageCanvas(data []byte, mimeType, canvas string) ([]byte, string, error) {
	parts := strings.FieldsFunc(strings.ToLower(canvas), func(r rune) bool { return r == 'x' || r == '×' || r == ':' })
	if len(parts) != 2 {
		return data, mimeType, nil
	}
	cw, e1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	ch, e2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if e1 != nil || e2 != nil || cw <= 0 || ch <= 0 || math.IsInf(cw, 0) || math.IsInf(ch, 0) || math.IsNaN(cw) || math.IsNaN(ch) {
		return nil, "", fmt.Errorf("成片画幅无效")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("无法校验生成图片比例：%w", err)
	}
	ratio := cw / ch
	actual := float64(cfg.Width) / float64(cfg.Height)
	if math.Abs(actual/ratio-1) < 0.01 {
		return data, mimeType, nil
	}
	w, h := cfg.Width, cfg.Height
	if actual > ratio {
		h = int(math.Round(float64(w) / ratio))
	} else {
		w = int(math.Round(float64(h) * ratio))
	}
	if w < 1 || h < 1 || w > 8192 || h > 8192 || int64(w)*int64(h) > 40_000_000 {
		return nil, "", fmt.Errorf("生成图片与目标画幅差异过大，无法安全保存")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	// A low-detail background prevents sharp duplicated text in the added area.
	small := image.NewRGBA(image.Rect(0, 0, 8, 8))
	draw.BiLinear.Scale(small, small.Bounds(), src, src.Bounds(), draw.Src, nil)
	draw.BiLinear.Scale(dst, dst.Bounds(), small, small.Bounds(), draw.Src, nil)
	x, y := (w-cfg.Width)/2, (h-cfg.Height)/2
	draw.Draw(dst, image.Rect(x, y, x+cfg.Width, y+cfg.Height), src, src.Bounds().Min, draw.Src)
	var output bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&output, dst); err != nil {
		return nil, "", err
	}
	return output.Bytes(), "image/png", nil
}
