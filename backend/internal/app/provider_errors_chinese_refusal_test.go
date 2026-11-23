package app

import (
	"net/http"
	"strings"
	"testing"
)

// 中文供应商的内容安全拒绝原先落到「请检查模型和参数」等通用文案，用户会去改参数或换模型，而不是改内容。
func TestProviderChineseSafetyRefusalUsesModerationMessage(t *testing.T) {
	const moderation = "请求内容未通过模型服务安全审核，请调整后重试"
	for name, body := range map[string]string{
		"image refusal":  `{"error":{"message":"非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。"}}`,
		"policy":         `{"message":"请求触发了平台安全策略，已拦截"}`,
		"content safety": `{"msg":"输入包含违规内容，内容安全检查未通过"}`,
	} {
		for _, status := range []int{http.StatusBadRequest, http.StatusUnprocessableEntity} {
			got := providerHTTPError{StatusCode: status, Status: http.StatusText(status), Body: body}.Error()
			if !strings.HasPrefix(got, moderation) {
				t.Errorf("%s/%d: %q, want moderation message", name, status, got)
			}
		}
		if got := providerErrorWithDetail("模型服务返回失败，请检查请求内容或渠道配置", body); !strings.HasPrefix(got, moderation) {
			t.Errorf("%s/business failure: %q, want moderation message", name, got)
		}
	}
	if got := (providerHTTPError{StatusCode: http.StatusBadRequest, Status: "400 Bad Request", Body: `{"error":{"message":"参数 size 不合法"}}`}).Error(); strings.HasPrefix(got, moderation) {
		t.Errorf("普通参数错误不应归为安全审核：%q", got)
	}
	if got := providerErrorWithDetail("请求失败", `{"error":{"message":"参数 size 不合法"},"prompt":"内容安全检查未通过"}`); strings.HasPrefix(got, moderation) {
		t.Errorf("回显的提示词不能决定错误类别：%q", got)
	}
	if got := providerErrorWithDetail("请求失败", `{"code":"RequestParameterIsWrong","message":"内容安全检查未通过"}`); strings.HasPrefix(got, moderation) {
		t.Errorf("明确的参数错误码应优先于消息中的安全措辞：%q", got)
	}
}

// 线上图片网关的真实正文：审核拒绝带着通用的 invalid_request_error 类型，或措辞是“违反了我们的内容政策”，
// 原先都落到「模型服务拒绝了请求，请检查模型和参数」。
func TestProviderModerationRefusalBehindGenericRequestType(t *testing.T) {
	for name, body := range map[string]string{
		"text reply code":  `{"error":{"code":"upstream_text_reply","message":"非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。如果你认为此判断有误，请重试或修改提示语。","type":"invalid_request_error"}}`,
		"prompt policy":    `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","message":"非常抱歉，该提示可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。","param":"","type":"image_generation_error"}}`,
		"image policy":     `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","message":"非常抱歉，生成的图片可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。","param":"","type":"image_generation_error"}}`,
		"prompt guardrail": `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","message":"非常抱歉，该提示可能违反了关于骚扰、歧视、霸凌的防护限制。","param":"","type":"image_generation_error"}}`,
	} {
		if got := (providerHTTPError{StatusCode: http.StatusBadRequest, Status: "400 Bad Request", Body: body}).Error(); !strings.HasPrefix(got, providerModerationMessage) {
			t.Errorf("%s: %q, want moderation message", name, got)
		}
	}
	for name, body := range map[string]string{
		// 通用类型之外还有明确的参数错误码时，错误码优先。
		"explicit parameter code": `{"error":{"code":"invalid_parameter","message":"非常抱歉，该提示可能违反了我们的内容政策。","type":"invalid_request_error"}}`,
		"english parameter error": `{"error":{"message":"Invalid value for size","type":"invalid_request_error"}}`,
		"chinese parameter error": `{"error":{"message":"图片尺寸不支持","type":"invalid_request_error"}}`,
	} {
		if got := (providerHTTPError{StatusCode: http.StatusBadRequest, Status: "400 Bad Request", Body: body}).Error(); !strings.HasPrefix(got, providerRejectedRequestMessage) {
			t.Errorf("%s: %q, want parameter rejection", name, got)
		}
	}
}

// 图片模型只回了一段聊天文字（要求上传照片，或说无法在对话里出图）不是参数错误。
func TestProviderChatReplyInsteadOfImage(t *testing.T) {
	for name, body := range map[string]string{
		"asks for photos": `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","message":"请上传需要处理的真实照片（可一次上传多张）。\n\n我会按照你的要求，**每张照片独立生成一张 3:4 竖版海报**，不混图、不拼图。","param":"","type":"image_generation_error"}}`,
		"chat only":       `{"error":{"code":"GPT_IMAGE_UPSTREAM_ERROR","message":"我目前无法在此聊天中直接生成或修改图片，但可以帮你整理精准的局部替换提示词。","param":"","type":"image_generation_error"}}`,
		"text reply code": `{"error":{"code":"upstream_text_reply","message":"好的，下面先说明这张海报的构图思路。","type":"invalid_request_error"}}`,
	} {
		got := (providerHTTPError{StatusCode: http.StatusBadRequest, Status: "400 Bad Request", Body: body}).Error()
		if !strings.HasPrefix(got, providerChatReplyMessage) {
			t.Errorf("%s: %q, want chat reply message", name, got)
		}
	}
	for name, body := range map[string]string{
		"missing first frame":   `{"error":{"message":"请上传首帧图片"}}`,
		"unreadable reference":  `{"error":{"message":"无法读取参考图片"}}`,
		"conversation too long": `{"error":{"message":"对话过长，无法继续"}}`,
	} {
		if got := (providerHTTPError{StatusCode: http.StatusBadRequest, Status: "400 Bad Request", Body: body}).Error(); strings.HasPrefix(got, providerChatReplyMessage) {
			t.Errorf("%s: validation error misread as chat reply: %q", name, got)
		}
	}
}
