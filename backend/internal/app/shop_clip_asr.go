package app

import (
	"context"
	"net/url"
	"os"
	"strings"
)

const shopClipWhisperEnv = "CANVAS_SHOP_CLIP_WHISPER_BASE_URL"

type shopClipTranscriber func(context.Context, string) ([]timelineTranscriptionSegment, string, error)

func (s *Service) shopClipTranscriberFor(userID string) (shopClipTranscriber, string) {
	if baseURL := strings.TrimSpace(firstNonEmpty(os.Getenv(shopClipWhisperEnv), os.Getenv(whisperLangEnv))); baseURL != "" {
		parsed, err := url.Parse(baseURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, "剪辑专用语音识别地址无效，请配置 HTTP 或 HTTPS 服务地址"
		}
		return func(ctx context.Context, wavPath string) ([]timelineTranscriptionSegment, string, error) {
			segments, language, err := newWhisperClient(baseURL).transcribe(ctx, wavPath, "")
			return segments, language, err
		}, ""
	}
	return nil, "请配置剪辑专用或通用 Whisper 语音识别服务；视频理解听写不能用于精确字幕"
}
