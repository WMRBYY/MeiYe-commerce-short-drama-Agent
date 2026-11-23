package app

import (
	"context"
	"errors"
	"math"
	"net/url"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
)

// PearAPI exposes Nano Banana Pro through its OpenAI-shaped JSON image routes,
// while the similarly named Gemini adapter sends generateContent to /v1beta.
func isPearAPIImage(input canvasGenerationInput) bool {
	if input.Mode != "image" || !strings.HasPrefix(strings.ToLower(strings.TrimSpace(input.Config.Model)), "nano-banana-pro-") {
		return false
	}
	if input.Config.InterfaceType != string(model.ChannelInterfaceOpenAIImage) && input.Config.InterfaceType != string(model.ChannelInterfaceGeminiImage) {
		return false
	}
	endpoint, err := url.Parse(strings.TrimSpace(input.Config.BaseURL))
	return err == nil && strings.EqualFold(endpoint.Hostname(), "service-27d2a128.example.invalid")
}

var pearAPIAspectRatios = []string{"1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9", "4:5", "5:4", "1:4", "4:1", "1:8", "8:1"}

func pearAPIAspectRatio(raw string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(raw, "×", "x")))
	if value == "" || value == "auto" {
		return "", nil
	}
	for _, ratio := range pearAPIAspectRatios {
		if value == ratio {
			return ratio, nil
		}
	}
	widthText, heightText, ok := strings.Cut(value, "x")
	if !ok {
		return "", errors.New("PearAPI 仅支持预设宽高比")
	}
	width, widthErr := strconv.Atoi(widthText)
	height, heightErr := strconv.Atoi(heightText)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return "", errors.New("PearAPI 图片尺寸无效")
	}
	actual := float64(width) / float64(height)
	for _, ratio := range pearAPIAspectRatios {
		sides := strings.Split(ratio, ":")
		w, _ := strconv.Atoi(sides[0])
		h, _ := strconv.Atoi(sides[1])
		if math.Abs(actual-float64(w)/float64(h)) <= 0.025 {
			return ratio, nil
		}
	}
	return "", errors.New("PearAPI 不支持当前像素比例，请选择预设宽高比")
}

func pearAPIImageBody(input canvasGenerationInput) (string, map[string]any, error) {
	if input.Mask != nil {
		return "", nil, errors.New("PearAPI Nano Banana Pro 不支持蒙版编辑")
	}
	if len(input.ReferenceImages) > 14 {
		return "", nil, errors.New("PearAPI Nano Banana Pro 最多支持 14 张参考图")
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return "", nil, errors.New("PearAPI 图片提示词不能为空")
	}
	ratio, err := pearAPIAspectRatio(input.Config.Size)
	if err != nil {
		return "", nil, err
	}
	count := 1
	if countText := strings.TrimSpace(input.Config.Count); countText != "" {
		count, err = strconv.Atoi(countText)
		if err != nil || count < 1 || count > 4 {
			return "", nil, errors.New("PearAPI 单次仅支持生成 1 至 4 张图片")
		}
	}
	body := map[string]any{
		"model": input.Config.Model, "prompt": withSystemPrompt(input.Config, input.Prompt),
		"n": count, "task_type": "sync",
	}
	if ratio != "" {
		body["aspect_ratio"] = ratio
	}
	path := "/images/generations"
	if len(input.ReferenceImages) > 0 {
		path = "/images/edits"
		images := make([]string, 0, len(input.ReferenceImages))
		for _, image := range input.ReferenceImages {
			imageURL, err := openAIImageInputURL(image)
			if err != nil {
				return "", nil, err
			}
			images = append(images, imageURL)
		}
		if len(images) == 1 {
			body["image"] = images[0]
		} else {
			body["images"] = images
		}
	}
	return path, body, nil
}

func runPearAPIImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	path, body, err := pearAPIImageBody(input)
	if err != nil {
		return nil, err
	}
	var payload imageResponse
	if err := postJSON(ctx, input.Config, path, body, &payload); err != nil {
		return nil, err
	}
	images, err := imageDataURLs(payload)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "image", "images": images}, nil
}
