package assets

import (
	"net/http"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

type AccessPurpose string
type ResourceVariant string
type DeliveryMode string

const (
	PurposeDisplay         AccessPurpose   = "display"
	PurposeCopy            AccessPurpose   = "copy"
	PurposeDownload        AccessPurpose   = "download"
	PurposeProcess         AccessPurpose   = "browser-process"
	PurposePSDLayer        AccessPurpose   = "psd-layer"
	PurposeEcommerceExport AccessPurpose   = "ecommerce-export"
	PurposeProvider        AccessPurpose   = "provider-input"
	VariantOriginal        ResourceVariant = "original"
	VariantPlayback        ResourceVariant = "playback"
	// VariantThumbnail 是画布展示档位；缩略图不可用时返回明确错误，不能退回原件。
	VariantThumbnail      ResourceVariant = "thumbnail"
	VariantThumbnailSmall ResourceVariant = "thumbnail-small"
	DeliveryCDN           DeliveryMode    = "cdn"
	DeliveryOrigin        DeliveryMode    = "origin"
	DeliveryLocal         DeliveryMode    = "platform-local"
	DeliveryProxy         DeliveryMode    = "platform-proxy"
)

// AccessOptions contains use intent, never a client-controlled authorization or transport override.
type AccessOptions struct {
	Purpose      AccessPurpose   `json:"purpose"`
	Variant      ResourceVariant `json:"variant"`
	DownloadName string          `json:"downloadName,omitempty"`
	ExpiresAt    time.Time       `json:"-"`
	DescribeOnly bool            `json:"-"`
}

type AccessRequest struct {
	ResourceID string `json:"resourceId"`
	AccessOptions
}

type ResourceAccess struct {
	ResourceID       string          `json:"resourceId"`
	RequestedVariant ResourceVariant `json:"requestedVariant"`
	ActualVariant    ResourceVariant `json:"actualVariant"`
	URL              string          `json:"url"`
	Delivery         DeliveryMode    `json:"delivery"`
	IssuedAt         time.Time       `json:"issuedAt"`
	ExpiresAt        *time.Time      `json:"expiresAt"`
	RefreshAt        time.Time       `json:"refreshAt"`
	Revision         string          `json:"revision"`
	FallbackReason   string          `json:"fallbackReason,omitempty"`
}

func AccessError(status int, reason, message string) *kernel.AppError {
	err := kernel.NewAppError(status, message)
	err.Reason = kernel.ErrorReason(reason)
	return err
}

func NormalizeAccessOptions(options AccessOptions, allowProvider bool) (AccessOptions, error) {
	if options.Purpose == "" {
		options.Purpose = PurposeDisplay
	}
	if options.Variant == "" {
		options.Variant = VariantOriginal
	}
	switch options.Purpose {
	case PurposeDisplay, PurposeCopy, PurposeDownload, PurposeProcess, PurposePSDLayer, PurposeEcommerceExport:
	case PurposeProvider:
		if !allowProvider {
			return options, kernel.Forbidden("不允许请求模型输入凭据")
		}
	default:
		return options, kernel.BadAuthRequest("资源访问用途无效")
	}
	if options.Variant != VariantOriginal && options.Variant != VariantPlayback && options.Variant != VariantThumbnail && options.Variant != VariantThumbnailSmall {
		return options, kernel.BadAuthRequest("资源变体无效")
	}
	if options.Purpose == PurposeCopy || options.Purpose == PurposeDownload || options.Purpose == PurposeProvider || options.Purpose == PurposePSDLayer || options.Purpose == PurposeEcommerceExport {
		options.Variant = VariantOriginal
	}
	if options.Purpose != PurposeDownload {
		options.DownloadName = ""
	}
	return options, nil
}

// ResolveAccess is the sole delivery policy. The caller must authorize resource ownership/scene first.
// Local URL signing is injected by the composition root; storage adapters never know application keys.
func ResolveAccess(resource *model.Resource, setting storage.Settings, options AccessOptions, now time.Time,
	platformURL func(ResourceVariant, time.Time) (string, error)) (*ResourceAccess, error) {
	options, err := NormalizeAccessOptions(options, true)
	if err != nil {
		return nil, err
	}
	if resource == nil {
		return nil, kernel.NotFound("资源不存在")
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, AccessError(http.StatusConflict, "resource_not_ready", "资源尚未上传完成")
	}
	if options.Purpose == PurposePSDLayer {
		if resource.Kind != "image" || resource.Size > 32*1024*1024 || resource.Size <= 0 {
			return nil, AccessError(http.StatusBadRequest, "psd_layer_invalid", "PSD 图层只支持 32 MB 以内的图片资源")
		}
	}
	if options.Purpose == PurposeEcommerceExport && (resource.Kind != "image" || resource.Size > 32*1024*1024 || resource.Size <= 0 || (resource.MimeType != "image/png" && resource.MimeType != "image/jpeg" && resource.MimeType != "image/webp")) {
		return nil, AccessError(http.StatusBadRequest, "ecommerce_export_invalid", "电商导出仅支持32 MB以内的PNG、JPEG和WebP商品图片")
	}
	// 有效期来自后台「资源与请求策略」；未注入运行时策略时回落到存储层默认值（均为 4 小时）。
	runtime := storage.NormalizeSettings(storage.Settings{Runtime: setting.Runtime}).Runtime
	ttl := runtime.AccessURLTTL
	if options.Purpose == PurposeProvider {
		ttl = runtime.ProviderAccessURLTTL
	}
	// 服务器本地已生成缩略图时，展示缩略图由本服务直接读取，不经 CDN/对象存储，
	// 也不受 CDN 短时签名有效期约束（沿用平台签名有效期，便于浏览器缓存）。
	localThumbnail := (options.Variant == VariantThumbnail || options.Variant == VariantThumbnailSmall) &&
		(resource.Kind == "image" || resource.Kind == "video") && resource.ThumbnailStatus == model.ThumbnailStatusReady && resource.ThumbnailMimeType != ""
	signedCDN := storage.SignedCDNMode(setting)
	if signedCDN && options.Purpose != PurposeProvider && !localThumbnail {
		ttl = storage.CDNURLTTL(setting)
	}
	// 浏览器读取的签名地址按固定时间窗对齐：窗口内同一对象的签名地址逐字节相同，
	// 刷新页面或多实例签发都能命中浏览器 HTTP 缓存，不会重复从对象存储拉取字节。
	signedAt := time.Time{}
	if browserCacheable(options.Purpose) {
		signedAt = alignedSigningTime(now, ttl)
	}
	expires := now.Add(ttl)
	if !signedAt.IsZero() {
		expires = signedAt.Add(ttl)
	}
	if !options.ExpiresAt.IsZero() && options.ExpiresAt.Before(expires) {
		expires = options.ExpiresAt
	}
	if !expires.After(now) {
		return nil, kernel.Forbidden("资源授权已过期")
	}
	access := &ResourceAccess{ResourceID: resource.ID, RequestedVariant: options.Variant, ActualVariant: VariantOriginal,
		IssuedAt: now, ExpiresAt: &expires, RefreshAt: now.Add(expires.Sub(now) * 4 / 5), Revision: resource.ETag + ":" + resource.PlaybackStatus + ":" + resource.ThumbnailStatus + ":" + storage.DeliveryRevision(setting)}
	if options.Variant == VariantPlayback {
		if (resource.Provider == "local" || (setting.Provider == "aliyun" && setting.Delivery.PrivateMediaProxy)) && resource.PlaybackStatus == model.PlaybackStatusReady && resource.PlaybackObjectKey != "" {
			access.ActualVariant = VariantPlayback
		} else {
			access.FallbackReason = "playback_not_ready"
		}
	}
	if options.Variant == VariantThumbnail || options.Variant == VariantThumbnailSmall {
		access.FallbackReason = "thumbnail_not_ready"
	}
	if localThumbnail {
		access.ActualVariant = options.Variant
		access.FallbackReason = ""
	}
	if (options.Variant == VariantThumbnail || options.Variant == VariantThumbnailSmall) && access.ActualVariant != options.Variant {
		return nil, AccessError(http.StatusServiceUnavailable, "resource_thumbnail_unavailable", "服务器缩略图暂不可用，请稍后重试")
	}
	if options.Purpose == PurposeEcommerceExport {
		// ZIP 和目标画幅导出需要读取图片字节；仅此受限用途走所有权校验后的同源流。
		access.Delivery = DeliveryProxy
		access.FallbackReason = "ecommerce_export_processing"
		access.ExpiresAt = nil
	} else if options.Purpose == PurposePSDLayer {
		// PSD 合成需要读取像素；此受限用途经所有权校验后走同源字节流，
		// 避免对象存储展示 CDN 的跨域限制阻断导出。
		access.Delivery = DeliveryProxy
		access.FallbackReason = "psd_layer_processing"
		access.ExpiresAt = nil
	} else if resource.Provider == "local" || localThumbnail {
		access.Delivery = DeliveryLocal
	} else if setting.Provider == "aliyun" && setting.Delivery.PrivateMediaProxy && options.Purpose != PurposeProvider {
		// A private bucket is never exposed through a CDN or a signed origin
		// redirect to the browser. The authenticated resource route streams it.
		access.Delivery = DeliveryProxy
		access.FallbackReason = "private_bucket"
		// The browser URL is session-authorized on every request, not a bearer
		// token that expires after the storage URL TTL.
		access.ExpiresAt = nil
	} else if !InlineMediaType(resource.MimeType) {
		// A redirect cannot enforce our attachment and sandbox response headers.
		access.Delivery = DeliveryProxy
		access.FallbackReason = "attachment_required"
	} else if options.Purpose == PurposeDownload && signedCDN && setting.CDNBaseURL != "" {
		access.URL, err = storage.SignedCDNDownloadURL(setting, resource.ObjectKey, expires, options.DownloadName)
		access.Delivery = DeliveryCDN
	} else if options.Purpose == PurposeDownload && setting.Delivery.CDNAuthMode == "public" && storage.CDNEnabled(setting) {
		// Public COS/OSS CDN deployments can forward this response override to
		// their origin. Keeping it on the download-only URL lets images and
		// videos continue to use their normal inline CDN URL for display.
		access.URL, err = storage.PublicCDNObjectDownloadURL(setting, resource.ObjectKey, options.DownloadName)
		access.Delivery = DeliveryCDN
		access.ExpiresAt = nil
	} else if options.Purpose == PurposeDownload {
		// Cross-origin `a[download]` is only advisory. A real browser download must
		// therefore be enforced by the object store response itself. Downloads use
		// a signed origin URL carrying Content-Disposition=attachment; media bytes
		// never pass through the application server or a Blob relay.
		if !storage.PublicOrigin(setting) {
			return nil, AccessError(503, "resource_origin_private", "对象存储源站不可由浏览器直连，无法在不占用服务器带宽的前提下下载")
		}
		access.URL, err = storage.SignedOriginObjectDownloadURL(setting, resource.ObjectKey, expires, options.DownloadName)
		access.Delivery = DeliveryOrigin
	} else if options.Purpose == PurposeProvider && signedCDN {
		// 模型供应商由服务端读取，继续使用源站预签名，不发放 CDN 短时签名。
		access.URL, err = storage.SignedOriginObjectURL(setting, resource.ObjectKey, expires)
		access.Delivery = DeliveryOrigin
	} else if storage.CDNEnabled(setting) {
		access.URL, err = storage.SignCDNURL(setting, resource.ObjectKey, expires)
		access.Delivery = DeliveryCDN
		if setting.Delivery.CDNAuthMode == "public" {
			access.ExpiresAt = nil
		}
	} else if setting.Delivery.RequireCDN {
		return nil, AccessError(503, "resource_cdn_unconfigured", "CDN 访问鉴权未配置，请检查存储分发设置")
	} else if storage.PublicOrigin(setting) {
		if signedAt.IsZero() {
			access.URL, err = storage.SignedOriginObjectURL(setting, resource.ObjectKey, expires)
		} else {
			access.URL, err = storage.SignedOriginObjectDisplayURL(setting, resource.ObjectKey, signedAt, expires)
		}
		access.Delivery = DeliveryOrigin
		if setting.CDNBaseURL != "" {
			access.FallbackReason = "cdn_auth_unconfigured"
		}
	} else if options.Purpose == PurposeProvider && setting.Delivery.AllowPrivateProxy {
		// Only the server-side provider-input path may opt into a private-origin
		// proxy. Browser display/copy/process/download traffic for OSS resources
		// must never relay media bytes through the application server.
		access.Delivery = DeliveryProxy
		access.FallbackReason = "private_origin"
	} else {
		return nil, AccessError(503, "resource_origin_private", "对象存储源站不可由浏览器直连，请配置公网 OSS 源站或 CDN")
	}
	if err != nil {
		failure := AccessError(503, "resource_signing_failed", "资源访问地址签发失败，请检查存储分发设置")
		failure.Cause = err
		return nil, failure
	}
	if access.Delivery == DeliveryLocal || access.Delivery == DeliveryProxy {
		access.URL, err = platformURL(access.ActualVariant, expires)
		if err != nil {
			return nil, err
		}
	}
	return access, nil
}

// browserCacheable 标记浏览器直接读取字节、值得复用 HTTP 缓存的用途。
// 下载地址携带一次性的 Content-Disposition，模型输入由上游服务读取，二者仍按当前时间签发。
func browserCacheable(purpose AccessPurpose) bool {
	return purpose == PurposeDisplay || purpose == PurposeProcess || purpose == PurposeCopy
}

// alignedSigningTime 把签名起始时间对齐到 ttl/4 的时间窗（按 Unix 纪元对齐，多实例结果一致）。
// 地址过期时间为「窗口起点 + ttl」，任何时刻签出的地址至少还剩 3/4 有效期，且总有效期不超过后台配置的 ttl。
func alignedSigningTime(now time.Time, ttl time.Duration) time.Time {
	window := ttl / 4
	if window < time.Second {
		return now.UTC()
	}
	unix := now.UTC().UnixNano()
	return time.Unix(0, unix-unix%int64(window)).UTC()
}
