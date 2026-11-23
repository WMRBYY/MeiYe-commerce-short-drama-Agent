//go:build localdevsms

package auth

import (
	"context"
	"os"
	"strings"
)

// Local preview only: accepts one fixed code for one configured number and
// never contacts the SMS provider. Requires `-tags localdevsms` to compile.
type localFixedPhoneVerifier struct{ phone, code string }

func init() {
	phone := strings.TrimSpace(os.Getenv("CANVAS_LOCAL_DEV_PHONE"))
	code := strings.TrimSpace(os.Getenv("CANVAS_LOCAL_DEV_SMS_CODE"))
	if phone != "" && phoneCodePattern.MatchString(code) {
		localPhoneVerifier = localFixedPhoneVerifier{phone: "+86" + strings.TrimPrefix(phone, "+86"), code: code}
	}
}

func (v localFixedPhoneVerifier) Send(_ context.Context, phone, _ string) error {
	if phone != v.phone {
		return os.ErrPermission
	}
	return nil
}

func (v localFixedPhoneVerifier) Check(_ context.Context, phone, _, code string) (bool, error) {
	return phone == v.phone && code == v.code, nil
}
