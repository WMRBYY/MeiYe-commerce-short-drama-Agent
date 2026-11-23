package app

import (
	"encoding/json"
	"regexp"
	"strings"
)

// 用户可见的固定原因。供应商正文只参与归类，不作为用户提示回显。
const (
	providerRejectedRequestMessage = "模型服务拒绝了请求，请检查模型和参数"
	providerModerationMessage      = "请求内容未通过模型服务安全审核，请调整后重试"
	providerChatReplyMessage       = "模型没有生成图片，只回复了文字。如提示词要求处理照片，请先添加参考图；否则请调整提示词或换个模型重试"
)

var providerErrorURL = regexp.MustCompile(`(?i)https?://[^\s<>"'，。；）]+`)
var providerErrorSensitive = regexp.MustCompile(`(?i)余额|额度|配额|欠费|账单|充值|计费|密钥|密码|令牌|balance|quota|billing|credit|payment|funds|wallet|api[ _-]?key|authorization|bearer|cookie|(?:access|refresh|auth|session)[ _-]?token|token\s*[=:]|secret|password|credential|sk-[a-z0-9]|tenant|trace[ _-]?id|request[ _-]?id|internal stack|stack\s*trace|dial tcp|no such host|prompt\s*[=:]`)

// 只提取错误消息字段，不序列化整个响应，避免回传 headers、请求正文和诊断信息。
func providerErrorDetail(raw string) string {
	raw = strings.TrimSpace(raw)
	var payload any
	if json.Unmarshal([]byte(raw), &payload) == nil {
		raw = providerErrorMessageField(payload)
	} else if strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") {
		return ""
	}
	// 网关 HTML、敏感账务/凭据诊断整条隐藏；普通消息里的 URL 单独移除。
	if strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") || strings.ContainsAny(raw, "<>") || providerErrorSensitive.MatchString(raw) {
		return ""
	}
	raw = providerErrorURL.ReplaceAllString(raw, "[链接已隐藏]")
	return truncateRunes(strings.Join(strings.Fields(raw), " "), 1_500)
}

func providerErrorMessageField(value any) string {
	switch value := value.(type) {
	case string:
		return strings.TrimSpace(value)
	case map[string]any:
		for _, key := range []string{"error", "message", "msg", "detail"} {
			if message := providerErrorMessageField(value[key]); message != "" {
				return message
			}
		}
	}
	return ""
}

func providerErrorWithDetail(fallback, raw string) string {
	message, ok := providerPayloadErrorCategory(raw)
	if !ok || (message == providerRejectedRequestMessage && providerOnlyGenericRequestType(raw)) {
		// Only classify an extracted provider message, never echoed prompts or
		// unrelated fields. Explicit provider categories retain precedence.
		detail := providerErrorDetail(raw)
		switch {
		case providerChineseModerationRefusal(detail):
			message, ok = providerModerationMessage, true
		case providerChatReplyInsteadOfImage(providerErrorCode(raw), detail):
			message, ok = providerChatReplyMessage, true
		}
	}
	if ok {
		fallback = message
	}
	return appendProviderErrorDetail(fallback, raw)
}

// OpenAI 兼容网关把所有 400（包括内容审核拒绝）都标成 invalid_request_error 类型。
// 只有这个通用类型、没有明确的参数错误码时，不能据此判成参数错误，要以上游正文为准。
func providerOnlyGenericRequestType(raw string) bool {
	normalized := strings.ToLower(raw)
	if !strings.Contains(normalized, "invalid_request_error") {
		return false
	}
	_, ok := providerPayloadErrorCategory(strings.ReplaceAll(normalized, "invalid_request_error", ""))
	return !ok
}

func providerErrorCode(raw string) string {
	var payload map[string]any
	if json.Unmarshal([]byte(strings.TrimSpace(raw)), &payload) != nil {
		return ""
	}
	if nested, ok := payload["error"].(map[string]any); ok {
		if code, ok := nested["code"].(string); ok {
			return strings.TrimSpace(code)
		}
	}
	code, _ := payload["code"].(string)
	return strings.TrimSpace(code)
}

func providerChineseModerationRefusal(message string) bool {
	return strings.Contains(message, "内容安全检查未通过") ||
		(strings.Contains(message, "安全策略") && strings.Contains(message, "拦截")) ||
		(strings.Contains(message, "违反") && (strings.Contains(message, "防护限制") || strings.Contains(message, "内容政策")))
}

// 部分图片网关在模型只回了一段聊天文字时返回 400：让用户先上传照片，或说无法在对话里出图。
// 这不是参数错误。按网关错误码或第一人称的聊天措辞识别，只用来选择固定提示。
func providerChatReplyInsteadOfImage(code, message string) bool {
	if strings.EqualFold(code, "upstream_text_reply") {
		return true
	}
	image := strings.Contains(message, "图片") || strings.Contains(message, "照片") || strings.Contains(message, "图像")
	asksUpload := strings.Contains(message, "请上传") && (strings.Contains(message, "我会") || strings.Contains(message, "我将") || strings.Contains(message, "我可以"))
	chatOnly := strings.Contains(message, "无法") && (strings.Contains(message, "对话") || strings.Contains(message, "聊天"))
	return image && (asksUpload || chatOnly)
}

func appendProviderErrorDetail(fallback, raw string) string {
	if detail := providerErrorDetail(raw); detail != "" && detail != fallback {
		return fallback + "；上游：" + detail
	}
	return fallback
}
