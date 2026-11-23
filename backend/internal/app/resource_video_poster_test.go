package app

import (
	"bytes"
	"io"
	"testing"
	"time"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func TestVideoPosterOwnershipAndLocalDelivery(t *testing.T) {
	svc, db := newMediaRecoveryTestService(t)
	resource := model.Resource{ID: newID(), UserID: "poster-owner", Kind: "video", Provider: "local", ObjectKey: "missing-original.mp4", MimeType: "video/mp4", Status: model.ResourceStatusReady, Size: 1024, CreatedAt: time.Now()}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	png := mediaTestPNG(t)
	if err := svc.SaveVideoPoster("other-user", resource.ID, bytes.NewReader(png)); err == nil {
		t.Fatal("cross-owner write accepted")
	}
	if err := svc.SaveVideoPoster("", resource.ID, bytes.NewReader(png)); err == nil {
		t.Fatal("anonymous write accepted")
	}
	if err := svc.SaveVideoPoster(resource.UserID, resource.ID, bytes.NewReader([]byte("invalid"))); err == nil {
		t.Fatal("invalid image accepted")
	}
	if err := svc.SaveVideoPoster(resource.UserID, resource.ID, bytes.NewReader(make([]byte, (2<<20)+1))); err == nil {
		t.Fatal("oversized poster accepted")
	}
	if err := svc.SaveVideoPoster(resource.UserID, resource.ID, bytes.NewReader(png)); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		for _, variant := range []assets.ResourceVariant{assets.VariantThumbnail, assets.VariantThumbnailSmall} {
			delivery, err := svc.PrepareResourceDelivery(resource.UserID, resource.ID, assets.AccessOptions{Variant: variant}, "")
			if err != nil {
				t.Fatal(err)
			}
			if delivery.Access.Delivery != assets.DeliveryLocal || delivery.Access.ActualVariant != variant {
				t.Fatalf("unexpected access: %+v", delivery.Access)
			}
			data, err := io.ReadAll(delivery.Stream.Body)
			delivery.Stream.Body.Close()
			if err != nil || len(data) == 0 || delivery.Resource.MimeType != "image/png" {
				t.Fatalf("invalid poster stream: %v", err)
			}
		}
	}
	if _, err := svc.PrepareResourceDelivery("other-user", resource.ID, assets.AccessOptions{Variant: assets.VariantThumbnail}, ""); err == nil {
		t.Fatal("cross-owner read accepted")
	}
	if err := db.Model(&resource).Update("kind", "image").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveVideoPoster(resource.UserID, resource.ID, bytes.NewReader(png)); err == nil {
		t.Fatal("non-video accepted")
	}
}
