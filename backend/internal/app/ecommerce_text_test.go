package app

import (
	"bytes"
	"context"
	"testing"
)

func TestEcommerceTextDetectionOwnershipAndDecodeValidation(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	body := []byte("not a real image")
	resource, _, err := svc.storeResource("user", "image", "broken.png", "image/png", int64(len(body)), 900, 1200, 0, bytes.NewReader(body), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DetectEcommerceImageText(context.Background(), "other", resource.ID); err == nil {
		t.Fatal("foreign image accepted")
	}
	if _, err := svc.DetectEcommerceImageText(context.Background(), "user", resource.ID); err == nil {
		t.Fatal("undecodable image accepted")
	}
	if _, err := svc.DetectEcommerceImageText(context.Background(), "user", ""); err == nil {
		t.Fatal("empty resource accepted")
	}
}
