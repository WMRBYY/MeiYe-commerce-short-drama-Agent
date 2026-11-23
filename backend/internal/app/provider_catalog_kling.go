package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
	"yingce/backend/internal/providercatalog"
)

func verifyKlingCatalogKey(ctx context.Context, provider providercatalog.Provider, key string) (*ProviderCatalogVerifyResult, error) {
	// Free read-only endpoint: never submit a paid generation to verify credentials.
	now := time.Now()
	target := provider.Connection.BaseURL + "/account/costs?start_time=" + strconv.FormatInt(now.Add(-24*time.Hour).UnixMilli(), 10) + "&end_time=" + strconv.FormatInt(now.UnixMilli(), 10)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, BadAuthRequest("可灵服务地址无效")
	}
	request.Header.Set("Authorization", "Bearer "+key)
	data, _, err := doBinary(request)
	if err != nil {
		var upstream providerHTTPError
		if errors.As(err, &upstream) {
			return nil, klingCatalogVerifyError(upstream.StatusCode, []byte(upstream.Body))
		}
		return nil, NewAppError(http.StatusBadGateway, "无法连接可灵北京区验证服务，请稍后重试；此错误不代表 API Key 无效")
	}
	var response struct {
		Code *int `json:"code"`
		Data *struct {
			Code *int `json:"code"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &response) != nil || response.Code == nil || response.Data == nil && *response.Code == 0 {
		return nil, NewAppError(http.StatusBadGateway, "可灵验证接口返回了无法识别的结果，请稍后重试")
	}
	if *response.Code != 0 {
		return nil, klingCatalogVerifyError(http.StatusOK, data)
	}
	if response.Data.Code != nil && *response.Data.Code != 0 {
		return nil, NewAppError(http.StatusBadGateway, "可灵账户查询失败，请检查该密钥的账户查询权限")
	}
	result := &ProviderCatalogVerifyResult{AvailableModels: []string{}, MissingModels: []string{}}
	for _, entry := range provider.Models {
		result.AvailableModels = append(result.AvailableModels, entry.ModelKey)
	}
	// Authentication does not prove model entitlement or sufficient balance.
	return result, nil
}

func klingCatalogVerifyError(status int, body []byte) error {
	var response struct {
		Code int `json:"code"`
	}
	_ = json.Unmarshal(body, &response)
	switch {
	case response.Code == 1002:
		return BadAuthRequest("可灵北京区未找到此 API Key，请确认复制完整且密钥来自可灵国内站；国际站密钥需使用对应区域")
	case status == http.StatusUnauthorized || response.Code == 1000 || response.Code == 1001:
		return BadAuthRequest("可灵拒绝了此密钥，请确认使用国内站新版 API Key，并检查是否已停用")
	case status == http.StatusForbidden:
		return BadAuthRequest("此可灵密钥没有账户查询权限，请在可灵控制台检查授权")
	case status == http.StatusTooManyRequests:
		return NewAppError(http.StatusBadGateway, "可灵验证请求过于频繁，请稍后重试")
	default:
		return NewAppError(http.StatusBadGateway, "可灵验证服务返回异常，请稍后重试；此错误不代表 API Key 无效")
	}
}
