package auth

import (
	"testing"

	dypns "github.com/alibabacloud-go/dypnsapi-20170525/v3/client"
	"github.com/alibabacloud-go/tea/dara"
)

func TestAliyunSendRequiresBusinessSuccess(t *testing.T) {
	for _, tc := range []struct {
		code    string
		success bool
		want    bool
	}{
		{"OK", true, true},
		{"OK", false, false},
		{"FREQUENCY_FAIL", true, false},
	} {
		response := &dypns.SendSmsVerifyCodeResponse{Body: &dypns.SendSmsVerifyCodeResponseBody{Code: dara.String(tc.code), Success: dara.Bool(tc.success)}}
		if got := aliyunSendAccepted(response); got != tc.want {
			t.Fatalf("send code=%s success=%v got=%v", tc.code, tc.success, got)
		}
	}
	if aliyunSendAccepted(nil) {
		t.Fatal("nil send response was accepted")
	}
}

func TestAliyunCheckRequiresVerifyResultPASS(t *testing.T) {
	for _, tc := range []struct {
		result string
		want   bool
	}{
		{"PASS", true},
		{"UNKNOWN", false},
		{"", false},
	} {
		response := &dypns.CheckSmsVerifyCodeResponse{Body: &dypns.CheckSmsVerifyCodeResponseBody{
			Code: dara.String("OK"), Success: dara.Bool(true),
			Model: &dypns.CheckSmsVerifyCodeResponseBodyModel{VerifyResult: dara.String(tc.result)},
		}}
		if got := aliyunCheckAccepted(response); got != tc.want {
			t.Fatalf("verify result=%q got=%v", tc.result, got)
		}
	}
}
