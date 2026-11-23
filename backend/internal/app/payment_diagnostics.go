package app

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
)

type PaymentProviderDiagnostic struct {
	ProviderID         string `json:"providerId"`
	ConfigVersion      int64  `json:"configVersion"`
	Enabled            bool   `json:"enabled"`
	CertificateChecked bool   `json:"certificateChecked"`
	LocalStatus        string `json:"localStatus"`
	UpstreamStatus     string `json:"upstreamStatus"`
	ProviderCode       string `json:"providerCode,omitempty"`
	Message            string `json:"message"`
}

// DiagnoseWeChatPaymentProvider only validates the saved config and queries an
// existing failed order. It never creates an order or changes payment state.
func (s *Service) DiagnoseWeChatPaymentProvider(ctx context.Context, actor *model.User) (*PaymentProviderDiagnostic, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	const providerID = PaymentProviderWeChat
	provider, ok := s.paymentRegistry.Get(providerID)
	if !ok {
		return nil, BadAuthRequest("微信支付插件不可用")
	}
	config, err := s.repo.LatestPaymentProviderConfig(providerID)
	if err != nil {
		return nil, err
	}
	result := &PaymentProviderDiagnostic{ProviderID: providerID, ConfigVersion: config.Version, Enabled: config.Enabled, LocalStatus: "failed", UpstreamStatus: "not_run"}
	values, err := s.decryptPaymentConfig(config)
	if err != nil {
		result.Message = "配置密文无法解密，请检查存储加密密钥"
		return result, nil
	}
	result.CertificateChecked = strings.TrimSpace(values["merchantCertificate"]) != ""
	if err := provider.ValidateConfig(values); err != nil {
		result.Message = safeWeChatDiagnosticMessage(err)
		return result, nil
	}
	result.LocalStatus = "passed"
	order, err := s.repo.LatestUnresolvedPaymentOrderForProvider(providerID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		result.UpstreamStatus = "no_existing_order"
		result.Message = "本地配置格式通过；没有可复用的失败订单，尚未验证微信接口认证"
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	query, err := provider.QueryOrder(ctx, values, payment.QueryRequest{MerchantOrderNo: order.MerchantOrderNo})
	if err == nil || errors.Is(err, payment.ErrOrderNotFound) {
		if err == nil && query.MerchantOrderNo != order.MerchantOrderNo {
			result.UpstreamStatus = "failed"
			result.Message = "微信查单结果与原订单不一致"
			return result, nil
		}
		result.UpstreamStatus = "authenticated"
		result.Message = "微信请求认证与响应验签通过；仅查询了已有失败订单，未创建新订单"
		return result, nil
	}
	result.UpstreamStatus = "failed"
	var providerErr *payment.ProviderError
	if errors.As(err, &providerErr) && providerErr.Code == "SIGN_ERROR" {
		result.ProviderCode = "SIGN_ERROR"
	}
	result.Message = safeWeChatDiagnosticMessage(err)
	return result, nil
}

func safeWeChatDiagnosticMessage(err error) string {
	var providerErr *payment.ProviderError
	if errors.As(err, &providerErr) {
		if providerErr.Code == "SIGN_ERROR" {
			return "微信拒绝请求签名：请核对商户号、有效商户 API 证书序列号及配套私钥"
		}
		if providerErr.Code == "provider_error" {
			switch {
			case strings.Contains(providerErr.Message, "PUB_KEY_ID_"):
				return "微信支付公钥 ID 必须使用商户平台提供的完整 PUB_KEY_ID_ 格式"
			case strings.Contains(providerErr.Message, "证书序列号"):
				return "商户 API 证书序列号与配置不一致，请检查新旧证书混用"
			case strings.Contains(providerErr.Message, "私钥与证书公钥"):
				return "商户 API 私钥与证书公钥不匹配"
			case strings.Contains(providerErr.Message, "证书中的商户号"):
				return "商户 API 证书中的商户号与配置不一致"
			case strings.Contains(providerErr.Message, "证书不在有效期"):
				return "商户 API 证书不在有效期内"
			case strings.Contains(providerErr.Message, "微信支付公钥无效"):
				return "微信支付公钥格式无效"
			}
		}
	}
	return "支付配置或微信只读查单失败，请检查后台安全日志"
}

func paymentCheckoutError(providerID string, err error) error {
	var providerErr *payment.ProviderError
	if providerID == PaymentProviderWeChat && errors.As(err, &providerErr) && providerErr.Code == "SIGN_ERROR" {
		failure := WrapAppError(http.StatusBadGateway, "微信支付签名认证失败，请联系管理员检查支付配置", err)
		failure.Details = map[string]any{"providerCode": "SIGN_ERROR"}
		return failure
	}
	return WrapAppError(http.StatusBadGateway, "支付渠道下单失败，请稍后重试", err)
}
