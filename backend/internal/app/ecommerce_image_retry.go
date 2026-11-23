package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

const ecommerceImageOutputInstruction = "请直接使用随请求提交的商品参考图完成这一张图片，返回实际生成的图片。画面文案按以下要求呈现在图片中。"

// A confirmed text-only response has no image or provider job to recover.
// Retry once inside the same task with its original references and billing order.
func runEcommerceReferenceImage(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	result, err := runImageProvider(ctx, input)
	if ctx.Err() != nil || !ecommerceImageTextReply(err) {
		return result, err
	}
	input.Prompt = ecommerceImageOutputInstruction + "\n\n" + input.Prompt
	result, err = runImageProvider(ctx, input)
	if ecommerceImageTextReply(err) {
		err = WrapAppError(http.StatusBadRequest, "模型只返回了文字，这张图未生成。可单独重试。", err)
	}
	return result, err
}

func ecommerceImageTextReply(err error) bool {
	var failure providerHTTPError
	if !errors.As(err, &failure) || failure.StatusCode != http.StatusBadRequest {
		return false
	}
	// Only use the error-only response shape seen on synchronous image edits.
	// Additional payload fields could carry a job, output, or billing usage.
	var payload map[string]json.RawMessage
	if json.Unmarshal([]byte(failure.Body), &payload) != nil || len(payload) != 1 {
		return false
	}
	var detail map[string]json.RawMessage
	if json.Unmarshal(payload["error"], &detail) != nil {
		return false
	}
	for key := range detail {
		switch key {
		case "code", "type", "param", "message":
		default:
			return false
		}
	}
	code := providerErrorCode(failure.Body)
	switch strings.ToLower(code) {
	case "upstream_text_reply", "gpt_image_upstream_error":
		if category, ok := providerPayloadErrorCategory(failure.Body); ok && (category != providerRejectedRequestMessage || !providerOnlyGenericRequestType(failure.Body)) {
			return false
		}
		message := providerErrorDetail(failure.Body)
		return !providerChineseModerationRefusal(message) && providerChatReplyInsteadOfImage(code, message)
	default:
		return false
	}
}
