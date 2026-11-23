package app

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// NezhaGate's image models return jobs from the OpenAI-shaped submit path.
// The ordinary OpenAI Images adapter expects the image in that first response.
func isNezhaGateImage(input canvasGenerationInput) bool {
	if input.Mode != "image" || input.Config.InterfaceType != string(model.ChannelInterfaceOpenAIImage) {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(input.Config.Model)) {
	case "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
		"nano-banana-2", "nano-banana-pro", "nano-banana-2.1",
		"grok-imagine-image", "grok-imagine-image-quality":
	default:
		return false
	}
	endpoint, err := url.Parse(strings.TrimSpace(input.Config.BaseURL))
	return err == nil && strings.EqualFold(endpoint.Hostname(), "service-01b31036.example.invalid")
}

func nezhaGateImageBody(input canvasGenerationInput) (map[string]any, error) {
	if input.Mask != nil {
		return nil, errors.New("NezhaGate 图片接口未声明蒙版参数，请移除蒙版")
	}
	if len(input.ReferenceImages) > 8 {
		return nil, errors.New("NezhaGate 最多支持 8 张参考图")
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("NezhaGate 图片提示词不能为空")
	}
	resolution, err := apimartExtResolution(input.Config.Quality)
	if err != nil {
		return nil, errors.New("NezhaGate 仅支持 1K、2K、4K 分辨率")
	}
	// Existing saved tasks may still carry a pixel preset. The price tier for
	// those tasks is selected from the pixel size, so keep the upstream tier equal.
	if pixelTier := imageResolutionFromSize(input.Config.Size); pixelTier != "" {
		resolution = strings.ToUpper(pixelTier)
	}
	body := map[string]any{
		"model":      input.Config.Model,
		"prompt":     withSystemPrompt(input.Config, input.Prompt),
		"resolution": resolution,
	}
	if size := strings.TrimSpace(input.Config.Size); size != "" && !strings.EqualFold(size, "auto") {
		if err := validateNezhaGateSize(size); err != nil {
			return nil, err
		}
		body["size"] = size
	}
	// NezhaGate documents quality only for its GPT image models. Other image
	// families use resolution/size, so do not send an unsupported quality field.
	isGPTImage := strings.HasPrefix(strings.ToLower(strings.TrimSpace(input.Config.Model)), "gpt-image-")
	if resolution == "1K" && isGPTImage {
		switch strings.ToLower(strings.TrimSpace(input.Config.Quality)) {
		case "low":
			body["quality"] = "low"
		case "medium":
			body["quality"] = "medium"
		case "high":
			body["quality"] = "high"
		}
	}
	if countText := strings.TrimSpace(input.Config.Count); countText != "" {
		count, err := strconv.Atoi(countText)
		if err != nil || count < 1 || count > 15 {
			return nil, errors.New("NezhaGate 单次生成张数必须为 1 至 15")
		}
		if count > 1 && !isGPTImage {
			return nil, errors.New("该 NezhaGate 图片模型每次任务仅返回 1 张图片，请将生成张数设为 1")
		}
		if count > 1 {
			body["n"] = count
		}
	}
	if len(input.ReferenceImages) == 1 {
		imageURL, err := openAIImageInputURL(input.ReferenceImages[0])
		if err != nil {
			return nil, err
		}
		body["image"] = imageURL
	} else if len(input.ReferenceImages) > 1 {
		images := make([]string, 0, len(input.ReferenceImages))
		for _, image := range input.ReferenceImages {
			imageURL, err := openAIImageInputURL(image)
			if err != nil {
				return nil, err
			}
			images = append(images, imageURL)
		}
		body["images"] = images
	}
	return body, nil
}

func validateNezhaGateSize(size string) error {
	separator := ":"
	if strings.Contains(strings.ToLower(size), "x") {
		separator = "x"
	}
	parts := strings.Split(strings.ToLower(size), separator)
	if len(parts) != 2 {
		return errors.New("NezhaGate 图片尺寸须为宽高比或像素尺寸")
	}
	for _, part := range parts {
		value, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || value <= 0 {
			return errors.New("NezhaGate 图片尺寸须使用正整数")
		}
	}
	return nil
}

func runNezhaGateImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	body, err := nezhaGateImageBody(input)
	if err != nil {
		return nil, err
	}
	jobID := resumedProviderRequestID(ctx)
	if jobID == "" {
		var submitted map[string]any
		if err := postJSON(withProviderRequestKind(ctx, "create"), input.Config, "/images/generations", body, &submitted); err != nil {
			return nil, err
		}
		jobID = strings.TrimSpace(stringField(submitted, "id"))
		if jobID == "" {
			return nil, errors.New("NezhaGate 已受理图片请求，但未返回任务 ID；请先检查上游记录，避免重复提交")
		}
	}
	// Query immediately after acceptance, then follow the upstream's 2-3 second image polling guidance.
	policy := videoPollPolicy{InitialDelay: 0, Interval: 2 * time.Second, RetryTransient: true, Sleep: sleepContext}
	return runVideoPollLoop(ctx, jobID, policy, func(pollCtx context.Context) (videoPollOutcome, error) {
		var payload map[string]any
		if err := getJSON(withProviderRequestKind(pollCtx, "poll"), input.Config, "/images/jobs/"+url.PathEscape(jobID), &payload); err != nil {
			return videoPollOutcome{}, err
		}
		switch strings.ToLower(strings.TrimSpace(stringField(payload, "status"))) {
		case "queued", "pending", "processing", "running":
			return videoPollOutcome{}, nil
		case "succeeded", "completed":
			items, _ := payload["data"].([]any)
			images := make([]map[string]string, 0, len(items))
			for _, item := range items {
				entry, _ := item.(map[string]any)
				if imageURL := strings.TrimSpace(stringField(entry, "url")); imageURL != "" {
					images = append(images, map[string]string{"dataUrl": imageURL})
				}
			}
			if len(images) == 0 {
				return videoPollOutcome{}, errors.New("NezhaGate 任务已完成，但没有返回图片地址")
			}
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "image", "images": images}}, nil
		case "failed", "cancelled", "canceled", "expired":
			_, message := providerFailureDetails(payload)
			if message == "" {
				message = "图片生成任务失败"
			}
			return videoPollOutcome{}, fmt.Errorf("NezhaGate 图片任务失败：%s", providerPayloadErrorMessage(message))
		default:
			return videoPollOutcome{}, errors.New("NezhaGate 返回未知图片任务状态")
		}
	})
}
