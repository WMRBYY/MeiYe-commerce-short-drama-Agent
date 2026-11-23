package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"

	"gorm.io/gorm"
)

const (
	libTVSettingKey       = "libtv"
	libTVDetailURL        = "https://api.liblib.tv/api/canvas/project/detail"
	libTVMaxResponseBytes = 8 << 20
	// 缺少、错误或失效的网页 token 都由 LibTV 以 HTTP 200 + code 10001（用户未授权）返回。
	libTVCodeUnauthorized = 10001
)

var errLibTVRedirect = errors.New("LibTV API 不允许重定向")

type libTVEnvelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
	Msg  string          `json:"msg"`
}

type LibTVSettingRequest struct {
	Enabled    bool   `json:"enabled"`
	Token      string `json:"token"`
	ClearToken bool   `json:"clearToken"`
}

type PublicLibTVSetting struct {
	Enabled                 bool      `json:"enabled"`
	Connected               bool      `json:"connected"`
	HasToken                bool      `json:"hasToken"`
	AccountName             string    `json:"accountName,omitempty"`
	AccountID               string    `json:"accountId,omitempty"`
	Warning                 string    `json:"warning,omitempty"`
	UpdatedAt               time.Time `json:"updatedAt,omitempty"`
	PreferredCallbackMode   string    `json:"preferredCallbackMode,omitempty"`
	PreferredRedirectURI    string    `json:"preferredRedirectUri,omitempty"`
	PublicBaseURLConfigured string    `json:"publicBaseUrlConfigured,omitempty"`
}

type LibTVConnectStartRequest struct {
	Origin string `json:"origin"`
}

type LibTVConnectStartResult struct {
	AuthorizeURL string    `json:"authorizeUrl"`
	RedirectURI  string    `json:"redirectUri"`
	CallbackMode string    `json:"callbackMode"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Hint         string    `json:"hint"`
}

type LibTVConnectCompleteRequest struct {
	CallbackURL string `json:"callbackUrl"`
	Code        string `json:"code"`
	State       string `json:"state"`
}

type libTVSettingValue struct {
	Enabled      bool      `json:"enabled"`
	Token        string    `json:"token,omitempty"`
	ClientID     string    `json:"clientId,omitempty"`
	ClientSecret string    `json:"clientSecret,omitempty"`
	RedirectURI  string    `json:"redirectUri,omitempty"`
	Issuer       string    `json:"issuer,omitempty"`
	AccessToken  string    `json:"accessToken,omitempty"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	TokenType    string    `json:"tokenType,omitempty"`
	Scope        string    `json:"scope,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt,omitempty"`
	AccountName  string    `json:"accountName,omitempty"`
	AccountID    string    `json:"accountId,omitempty"`
}

type libTVOAuthPending struct {
	RedirectURI string `json:"redirectUri"`
	ClientID    string `json:"clientId"`
	ActorID     string `json:"actorId"`
}

type LibTVImportRequest struct {
	UUID string `json:"uuid"`
}

type LibTVImportResult struct {
	BatchID                 string                  `json:"batchId"`
	BatchCreatedAt          time.Time               `json:"batchCreatedAt"`
	ProjectUUID             string                  `json:"projectUuid"`
	ProjectName             string                  `json:"projectName"`
	Nodes                   []LibTVCanvasNode       `json:"nodes"`
	Connections             []LibTVCanvasConnection `json:"connections"`
	ImportedNodeCount       int                     `json:"importedNodeCount"`
	ImportedConnectionCount int                     `json:"importedConnectionCount"`
	SkippedNodes            []LibTVImportIssue      `json:"skippedNodes"`
	SkippedConnections      []LibTVImportIssue      `json:"skippedConnections"`
	Warnings                []LibTVImportWarning    `json:"warnings"`
	MultiResultNodeCount    int                     `json:"multiResultNodeCount"`
	StaleNodeCount          int                     `json:"staleNodeCount"`
	ReusedFailedNodeCount   int                     `json:"reusedFailedNodeCount"`
	PlaceholderNodeCount    int                     `json:"placeholderNodeCount"`
	ConvertedSpecialCount   int                     `json:"convertedSpecialCount"`
}

type LibTVCanvasNode struct {
	ID            string              `json:"id"`
	Type          string              `json:"type"`
	Title         string              `json:"title"`
	X             float64             `json:"x"`
	Y             float64             `json:"y"`
	Width         float64             `json:"width"`
	Height        float64             `json:"height"`
	Content       string              `json:"content"`
	Prompt        string              `json:"prompt,omitempty"`
	Model         string              `json:"model,omitempty"`
	NaturalWidth  int                 `json:"naturalWidth,omitempty"`
	NaturalHeight int                 `json:"naturalHeight,omitempty"`
	DurationMs    int64               `json:"durationMs,omitempty"`
	MimeType      string              `json:"mimeType,omitempty"`
	Status        string              `json:"status,omitempty"`
	ErrorDetails  string              `json:"errorDetails,omitempty"`
	Metadata      LibTVImportMetadata `json:"metadata"`
}

type LibTVImportMetadata struct {
	Provider         string `json:"provider"`
	ProjectUUID      string `json:"projectUuid"`
	NodeKey          string `json:"nodeKey"`
	BatchID          string `json:"batchId"`
	SourceType       string `json:"sourceType,omitempty"`
	StyleAssetUUID   string `json:"styleAssetUuid,omitempty"`
	StyleVersionUUID string `json:"styleVersionUuid,omitempty"`
	StyleName        string `json:"styleName,omitempty"`
}

type LibTVCanvasConnection struct {
	ID         string `json:"id"`
	FromNodeID string `json:"fromNodeId"`
	ToNodeID   string `json:"toNodeId"`
}

type LibTVImportIssue struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Reason string `json:"reason"`
}

type LibTVImportWarning struct {
	ID      string `json:"id,omitempty"`
	Message string `json:"message"`
}

type libTVDetail struct {
	ProjectMeta struct {
		UUID      string `json:"uuid"`
		Name      string `json:"name"`
		Effective struct {
			CanRead bool `json:"canRead"`
			CanCopy bool `json:"canCopy"`
		} `json:"effective"`
	} `json:"projectMeta"`
	NodeList       []libTVRawNode       `json:"nodeList"`
	ConnectionList []libTVRawConnection `json:"connectionList"`
	copyChecked    bool
	copyAllowed    bool
}

type libTVRawNode struct {
	NodeKey  string `json:"nodeKey"`
	Name     string `json:"name"`
	Data     string `json:"data"`
	Position struct {
		X string `json:"positionX"`
		Y string `json:"positionY"`
	} `json:"position"`
	Measured struct {
		Width  string `json:"width"`
		Height string `json:"height"`
	} `json:"measured"`
	TaskInfo struct {
		Status       int    `json:"status"`
		FailedReason string `json:"failedReason"`
	} `json:"taskInfo"`
	IsStale bool `json:"isStale"`
}

type libTVRawConnection struct {
	ConnectionID string `json:"connectionId"`
	Source       string `json:"source"`
	Target       string `json:"target"`
}

type libTVNodeData struct {
	Type             string         `json:"type"`
	URL              []string       `json:"url"`
	CoverURL         string         `json:"coverUrl"`
	StyleAssetUUID   string         `json:"styleAssetUuid"`
	StyleVersionUUID string         `json:"styleVersionUuid"`
	StyleName        string         `json:"styleName"`
	Params           map[string]any `json:"params"`
	TaskInfo         struct {
		Status       int    `json:"status"`
		FailedReason string `json:"failedReason"`
	} `json:"taskInfo"`
	IsStale      bool `json:"isStale"`
	ResourceMeta struct {
		Items []struct {
			Width       int     `json:"width"`
			Height      int     `json:"height"`
			DurationSec float64 `json:"durationSec"`
		} `json:"items"`
	} `json:"_resourceMeta"`
}

func (s *Service) AdminLibTVSetting(actor *model.User) (*PublicLibTVSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	return s.publicLibTVSetting(setting, value, ""), nil
}

func (s *Service) UpdateLibTVSetting(actor *model.User, req LibTVSettingRequest) (*PublicLibTVSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	s.libtvMu.Lock()
	defer s.libtvMu.Unlock()
	_, current, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	if req.Enabled && !libTVSettingConnected(current) {
		return nil, kernel.BadAuthRequest("启用 LibTV 画布导入前请先连接 LibTV 账号")
	}
	current.Enabled = req.Enabled
	setting, err := s.persistLibTVSetting(actor.ID, current)
	if err != nil {
		return nil, err
	}
	return s.publicLibTVSetting(setting, current, ""), nil
}

func (s *Service) TestLibTV(actor *model.User, projectUUID string) error {
	if actor == nil {
		return kernel.Unauthorized("请先登录")
	}
	if err := s.host.RequireAdmin(actor); err != nil {
		return err
	}
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return err
	}
	if !libTVSettingConnected(value) {
		return kernel.BadAuthRequest("尚未连接 LibTV 账号")
	}
	_, err = s.fetchLibTVProjectDetail(strings.TrimSpace(projectUUID))
	return err
}

func (s *Service) ImportLibTV(userID, canvasProjectID, projectUUID string) (*LibTVImportResult, error) {
	userID = strings.TrimSpace(userID)
	canvasProjectID = strings.TrimSpace(canvasProjectID)
	if userID == "" || canvasProjectID == "" {
		return nil, kernel.Unauthorized("请先打开已同步的" + s.host.BrandName() + "画布")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, canvasProjectID); err != nil {
		return nil, err
	}
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	if !value.Enabled || !libTVSettingConnected(value) {
		return nil, kernel.BadAuthRequest("LibTV 尚未启用或未连接账号")
	}
	detail, err := s.fetchLibTVProjectDetail(strings.TrimSpace(projectUUID))
	if err != nil {
		return nil, err
	}
	return adaptLibTVDetail(detail)
}

func (s *Service) readLibTVSetting() (*model.SystemSetting, libTVSettingValue, error) {
	setting, err := s.repo.SystemSetting(libTVSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, libTVSettingValue{}, nil
	}
	if err != nil {
		return nil, libTVSettingValue{}, err
	}
	value := libTVSettingValue{}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, value, errors.New("LibTV 配置格式无效")
	}
	if value.Token, err = s.revealLibTVSecret(value.Token); err != nil {
		return nil, value, err
	}
	if value.ClientSecret, err = s.revealLibTVSecret(value.ClientSecret); err != nil {
		return nil, value, err
	}
	if value.AccessToken, err = s.revealLibTVSecret(value.AccessToken); err != nil {
		return nil, value, err
	}
	if value.RefreshToken, err = s.revealLibTVSecret(value.RefreshToken); err != nil {
		return nil, value, err
	}
	return setting, value, nil
}

func (s *Service) persistLibTVSetting(actorID string, value libTVSettingValue) (*model.SystemSetting, error) {
	stored := value
	var err error
	if stored.Token, err = s.protectLibTVSecret(stored.Token); err != nil {
		return nil, err
	}
	if stored.ClientSecret, err = s.protectLibTVSecret(stored.ClientSecret); err != nil {
		return nil, err
	}
	if stored.AccessToken, err = s.protectLibTVSecret(stored.AccessToken); err != nil {
		return nil, err
	}
	if stored.RefreshToken, err = s.protectLibTVSecret(stored.RefreshToken); err != nil {
		return nil, err
	}
	valueJSON, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	setting := &model.SystemSetting{Key: libTVSettingKey, ValueJSON: string(valueJSON), UpdatedBy: actorID}
	if existing, lookupErr := s.repo.SystemSetting(libTVSettingKey); lookupErr == nil {
		setting.CreatedAt = existing.CreatedAt
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil, lookupErr
	}
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return nil, err
	}
	return setting, nil
}

func (s *Service) publicLibTVSetting(setting *model.SystemSetting, value libTVSettingValue, originHint string) *PublicLibTVSetting {
	connected := libTVSettingConnected(value)
	result := &PublicLibTVSetting{
		Enabled:     value.Enabled,
		Connected:   connected,
		HasToken:    connected,
		AccountName: strings.TrimSpace(value.AccountName),
		AccountID:   strings.TrimSpace(value.AccountID),
	}
	if strings.TrimSpace(value.Token) != "" && !connected {
		result.Warning = "此前保存的 LibTV Token 已无法使用，请重新连接账号。"
	}
	if setting != nil {
		result.UpdatedAt = setting.UpdatedAt
	}
	preferred, mode := preferredLibTVRedirectURI(originHint)
	result.PreferredCallbackMode = mode
	result.PreferredRedirectURI = preferred
	if base := libTVPublicBaseURL(); base != "" {
		result.PublicBaseURLConfigured = base
	}
	return result
}

func (s *Service) fetchLibTVDetail(projectUUID, token string) (*libTVDetail, error) {
	projectUUID = strings.TrimSpace(projectUUID)
	if !isLibTVProjectUUID(projectUUID) {
		return nil, kernel.BadAuthRequest("LibTV 画布 UUID 格式无效")
	}
	u, err := url.Parse(libTVDetailURL)
	if err != nil {
		return nil, err
	}
	query := u.Query()
	query.Set("uuid", projectUUID)
	u.RawQuery = query.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("token", token)
	outbound.ApplyDefaultOutboundHeaders(req)
	client := outbound.OutboundHTTPClient(20 * time.Second)
	// Token 是 LibTV 专用凭证，禁止重定向以避免自定义请求头被带到其他主机。
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errLibTVRedirect
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, libTVTransportError(err, "LibTV 请求失败，请检查服务器到 LibTV 的网络")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, libTVMaxResponseBytes+1))
	if err != nil {
		return nil, libTVTransportError(err, "读取 LibTV 响应失败")
	}
	return parseLibTVDetailResponse(projectUUID, resp.StatusCode, body)
}

// parseLibTVDetailResponse 的失败必须是 AppError：未分类错误会被 failService 折叠成“系统处理失败”，
// 管理员无法区分 Token 失效、画布权限和网络问题。
func parseLibTVDetailResponse(projectUUID string, statusCode int, body []byte) (*libTVDetail, error) {
	if len(body) > libTVMaxResponseBytes {
		return nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 响应过大")
	}
	if statusCode < 200 || statusCode >= 300 {
		return nil, kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("LibTV 请求失败（HTTP %d）", statusCode))
	}
	var envelope libTVEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, kernel.WrapAppError(http.StatusBadGateway, "LibTV 响应格式无效", err)
	}
	if envelope.Code != 0 {
		return nil, libTVBusinessError(envelope.Code, envelope.Msg)
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		// 否则零值 effective 会被误报成“不允许复制”。
		return nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 未返回画布数据")
	}
	var detail libTVDetail
	if err := json.Unmarshal(envelope.Data, &detail); err != nil {
		return nil, kernel.WrapAppError(http.StatusBadGateway, "LibTV 画布数据格式无效", err)
	}
	if strings.TrimSpace(detail.ProjectMeta.UUID) == "" {
		detail.ProjectMeta.UUID = projectUUID
	}
	if !detail.ProjectMeta.Effective.CanRead || !detail.ProjectMeta.Effective.CanCopy {
		return nil, kernel.Forbidden("当前 LibTV 画布不允许复制")
	}
	return &detail, nil
}

func libTVSettingConnected(value libTVSettingValue) bool {
	return strings.TrimSpace(value.RefreshToken) != ""
}

func (s *Service) protectLibTVSecret(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	return s.host.EncryptSecret(value)
}

func (s *Service) revealLibTVSecret(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", nil
	}
	return s.host.DecryptSecret(value)
}

// libTVBusinessError 单独说明 Token 失效，避免 LibTV 的“用户未授权”被误读成本站登录失效。
func libTVBusinessError(code int, msg string) error {
	if code == libTVCodeUnauthorized {
		return kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("平台保存的 LibTV Token 无效或已过期，请管理员在「第三方参数配置」中更新（LibTV code %d）", code))
	}
	msg = kernel.TruncateRunes(strings.TrimSpace(msg), 200)
	if msg == "" {
		return kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("LibTV 返回业务错误（code %d）", code))
	}
	return kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("LibTV 返回错误：%s（code %d）", msg, code))
}

// libTVTransportError 把出站失败投影为 502/504，原始错误只留在 Cause 里供诊断。
func libTVTransportError(err error, message string) error {
	var appErr *kernel.AppError
	if errors.As(err, &appErr) {
		// 出站拨号层（DNS 解析、内网地址拦截）已给出可公开的原因。
		return appErr
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return kernel.WrapAppError(http.StatusGatewayTimeout, "LibTV 请求超时，请稍后重试", err)
	}
	if errors.Is(err, errLibTVRedirect) {
		return kernel.WrapAppError(http.StatusBadGateway, "LibTV 接口返回重定向，已拒绝跟随，请确认 Token 仍然有效", err)
	}
	return kernel.WrapAppError(http.StatusBadGateway, message, err)
}
