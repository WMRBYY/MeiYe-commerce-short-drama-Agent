package paymentplugins

import (
	"context"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWeChatConfigChecksMerchantCertificatePair(t *testing.T) {
	merchantPrivate, _ := testRSAKeyPair(t)
	platformPrivate, _ := testRSAKeyPair(t)
	config := testWeChatConfig(merchantPrivate, &platformPrivate.PublicKey)
	certificate := &x509.Certificate{
		SerialNumber: big.NewInt(12345), Subject: pkix.Name{CommonName: config["mchId"]},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, &merchantPrivate.PublicKey, merchantPrivate)
	if err != nil {
		t.Fatal(err)
	}
	config["merchantCertificate"] = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	config["merchantSerialNo"] = "3039"
	provider := NewWeChatProvider(nil, "https://example.invalid")
	if err := provider.ValidateConfig(config); err != nil {
		t.Fatalf("valid merchant certificate rejected: %v", err)
	}
	config["merchantSerialNo"] = "51B394572A7351541B4E25C79D8CB85D34E7BA87"
	if err := provider.ValidateConfig(config); err == nil || !strings.Contains(err.Error(), "序列号") {
		t.Fatalf("mismatched serial error = %v", err)
	}
	config["merchantSerialNo"] = "3039"
	config["wechatPayPublicKeyId"] = "3000000001"
	if err := provider.ValidateConfig(config); err == nil || !strings.Contains(err.Error(), "PUB_KEY_ID_") {
		t.Fatalf("truncated public key ID error = %v", err)
	}
}

func TestWeChatUnsignedSignErrorIsClassified(t *testing.T) {
	merchantPrivate, _ := testRSAKeyPair(t)
	platformPrivate, _ := testRSAKeyPair(t)
	config := testWeChatConfig(merchantPrivate, &platformPrivate.PublicKey)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = writer.Write([]byte(`{"code":"SIGN_ERROR","message":"sensitive upstream text"}`))
	}))
	defer server.Close()
	provider := NewWeChatProvider(server.Client(), server.URL)
	_, err := provider.QueryOrder(context.Background(), config, QueryRequest{MerchantOrderNo: "existing-order"})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "SIGN_ERROR" || strings.Contains(providerErr.Message, "sensitive upstream text") {
		t.Fatalf("SIGN_ERROR diagnosis = %v", err)
	}
}
