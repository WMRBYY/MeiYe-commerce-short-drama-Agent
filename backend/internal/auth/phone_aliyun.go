package auth

import (
	"context"
	"errors"
	"os"
	"strings"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/utils"
	dypns "github.com/alibabacloud-go/dypnsapi-20170525/v3/client"
	"github.com/alibabacloud-go/tea/dara"
)

// PhoneVerifier isolates the paid upstream calls so authentication tests never
// send a real message. Production only installs the official PNVS client.
type PhoneVerifier interface {
	Send(context.Context, string, string) error
	Check(context.Context, string, string, string) (bool, error)
}

type aliyunPhoneVerifier struct {
	client       *dypns.Client
	signName     string
	templateCode string
}

// localPhoneVerifier is only set by the localdevsms build tag; release builds never compile it.
var localPhoneVerifier PhoneVerifier

func NewAliyunPhoneVerifierFromEnv() (PhoneVerifier, error) {
	if localPhoneVerifier != nil {
		return localPhoneVerifier, nil
	}
	id := strings.TrimSpace(os.Getenv("CANVAS_PHONE_ALIYUN_ACCESS_KEY_ID"))
	secret := strings.TrimSpace(os.Getenv("CANVAS_PHONE_ALIYUN_ACCESS_KEY_SECRET"))
	sign := strings.TrimSpace(os.Getenv("CANVAS_PHONE_ALIYUN_SIGN_NAME"))
	template := strings.TrimSpace(os.Getenv("CANVAS_PHONE_ALIYUN_TEMPLATE_CODE"))
	if id == "" || secret == "" || sign == "" || template == "" {
		return nil, errors.New("阿里云号码认证凭据、签名或模板未配置")
	}
	endpoint := "dypnsapi.aliyuncs.com"
	client, err := dypns.NewClient(&openapi.Config{AccessKeyId: &id, AccessKeySecret: &secret, Endpoint: &endpoint})
	if err != nil {
		return nil, err
	}
	return &aliyunPhoneVerifier{client: client, signName: sign, templateCode: template}, nil
}

func (p *aliyunPhoneVerifier) Send(ctx context.Context, phone, outID string) error {
	request := new(dypns.SendSmsVerifyCodeRequest).
		SetPhoneNumber(strings.TrimPrefix(phone, "+86")).SetCountryCode("86").
		SetSignName(p.signName).SetTemplateCode(p.templateCode).
		SetTemplateParam(`{"code":"##code##","min":"5"}`).
		SetCodeLength(6).SetCodeType(1).SetValidTime(300).
		SetInterval(60).SetDuplicatePolicy(1).SetReturnVerifyCode(false).
		SetOutId(outID)
	response, err := p.client.SendSmsVerifyCodeWithContext(ctx, request, &dara.RuntimeOptions{})
	if err != nil {
		return err
	}
	if !aliyunSendAccepted(response) {
		return errors.New("号码认证服务未确认发送成功")
	}
	return nil
}

func (p *aliyunPhoneVerifier) Check(ctx context.Context, phone, outID, code string) (bool, error) {
	request := new(dypns.CheckSmsVerifyCodeRequest).
		SetPhoneNumber(strings.TrimPrefix(phone, "+86")).SetCountryCode("86").
		SetOutId(outID).SetVerifyCode(code)
	response, err := p.client.CheckSmsVerifyCodeWithContext(ctx, request, &dara.RuntimeOptions{})
	if err != nil {
		return false, err
	}
	if response == nil || response.Body == nil || dara.StringValue(response.Body.Code) != "OK" || !dara.BoolValue(response.Body.Success) || response.Body.Model == nil {
		return false, errors.New("号码认证服务未返回有效核验结果")
	}
	if response.Body.Model.OutId != nil && dara.StringValue(response.Body.Model.OutId) != outID {
		return false, errors.New("号码认证流水号不匹配")
	}
	return aliyunCheckAccepted(response), nil
}

func aliyunSendAccepted(response *dypns.SendSmsVerifyCodeResponse) bool {
	return response != nil && response.Body != nil && dara.StringValue(response.Body.Code) == "OK" && dara.BoolValue(response.Body.Success)
}

func aliyunCheckAccepted(response *dypns.CheckSmsVerifyCodeResponse) bool {
	return response != nil && response.Body != nil && response.Body.Model != nil &&
		dara.StringValue(response.Body.Code) == "OK" && dara.BoolValue(response.Body.Success) &&
		dara.StringValue(response.Body.Model.VerifyResult) == "PASS"
}
