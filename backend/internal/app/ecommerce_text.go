package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"time"

	_ "golang.org/x/image/webp"

	"yingce/backend/internal/imagetext"
	"yingce/backend/internal/model"
)

type EcommerceImageTextDetection struct {
	ResourceID string             `json:"resourceId"`
	Width      int                `json:"width"`
	Height     int                `json:"height"`
	Regions    []imagetext.Region `json:"regions"`
}

// OCR is local read-only processing, not a billable generation. Limit concurrent
// native OCR jobs so repeated requests cannot starve in-flight generation work.
var ecommerceTextSlots = make(chan struct{}, 2)

func (s *Service) DetectEcommerceImageText(ctx context.Context, userID, resourceID string) (*EcommerceImageTextDetection, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(resourceID) == "" {
		return nil, BadAuthRequest("请选择已保存的图片")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return nil, NotFound("图片不存在或不可访问")
	}
	if resource.Size > 32<<20 {
		return nil, BadAuthRequest("图片超过32MB，请先缩小图片后识别")
	}
	select {
	case ecommerceTextSlots <- struct{}{}:
		defer func() { <-ecommerceTextSlots }()
	default:
		return nil, RateLimited("文字识别正在处理其他图片，请稍后重试")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	_, stream, err := s.openResourceContext(ctx, userID, resourceID)
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, (32<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 32<<20 {
		return nil, BadAuthRequest("图片超过32MB，请先缩小图片后识别")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, BadAuthRequest("图片无法解码，请使用PNG、JPEG或WebP原图")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 8000 || config.Height > 40000 || int64(config.Width)*int64(config.Height) > 48_000_000 {
		return nil, BadAuthRequest("图片尺寸超过文字识别上限，请按屏拆分后识别")
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, BadAuthRequest("图片读取不完整，请重新上传原图")
	}
	regions, err := imagetext.Detect(ctx, source)
	if errors.Is(err, imagetext.ErrUnavailable) {
		failure := NewAppError(http.StatusServiceUnavailable, "文字识别服务未就绪，请联系管理员安装中文和英文识别组件")
		failure.Reason = "OCR_UNAVAILABLE"
		return nil, failure
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, NewAppError(http.StatusRequestTimeout, "文字识别超时或已取消，请拆分长图后重试")
		}
		return nil, WrapAppError(http.StatusBadGateway, "文字识别未完成，请重新识别或更换清晰原图", err)
	}
	return &EcommerceImageTextDetection{ResourceID: resourceID, Width: config.Width, Height: config.Height, Regions: regions}, nil
}
