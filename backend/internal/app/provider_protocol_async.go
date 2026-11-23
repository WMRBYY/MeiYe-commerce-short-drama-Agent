// 声明式协议的长排队支持：素材前置上传、幂等提交的有限重试，以及提交后释放 worker 的分离式回查。
//
// 分离式回查（manifest detachedPolling）面向“拼车/班次”类上游：任务可能先候车数小时再出片。
// 提交成功或每次回查仍未完成时返回 providerStatePendingError，worker 把任务退回调度并在
// next_poll_at 后再领取；期间不占用 worker 槽位，也不会重新提交上游任务。

package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

// detachedProviderTaskMaxAge 是分离式回查任务从首次领取起的最长等待时间；超过后不再退回调度，
// 避免上游丢单时任务永久占用账号的活跃任务名额。
const detachedProviderTaskMaxAge = 48 * time.Hour

// detachedProviderPollDelay 是分离式回查两次领取之间的间隔。
const detachedProviderPollDelay = 15 * time.Second

const idempotentCreateAttempts = 3

func protocolDetachedPolling(adapter protocol.Adapter, mode string) bool {
	return adapter != nil && adapter.Metadata().DetachedPolling && (mode == "video" || mode == "image")
}

// uploadProtocolMedia 按清单 upload 步骤把输入媒体逐个上传到上游，并把返回的素材 ID
// 写入媒体元数据（media.uploadId）。同一媒体在 images/inputs 中各出现一次，只上传一次。
func uploadProtocolMedia(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, request *protocol.GenerationRequest) error {
	uploader, ok := adapter.(protocol.MediaUploadAdapter)
	if !ok || len(uploader.UploadKinds()) == 0 {
		return nil
	}
	allowed := map[string]bool{}
	for _, kind := range uploader.UploadKinds() {
		allowed[kind] = true
	}
	uploaded := map[string]string{}
	assign := func(items []protocol.MediaReference) error {
		for index := range items {
			item := &items[index]
			value := firstNonEmpty(item.URL, item.DataURL)
			if !allowed[item.Kind] || value == "" {
				continue
			}
			key := item.Kind + "\x00" + value
			id, done := uploaded[key]
			if !done {
				if transferer, ok := uploader.(protocol.MediaTransferUploadAdapter); ok && transferer.TransferUploadDeclared() {
					var err error
					if id, err = transferProtocolMedia(ctx, input, transferer, request, *item); err != nil {
						return err
					}
					uploaded[key] = id
				} else {
					spec, err := uploader.BuildUpload(ctx, protocol.RequestContext{BaseURL: input.Config.BaseURL, Request: *request}, *item)
					if err != nil {
						return err
					}
					uploadConfig := input.Config
					if input.Config.InterfaceType == string(model.ChannelInterfaceEvoLinkSeedAudio) {
						uploadConfig.BaseURL = "https://service-daa7b477.example.invalid"
					}
					body, err := executeProtocolRequest(withProviderRequestKind(ctx, "upload"), uploadConfig, spec)
					if err != nil {
						return fmt.Errorf("上传参考素材失败：%w", err)
					}
					if id, err = uploader.ParseUpload(ctx, body); err != nil {
						return err
					}
					uploaded[key] = id
				}
			}
			metadata := make(map[string]any, len(item.Metadata)+1)
			for name, field := range item.Metadata {
				metadata[name] = field
			}
			metadata[protocol.MediaUploadIDKey] = id
			item.Metadata = metadata
		}
		return nil
	}
	for _, items := range [][]protocol.MediaReference{request.Images, request.Videos, request.Audios, request.Inputs} {
		if err := assign(items); err != nil {
			return err
		}
	}
	return nil
}

// transferProtocolMedia 执行“申请上传地址 → 直传字节 → 确认”三步上传，返回上游素材 ID。
// 申请与确认请求走渠道鉴权；直传地址来自上游响应，只允许 HTTPS，不附带渠道凭证与自定义请求头，
// 仍经过宿主统一的出站校验、并发与审计。
func transferProtocolMedia(ctx context.Context, input canvasGenerationInput, uploader protocol.MediaTransferUploadAdapter, request *protocol.GenerationRequest, item protocol.MediaReference) (string, error) {
	data, detected, err := protocolMediaBytes(ctx, input.Config, item)
	if err != nil {
		return "", fmt.Errorf("读取参考素材失败：%w", err)
	}
	media := item
	media.MIMEType = protocolUploadMIMEType(item.Kind, item.MIMEType, detected)
	requestContext := protocol.RequestContext{BaseURL: input.Config.BaseURL, Request: *request}
	spec, err := uploader.BuildUpload(ctx, requestContext, media)
	if err != nil {
		return "", err
	}
	body, err := executeProtocolRequest(withProviderRequestKind(ctx, "upload"), input.Config, spec)
	if err != nil {
		return "", fmt.Errorf("申请参考素材上传地址失败：%w", err)
	}
	transfer, err := uploader.ParseUploadTransfer(ctx, requestContext, media, body)
	if err != nil {
		return "", err
	}
	if err := putProtocolUploadTransfer(withProviderRequestKind(ctx, "upload"), transfer, data, media.MIMEType); err != nil {
		return "", fmt.Errorf("上传参考素材失败：%w", err)
	}
	confirm, declared, err := uploader.BuildUploadConfirm(ctx, requestContext, media, transfer.ID)
	if err != nil {
		return "", err
	}
	if declared {
		body, err := executeProtocolRequest(withProviderRequestKind(ctx, "upload"), input.Config, confirm)
		if err != nil {
			return "", fmt.Errorf("确认参考素材上传失败：%w", err)
		}
		if err := uploader.ParseUploadConfirm(ctx, requestContext, media, transfer.ID, body); err != nil {
			return "", err
		}
	}
	return transfer.ID, nil
}

// protocolUploadMIMEType 优先取与媒体类型一致的 MIME：先看画布记录的类型，再看下载/内容探测结果。
func protocolUploadMIMEType(kind, declared, detected string) string {
	clean := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
		if !strings.Contains(value, "/") || value == "application/octet-stream" {
			return ""
		}
		return value
	}
	declared, detected = clean(declared), clean(detected)
	prefix := strings.ToLower(strings.TrimSpace(kind)) + "/"
	for _, value := range []string{declared, detected} {
		if value != "" && strings.HasPrefix(value, prefix) {
			return value
		}
	}
	return firstNonEmpty(declared, detected)
}

// putProtocolUploadTransfer 把素材字节直传到上游给出的预签名地址（不带渠道凭证）。
func putProtocolUploadTransfer(ctx context.Context, transfer protocol.MediaUploadTransfer, data []byte, mimeType string) error {
	target, err := url.Parse(strings.TrimSpace(transfer.URL))
	if err != nil || !strings.EqualFold(target.Scheme, "https") || target.Host == "" {
		return errors.New("上游返回的上传地址不是有效的 HTTPS 地址")
	}
	method := strings.ToUpper(strings.TrimSpace(transfer.Method))
	if method == "" {
		method = http.MethodPut
	}
	if method != http.MethodPut && method != http.MethodPost {
		return fmt.Errorf("不支持的直传方法 %s", method)
	}
	req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(data))
	if err != nil {
		return err
	}
	if mimeType != "" {
		req.Header.Set("Content-Type", mimeType)
	}
	for name, value := range transfer.Headers {
		req.Header.Set(name, value)
	}
	return executeProtocolUploadTransfer(req, doBinary)
}

// Only PUT replays the same object at the same signed URL; POST may create
// another object and is never retried. Each attempt gets a fresh body reader.
func executeProtocolUploadTransfer(req *http.Request, send func(*http.Request) ([]byte, string, error)) error {
	for attempt := 0; ; attempt++ {
		_, _, err := send(req)
		if err == nil || req.Method != http.MethodPut || attempt >= 2 || req.Context().Err() != nil {
			return err
		}
		var timeout net.Error
		if !retryableIdempotentCreate(err) && !errors.Is(err, context.DeadlineExceeded) && !(errors.As(err, &timeout) && timeout.Timeout()) {
			return err
		}
		if err := sleepContext(req.Context(), max(time.Duration(attempt+1)*time.Second, providerRetryAfter(err))); err != nil {
			return err
		}
		if req.GetBody == nil {
			return err
		}
		body, bodyErr := req.GetBody()
		if bodyErr != nil {
			return bodyErr
		}
		next := req.Clone(req.Context())
		next.Body = body
		req = next
	}
}

type protocolHTTPReceipt struct {
	parse  func([]byte) (protocol.CreateResult, error)
	result protocol.CreateResult
	err    error
	parsed bool
}

func (receipt *protocolHTTPReceipt) decode(body []byte) (protocol.CreateResult, error) {
	if !receipt.parsed {
		receipt.result, receipt.err = receipt.parse(body)
		receipt.parsed = true
	}
	return receipt.result, receipt.err
}

func withProtocolHTTPReceipt(ctx context.Context, receipt *protocolHTTPReceipt) context.Context {
	if metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext); ok {
		metadata.ProtocolReceipt = receipt
		return context.WithValue(ctx, providerAnalyticsKey{}, metadata)
	}
	return ctx
}

func submitProtocolMediaTask(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, request protocol.GenerationRequest, spec protocol.RequestSpec) (protocol.CreateResult, error) {
	receipt := protocolHTTPReceipt{parse: func(body []byte) (protocol.CreateResult, error) {
		if parser, ok := adapter.(protocol.RequestAwareCreateParser); ok {
			return parser.ParseCreateWithRequest(ctx, request, body)
		}
		return adapter.ParseCreate(ctx, body)
	}}
	if adapter.Metadata().Poll != "" {
		ctx = withProtocolHTTPReceipt(ctx, &receipt)
	}
	body, streamed, err := executeIdempotentProtocolCreate(ctx, input, spec, adapter.Metadata().IdempotentCreate)
	if err != nil {
		return protocol.CreateResult{}, err
	}
	if streamed != nil {
		return protocol.CreateResult{Status: protocol.StatusSucceeded, Result: streamed}, nil
	}
	return receipt.decode(body)
}

// executeIdempotentProtocolCreate 只在清单声明 idempotentCreate 时重试 create：上游以宿主幂等键
// 作为任务 ID 去重，重复提交不会产生第二个计费任务。4xx（除 429）是参数问题，重试无意义。
func executeIdempotentProtocolCreate(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec, idempotent bool) ([]byte, *protocol.Result, error) {
	attempts := 1
	if idempotent {
		attempts = idempotentCreateAttempts
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		body, streamed, err := executeProtocolCreateRequest(withProviderRequestKind(ctx, "create"), input, spec)
		if err == nil || attempt == attempts || !retryableIdempotentCreate(err) {
			return body, streamed, err
		}
		lastErr = err
		if waitErr := sleepContext(ctx, max(time.Duration(attempt)*10*time.Second, providerRetryAfter(err))); waitErr != nil {
			return nil, nil, errors.Join(lastErr, waitErr)
		}
	}
	return nil, nil, lastErr
}

func retryableIdempotentCreate(err error) bool {
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.StatusCode == http.StatusTooManyRequests || httpErr.StatusCode >= http.StatusInternalServerError
	}
	return isTransientTransportError(err)
}

// recordProtocolProviderTask 在提交成功后立即保存上游任务 ID。分离式回查依赖它恢复原任务，
// 不能只依赖调用日志从响应体里猜测 ID（上游 ID 由清单映射，可能不在顶层 id 字段）。
func recordProtocolProviderTask(ctx context.Context, providerTaskID string) error {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.TaskID == "" || strings.TrimSpace(providerTaskID) == "" {
		return nil
	}
	next := time.Now().Add(detachedProviderPollDelay)
	return metadata.Service.recordWorkflowProviderRequest(ctx, providerTaskID, "accepted", &next)
}

// detachedProtocolPending 生成分离式回查的“继续等待”信号；stage 为上游给出的可读阶段，
// queueAhead 为前面的条数（-1 表示未知），用来决定下次回查间隔。
func detachedProtocolPending(taskID string, stage string, queueAhead int) error {
	return providerStatePendingError{TaskID: taskID, Stage: truncateRunes(strings.TrimSpace(stage), 120), Detached: true, PollDelay: detachedPollDelay(queueAhead)}
}

// detachedPollDelay 按排队位置拉长回查间隔：前面几百条时一两分钟内不可能轮到，
// 每 15 秒查一次只会制造无效请求；临近发车再恢复 15 秒，保证出片后及时转存。
func detachedPollDelay(queueAhead int) time.Duration {
	switch {
	case queueAhead > 500:
		return 2 * time.Minute
	case queueAhead > 100:
		return time.Minute
	case queueAhead > 20:
		return 30 * time.Second
	default:
		return detachedProviderPollDelay
	}
}
