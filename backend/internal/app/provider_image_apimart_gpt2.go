package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// GPT-Image-2 returns an accepted task, not an OpenAI Images response with
// synchronous image data. Keep this selection scoped to APIMart's host.
func isAPIMartGPTImage2(input canvasGenerationInput) bool {
	if input.Mode != "image" || input.Config.InterfaceType != string(model.ChannelInterfaceOpenAIImage) {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(input.Config.Model)) {
	case "gpt-image-2", "gpt-image-2-ext":
	default:
		return false
	}
	endpoint, err := url.Parse(strings.TrimSpace(input.Config.BaseURL))
	if err != nil {
		return false
	}
	switch strings.ToLower(endpoint.Hostname()) {
	case "service-3347642c.example.invalid", "apimart-egress.service-28ac86dd.example.invalid":
		return true
	default:
		return false
	}
}

func apimartGPTImage2RequestBody(input canvasGenerationInput) (map[string]any, error) {
	if input.Mask != nil {
		return nil, errors.New("APIMart GPT-Image-2 不支持蒙版编辑")
	}
	if len(input.ReferenceImages) > 15 {
		return nil, errors.New("APIMart GPT-Image-2 最多支持 15 张参考图")
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("APIMart GPT-Image-2 提示词不能为空")
	}
	if err := validateOpenAIImageInput(input); err != nil {
		return nil, err
	}
	resolution := strings.ToLower(strings.TrimSpace(input.Config.ImageResolution))
	if resolution == "" {
		resolution = "1k"
	}
	switch resolution {
	case "1k", "2k", "4k":
	default:
		return nil, errors.New("APIMart GPT-Image-2 仅支持 1K、2K、4K 分辨率")
	}
	count := 1
	if raw := strings.TrimSpace(input.Config.Count); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 4 {
			return nil, errors.New("APIMart GPT-Image-2 单次仅支持生成 1 至 4 张图片")
		}
		count = parsed
	}
	body := map[string]any{
		"model": input.Config.Model, "prompt": withSystemPrompt(input.Config, input.Prompt),
		"n": count, "resolution": resolution,
	}
	if size := normalizePixelSize(input.Config.Size); size != "" {
		body["size"] = size
	}
	if len(input.ReferenceImages) > 0 {
		urls := make([]string, 0, len(input.ReferenceImages))
		for _, image := range input.ReferenceImages {
			value, err := openAIImageInputURL(image)
			if err != nil {
				return nil, err
			}
			urls = append(urls, value)
		}
		body["image_urls"] = urls
	}
	return body, nil
}

func runAPIMartGPTImage2Task(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	body, err := apimartGPTImage2RequestBody(input)
	if err != nil {
		return nil, err
	}
	taskID := resumedProviderRequestID(ctx)
	if taskID == "" {
		payload, err := submitAPIMartImage(ctx, input.Config, body, false)
		if err != nil {
			return nil, err
		}
		taskID = apimartExtTaskID(payload)
		if taskID == "" {
			return nil, errors.New("APIMart GPT-Image-2 已受理请求，但缺少任务 ID；请先核对上游记录，避免重复提交")
		}
	}
	policy := videoPollPolicy{InitialDelay: 2 * time.Second, Interval: 3 * time.Second, MaxNotFoundMisses: 3, RetryTransient: true, Sleep: sleepContext}
	return runVideoPollLoop(ctx, taskID, policy, func(pollCtx context.Context) (videoPollOutcome, error) {
		var payload map[string]any
		if err := getJSON(withProviderRequestKind(pollCtx, "poll"), input.Config, "/tasks/"+url.PathEscape(taskID), &payload); err != nil {
			return videoPollOutcome{}, err
		}
		data, _ := payload["data"].(map[string]any)
		if data == nil {
			return videoPollOutcome{}, errors.New("APIMart GPT-Image-2 查询任务未返回 data")
		}
		switch strings.ToLower(strings.TrimSpace(stringField(data, "status"))) {
		case "completed", "succeeded", "success":
			images, err := apimartExtResultImages(data)
			if err != nil {
				return videoPollOutcome{}, err
			}
			for _, image := range images {
				imageURL := image["dataUrl"]
				if !isPublicMediaURL(imageURL) {
					return videoPollOutcome{}, errors.New("APIMart GPT-Image-2 返回的图片地址无效")
				}
				content, mimeType, err := getProviderExternalBinary(withProviderRequestKind(pollCtx, "download"), input.Config, imageURL)
				if err != nil {
					return videoPollOutcome{}, fmt.Errorf("APIMart GPT-Image-2 图片下载失败：%w", err)
				}
				mimeType = strings.ToLower(normalizedMediaMimeType(mimeType, content))
				if len(content) == 0 || !strings.HasPrefix(mimeType, "image/") || !strings.HasPrefix(strings.ToLower(http.DetectContentType(content)), "image/") {
					return videoPollOutcome{}, errors.New("APIMart GPT-Image-2 图片结果无效")
				}
				image["dataUrl"] = dataURL(mimeType, content)
				image["mimeType"] = mimeType
			}
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "image", "images": images}}, nil
		case "failed", "error", "cancelled", "canceled", "expired":
			code, message := providerFailureDetails(data)
			if message == "" {
				message = "图片生成任务失败"
			}
			return videoPollOutcome{}, fmt.Errorf("APIMart GPT-Image-2 任务 %s 失败（%s）：%s", taskID, code, providerPayloadErrorMessage(message))
		case "pending", "processing", "running", "queued", "submitted":
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{}, errors.New("APIMart GPT-Image-2 返回未知任务状态")
		}
	})
}
