package protocol

import "context"

// Adapter owns only protocol translation. The host owns credentials, outbound
// security, polling leases, billing, result downloads and task recovery.
type Adapter interface {
	Metadata() Metadata
	BuildCreate(context.Context, RequestContext) (RequestSpec, error)
	ParseCreate(context.Context, []byte) (CreateResult, error)
	BuildPoll(context.Context, PollContext) (RequestSpec, error)
	ParsePoll(context.Context, PollContext, []byte) (PollResult, error)
	BuildCancel(context.Context, PollContext) (RequestSpec, error)
}

type RequestAwareCreateParser interface {
	ParseCreateWithRequest(context.Context, GenerationRequest, []byte) (CreateResult, error)
}

// AgentAdapter is the optional protocol surface for tool-capable text calls.
// The host still owns credentials, outbound policy and billing; a plugin only
// maps the platform's agent request into the provider payload and parses the
// provider response back into the platform tool-call contract.
type AgentAdapter interface {
	BuildAgent(context.Context, AgentRequestContext) (RequestSpec, error)
	ParseAgent(context.Context, []byte) (AgentResult, error)
}

// AgentCapability lets the host distinguish a declarative provider that
// actually declares an agent operation from one that only satisfies the Go
// method set through the shared manifest adapter implementation.
type AgentCapability interface {
	AgentAvailable() bool
}

// ResultAdapter optionally resolves an authenticated binary result after an
// asynchronous task succeeds without returning a public media URL.
type ResultAdapter interface {
	BuildResult(context.Context, PollContext) (RequestSpec, error)
}

type ResultCapability interface {
	ResultAvailable() bool
}

// MediaUploadAdapter 是可选的素材前置上传面：上游要求先上传文件拿到素材 ID，
// create 再按 ID 引用。UploadKinds 为空表示该适配器未声明上传步骤。
type MediaUploadAdapter interface {
	UploadKinds() []string
	BuildUpload(context.Context, RequestContext, MediaReference) (RequestSpec, error)
	ParseUpload(context.Context, []byte) (string, error)
}

// MediaUploadTransfer 是“申请上传地址 → 直传文件”式上传的直传目标：宿主把媒体原始字节
// 发到 URL（只允许 HTTPS），不附带渠道鉴权；ID 是 create 引用的上游素材 ID。
type MediaUploadTransfer struct {
	ID      string
	Method  string
	URL     string
	Headers map[string]string
}

// MediaTransferUploadAdapter 是 MediaUploadAdapter 的可选扩展。TransferUploadDeclared 为 true 时，
// 宿主先读取媒体字节（BuildUpload 收到的 media 带探测到的 mimeType），执行申请请求，按
// ParseUploadTransfer 的结果直传字节，再按需执行确认请求。
type MediaTransferUploadAdapter interface {
	MediaUploadAdapter
	TransferUploadDeclared() bool
	ParseUploadTransfer(context.Context, RequestContext, MediaReference, []byte) (MediaUploadTransfer, error)
	BuildUploadConfirm(context.Context, RequestContext, MediaReference, string) (RequestSpec, bool, error)
	ParseUploadConfirm(context.Context, RequestContext, MediaReference, string, []byte) error
}

type AgentRequestContext struct {
	BaseURL string
	Model   string
	Request map[string]any
}

type AgentToolCall struct {
	ID               string
	Name             string
	Arguments        string
	ThoughtSignature string
}

type AgentResult struct {
	Text      string
	Reasoning string
	ToolCalls []AgentToolCall
}

type UnavailableAdapter struct {
	Info Metadata
}

func (a UnavailableAdapter) Metadata() Metadata { return a.Info }

func (a UnavailableAdapter) BuildCreate(context.Context, RequestContext) (RequestSpec, error) {
	return RequestSpec{}, unavailable(a.Info)
}

func (a UnavailableAdapter) ParseCreate(context.Context, []byte) (CreateResult, error) {
	return CreateResult{}, unavailable(a.Info)
}

func (a UnavailableAdapter) BuildPoll(context.Context, PollContext) (RequestSpec, error) {
	return RequestSpec{}, unavailable(a.Info)
}

func (a UnavailableAdapter) ParsePoll(context.Context, PollContext, []byte) (PollResult, error) {
	return PollResult{}, unavailable(a.Info)
}

func (a UnavailableAdapter) BuildCancel(context.Context, PollContext) (RequestSpec, error) {
	return RequestSpec{}, unavailable(a.Info)
}
