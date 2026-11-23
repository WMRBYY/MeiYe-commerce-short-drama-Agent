package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"yingce/backend/internal/model"
)

// APIMart Ext uses ratio-valued size, a separate resolution, and an asynchronous
// task response. The ordinary OpenAI Images plugin expects pixels and a synchronous
// image response, so this model needs its own narrow transport adapter.
func isAPIMartExtImage(input canvasGenerationInput) bool {
	if input.Mode != "image" || input.Config.InterfaceType != string(model.ChannelInterfaceOpenAIImage) || !strings.EqualFold(strings.TrimSpace(input.Config.Model), "gpt-image-2.5-ext") {
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

var apimartExtRatios = []string{"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"}

func apimartExtRatio(raw string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(raw, "×", "x")))
	if value == "" || value == "auto" {
		return "auto", nil
	}
	for _, ratio := range apimartExtRatios {
		if value == ratio {
			return ratio, nil
		}
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return "", errors.New("APIMart Ext 仅支持 auto 或预设宽高比")
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return "", errors.New("APIMart Ext 图片尺寸无效")
	}
	actual := float64(width) / float64(height)
	for _, ratio := range apimartExtRatios {
		sides := strings.Split(ratio, ":")
		w, _ := strconv.Atoi(sides[0])
		h, _ := strconv.Atoi(sides[1])
		if math.Abs(actual-float64(w)/float64(h)) <= 0.025 {
			return ratio, nil
		}
	}
	return "", errors.New("APIMart Ext 不支持当前像素比例，请选择预设宽高比")
}

func apimartExtResolution(quality string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "", "auto", "low", "1k":
		return "1K", nil
	case "medium", "2k":
		return "2K", nil
	case "high", "4k":
		return "4K", nil
	default:
		return "", errors.New("APIMart Ext 仅支持 1K、2K、4K 分辨率")
	}
}

func apimartExtRequestBody(input canvasGenerationInput) (map[string]any, error) {
	if input.Mask != nil {
		return nil, errors.New("APIMart Ext 不支持蒙版编辑")
	}
	if len(input.ReferenceImages) > 16 {
		return nil, errors.New("APIMart Ext 最多支持 16 张参考图")
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("APIMart Ext 提示词不能为空")
	}
	ratio, err := apimartExtRatio(input.Config.Size)
	if err != nil {
		return nil, err
	}
	resolution, err := apimartExtResolution(input.Config.Quality)
	if err != nil {
		return nil, err
	}
	count := 1
	if strings.TrimSpace(input.Config.Count) != "" {
		count, err = strconv.Atoi(strings.TrimSpace(input.Config.Count))
		if err != nil || count < 1 || count > 4 {
			return nil, errors.New("APIMart Ext 单次仅支持生成 1 至 4 张图片")
		}
	}
	version := "flare"
	urls := make([]string, 0, len(input.ReferenceImages))
	if len(input.ReferenceImages) > 0 {
		version = "sunburst"
		for _, image := range input.ReferenceImages {
			value, err := openAIImageInputURL(image)
			if err != nil {
				return nil, err
			}
			urls = append(urls, value)
		}
	}
	body := map[string]any{
		"model": input.Config.Model, "version": version,
		"prompt": withSystemPrompt(input.Config, input.Prompt),
		"size":   ratio, "resolution": resolution, "n": count,
	}
	if len(urls) > 0 {
		body["image_urls"] = urls
	}
	return body, nil
}

func runAPIMartExtImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	// Validate before contacting the upstream so an invalid model selection never
	// creates a billable order or an ambiguous submission.
	body, err := apimartExtRequestBody(input)
	if err != nil {
		return nil, err
	}
	taskID := resumedProviderRequestID(ctx)
	if taskID == "" {
		payload, err := submitAPIMartExtImage(ctx, input.Config, body)
		if err != nil {
			return nil, err
		}
		taskID = apimartExtTaskID(payload)
		if taskID == "" {
			return nil, errors.New("APIMart Ext 已返回成功，但缺少任务 ID；请查看上游调用记录，避免重复提交")
		}
	}
	policy := videoPollPolicy{InitialDelay: 2 * time.Second, Interval: 3 * time.Second, MaxNotFoundMisses: 3, RetryTransient: true, Sleep: sleepContext}
	return runVideoPollLoop(ctx, taskID, policy, func(pollCtx context.Context) (videoPollOutcome, error) {
		var payload map[string]any
		path := "/tasks/" + url.PathEscape(taskID)
		if err := getJSON(withProviderRequestKind(pollCtx, "poll"), input.Config, path, &payload); err != nil {
			return videoPollOutcome{}, err
		}
		data, _ := payload["data"].(map[string]any)
		if data == nil {
			return videoPollOutcome{}, errors.New("APIMart Ext 查询任务未返回 data")
		}
		switch strings.ToLower(strings.TrimSpace(stringField(data, "status"))) {
		case "completed", "succeeded", "success":
			images, err := apimartExtResultImages(data)
			if err != nil {
				return videoPollOutcome{}, err
			}
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "image", "images": images}}, nil
		case "failed", "error", "cancelled", "canceled", "expired":
			code, message := providerFailureDetails(data)
			if message == "" {
				message = "图片生成任务失败"
			}
			return videoPollOutcome{}, fmt.Errorf("APIMart Ext 任务 %s 失败（%s）：%s", taskID, code, providerPayloadErrorMessage(message))
		case "pending", "processing", "running", "queued", "submitted":
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{}, errors.New("APIMart Ext 返回未知任务状态")
		}
	})
}

func submitAPIMartExtImage(ctx context.Context, config providerConfig, body map[string]any) (map[string]any, error) {
	return submitAPIMartImage(ctx, config, body, true)
}

func submitAPIMartImage(ctx context.Context, config providerConfig, body map[string]any, versioned bool) (map[string]any, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(withProviderRequestKind(ctx, "create"), http.MethodPost, apiURL(config.BaseURL, "/images/generations"), bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	applyProviderAuth(req, config)
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	if versioned {
		req.Header.Set("X-APIMart-Response-Version", "2026-07-27")
	}
	key, _ := ctx.Value(providerSubmissionKeyContext{}).(string)
	if key == "" {
		key = uuid.NewString()
	}
	req.Header.Set("Idempotency-Key", key)
	var payload map[string]any
	if err := doJSON(req, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func apimartExtTaskID(payload map[string]any) string {
	if data, ok := payload["data"].(map[string]any); ok {
		return firstNonEmptyString(stringField(data, "id"), stringField(data, "task_id"))
	}
	if data, ok := payload["data"].([]any); ok && len(data) > 0 {
		if first, ok := data[0].(map[string]any); ok {
			return firstNonEmptyString(stringField(first, "task_id"), stringField(first, "id"))
		}
	}
	return ""
}

func apimartExtResultImages(data map[string]any) ([]map[string]string, error) {
	result, _ := data["result"].(map[string]any)
	items, _ := result["images"].([]any)
	images := make([]map[string]string, 0)
	for _, item := range items {
		entry, _ := item.(map[string]any)
		if single := stringField(entry, "url"); single != "" {
			images = append(images, map[string]string{"dataUrl": single})
		}
		if urls, ok := entry["url"].([]any); ok {
			for _, raw := range urls {
				if imageURL, ok := raw.(string); ok && strings.TrimSpace(imageURL) != "" {
					images = append(images, map[string]string{"dataUrl": imageURL})
				}
			}
		}
	}
	if len(images) == 0 {
		return nil, errors.New("APIMart Ext 任务已完成，但没有返回图片地址")
	}
	return images, nil
}
