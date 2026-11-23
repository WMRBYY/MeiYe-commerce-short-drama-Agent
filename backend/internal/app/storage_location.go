package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"net/http"
	"path"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"

	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/tencentyun/cos-go-sdk-v5"
	"gorm.io/gorm"
)

type OSSConnectionTestResult struct {
	OK           bool      `json:"ok"`
	Message      string    `json:"message,omitempty"`
	TestedAt     time.Time `json:"testedAt"`
	TestedDigest string    `json:"testedDigest"`
}

var errOSSConnectionReadMismatch = errors.New("对象存储读取内容不一致")

func (s *Service) TestAdminOSSSetting(actor *model.User, req OSSSettingRequest) (*OSSConnectionTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, current, err := s.readOSSSetting()
	if err != nil {
		return nil, err
	}
	return s.testOSSSetting("platform", "", actor.ID, req, current)
}

func (s *Service) TestUserOSSSetting(actor *model.User, req OSSSettingRequest) (*OSSConnectionTestResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	_, platform, err := s.readOSSSetting()
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(strings.TrimSpace(req.Provider), s3Provider) && !platform.AllowUserS3 {
		return nil, Forbidden("平台管理员尚未允许个人 S3 兼容存储")
	}
	_, current, err := s.readUserOSSSetting(actor.ID)
	if err != nil {
		return nil, err
	}
	return s.testOSSSetting("user", actor.ID, actor.ID, req, current)
}

func (s *Service) testOSSSetting(scope string, ownerID string, actorID string, req OSSSettingRequest, current ossSettingValue) (*OSSConnectionTestResult, error) {
	req.Enabled = true
	value, err := ossSettingFromRequest(req, current)
	if err != nil {
		return nil, err
	}
	key := scope + ":" + actorID
	s.storageTestMu.Lock()
	if s.activeStorageTests == nil {
		s.activeStorageTests = make(map[string]bool)
	}
	if s.activeStorageTests[key] {
		s.storageTestMu.Unlock()
		return nil, NewAppError(http.StatusConflict, "对象存储连接测试正在进行")
	}
	s.activeStorageTests[key] = true
	s.storageTestMu.Unlock()
	defer func() {
		s.storageTestMu.Lock()
		delete(s.activeStorageTests, key)
		s.storageTestMu.Unlock()
	}()

	testKey := path.Join(value.PathPrefix, ".yingce-tests", scope, newID()+".png")
	if err := verifyOSSConnection(s.storageSettingWithRuntimePolicy(value), testKey); err != nil {
		return nil, err
	}

	location, err := s.upsertStorageLocation(scope, ownerID, value)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	location.TestedDigest = storageTestDigest(value)
	location.TestedAt = &now
	if err := s.repo.SaveStorageLocation(location); err != nil {
		return nil, err
	}
	return &OSSConnectionTestResult{OK: true, Message: "连接测试通过", TestedAt: now, TestedDigest: location.TestedDigest}, nil
}

func verifyOSSConnection(value ossSettingValue, testKey string) error {
	payload, imageErr := storageTestPNG()
	if imageErr != nil {
		return imageErr
	}
	// 连接测试验证服务端到对象存储的真实读写权限。CDN 是浏览器读取出口，
	// 可能存在回源鉴权或边缘同步延迟，不能参与刚写入对象的最小读写测试。
	testValue := value
	testValue.CDNBaseURL = ""
	if _, err := putOSSObject(testValue, testKey, "image/png", int64(len(payload)), bytes.NewReader(payload)); err != nil {
		return storageConnectionTestError(testValue.Provider, "写入", err)
	}
	stream, err := getOSSObjectRange(testValue, testKey, "bytes=0-3")
	var rangeErr error
	if err != nil {
		rangeErr = err
	} else {
		rangeErr = verifyOSSConnectionRead(stream, payload)
	}
	var hashErr error
	if rangeErr == nil {
		full, readErr := getOriginOSSObjectRange(testValue, testKey, "")
		if readErr != nil {
			hashErr = readErr
		} else {
			body, bodyErr := io.ReadAll(io.LimitReader(full.Body, int64(len(payload)+1)))
			full.Body.Close()
			if bodyErr != nil || len(body) != len(payload) || sha256.Sum256(body) != sha256.Sum256(payload) {
				hashErr = errOSSConnectionReadMismatch
			}
		}
	}
	var cdnErr error
	if rangeErr == nil && hashErr == nil && value.Delivery.CDNAuthMode == "aliyun_a" {
		cdnErr = verifyAliyunPrivateCDN(value, testKey, payload)
	}
	if rangeErr == nil && hashErr == nil && value.Provider == volcengineProvider && value.Delivery.CDNAuthMode == storage.CDNAuthVolcengineA {
		cdnErr = verifyVolcenginePrivateCDN(value, testKey, payload)
	}
	deleteErr := deleteOSSObject(testValue, testKey)
	if deleteErr != nil {
		return storageConnectionTestError(testValue.Provider, "删除", deleteErr)
	}
	if rangeErr != nil {
		return storageConnectionTestError(testValue.Provider, "Range 读取", rangeErr)
	}
	if hashErr != nil {
		return storageConnectionTestError(testValue.Provider, "SHA-256 回读", hashErr)
	}
	return cdnErr
}

func storageTestPNG() ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, 256, 256))
	for y := 0; y < 256; y++ {
		for x := 0; x < 256; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: uint8((x * y) % 256), A: 255})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, img); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func verifyAliyunPrivateCDN(value ossSettingValue, objectKey string, payload []byte) error {
	setting := storage.NormalizeSettings(value)
	ttl := time.Duration(setting.Delivery.CDNURLTTLSeconds) * time.Second
	if ttl <= 0 {
		ttl = 300 * time.Second
	}
	signed, err := storage.SignedAliyunCDNAURL(setting, objectKey, time.Now().Add(ttl))
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN 签名生成失败", err)
	}
	unsigned, err := storage.OssCDNObjectURL(setting.CDNBaseURL, objectKey)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN 对象地址无效", err)
	}
	expired, err := storage.SignAliyunCDNAAt(setting.CDNBaseURL, objectKey, setting.Delivery.CDNPrimaryKey, time.Now().Unix()-int64(ttl.Seconds())-60)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN 过期签名生成失败", err)
	}
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, probe := range []struct {
		name string
		url  string
		want int
	}{
		{"签名私有读取", signed, http.StatusOK},
		{"未签名访问拒绝", unsigned, http.StatusForbidden},
		{"过期签名拒绝", expired, http.StatusForbidden},
	} {
		response, requestErr := client.Get(probe.url)
		if requestErr != nil {
			return WrapAppError(http.StatusBadGateway, "CDN "+probe.name+"请求失败", requestErr)
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, int64(len(payload)+1)))
		response.Body.Close()
		if readErr != nil || response.StatusCode != probe.want || (probe.want == http.StatusOK && !bytes.Equal(body, payload)) {
			return NewAppError(http.StatusBadGateway, "CDN "+probe.name+"未通过")
		}
		if probe.name == "签名私有读取" && strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Disposition")), "attachment") {
			return NewAppError(http.StatusBadGateway, "CDN 默认图片读取意外返回附件头")
		}
	}
	downloadURL, err := storage.SignedAliyunCDNDownloadURL(setting, objectKey, time.Now().Add(ttl), "cdn-test.png")
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN 下载签名失败", err)
	}
	download, err := client.Get(downloadURL)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN 下载读取失败", err)
	}
	downloadBody, downloadErr := io.ReadAll(io.LimitReader(download.Body, int64(len(payload)+1)))
	download.Body.Close()
	if downloadErr != nil || download.StatusCode != http.StatusOK || !bytes.Equal(downloadBody, payload) || !strings.HasPrefix(strings.ToLower(download.Header.Get("Content-Disposition")), "attachment") {
		return NewAppError(http.StatusBadGateway, "CDN 原图下载未返回完整文件和附件头，请确认回源参数与缓存键")
	}
	inlineAfterDownload, err := client.Get(signed)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN 下载缓存隔离复查失败", err)
	}
	inlineAfterDownload.Body.Close()
	if inlineAfterDownload.StatusCode != http.StatusOK || strings.HasPrefix(strings.ToLower(inlineAfterDownload.Header.Get("Content-Disposition")), "attachment") {
		return NewAppError(http.StatusBadGateway, "CDN 下载响应污染预览缓存，请确认 response-content-disposition 参与缓存键")
	}
	previewURL, err := storage.SignedAliyunCDNPreviewURL(setting, objectKey, time.Now().Add(ttl), 320)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN WebP 预览签名失败", err)
	}
	preview, err := client.Get(previewURL)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN WebP 预览读取失败", err)
	}
	previewBody, readErr := io.ReadAll(io.LimitReader(preview.Body, int64(len(payload))))
	preview.Body.Close()
	if readErr != nil || preview.StatusCode != http.StatusOK || len(previewBody) >= len(payload) || len(previewBody) < 12 || string(previewBody[:4]) != "RIFF" || string(previewBody[8:12]) != "WEBP" {
		return NewAppError(http.StatusBadGateway, "CDN WebP 预览未生效，请确认 x-oss-process 被回源且参与缓存键")
	}
	return nil
}

func verifyOSSConnectionRead(stream *ossObjectStream, payload []byte) error {
	if stream == nil || stream.Body == nil {
		return fmt.Errorf("%w：响应为空", errOSSConnectionReadMismatch)
	}
	data, readErr := io.ReadAll(io.LimitReader(stream.Body, int64(len(payload)+1)))
	closeErr := stream.Body.Close()
	if readErr != nil {
		return fmt.Errorf("对象存储响应读取失败：%w", readErr)
	}
	if closeErr != nil {
		return fmt.Errorf("对象存储响应关闭失败：%w", closeErr)
	}

	// HTTP 允许服务端忽略 Range 并返回 200 + 完整对象。应用的资源代理也会
	// 原样透传这种响应，因此连接测试应同时接受完整读取与标准的 206 分段读取。
	switch stream.StatusCode {
	case http.StatusPartialContent:
		if len(payload) >= 4 && bytes.Equal(data, payload[:4]) {
			return nil
		}
	case http.StatusOK:
		if bytes.Equal(data, payload) {
			return nil
		}
	}
	return fmt.Errorf("%w（HTTP %d，读取 %d 字节）", errOSSConnectionReadMismatch, stream.StatusCode, len(data))
}

func storageConnectionTestError(provider string, operation string, cause error) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	providerName := "对象存储"
	switch provider {
	case aliyunOSSProvider:
		providerName = "阿里云 OSS"
	case tencentCOSProvider:
		providerName = "腾讯云 COS"
	case qiniuKodoProvider:
		providerName = "七牛云 Kodo"
	case volcengineTOSProvider:
		providerName = "火山引擎 TOS"
	case s3Provider:
		providerName = "S3 兼容存储"
	}

	if errors.Is(cause, context.DeadlineExceeded) {
		return WrapAppError(http.StatusGatewayTimeout, fmt.Sprintf("%s %s测试超时，请检查 Endpoint 和服务端网络", providerName, operation), cause)
	}
	var networkErr net.Error
	if errors.As(cause, &networkErr) && networkErr.Timeout() {
		return WrapAppError(http.StatusGatewayTimeout, fmt.Sprintf("%s %s测试超时，请检查 Endpoint 和服务端网络", providerName, operation), cause)
	}
	if operation == "Range 读取" && errors.Is(cause, errOSSConnectionReadMismatch) {
		return WrapAppError(http.StatusBadGateway, fmt.Sprintf("%s Range 读取返回的数据与刚写入对象不一致，请检查 Endpoint 或出网代理是否忽略、改写了 Range 请求", providerName), cause)
	}

	if provider == tencentCOSProvider {
		var responseErr *cos.ErrorResponse
		if errors.As(cause, &responseErr) && responseErr.Response != nil {
			switch responseErr.Response.StatusCode {
			case http.StatusBadRequest, http.StatusUnprocessableEntity:
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("腾讯云 COS %s请求被拒绝，请检查 Bucket、Region 和 Endpoint", operation), cause)
			case http.StatusUnauthorized, http.StatusForbidden:
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("腾讯云 COS %s鉴权失败，请检查 SecretId、SecretKey 和 Bucket 权限", operation), cause)
			case http.StatusNotFound:
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("腾讯云 COS %s未找到 Bucket，请检查 Bucket、Region 和 Endpoint", operation), cause)
			case http.StatusTooManyRequests:
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("腾讯云 COS %s请求过于频繁，请稍后重试", operation), cause)
			}
			if responseErr.Response.StatusCode >= http.StatusInternalServerError {
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("腾讯云 COS %s服务暂时不可用，请稍后重试", operation), cause)
			}
		}
	}

	if provider == volcengineTOSProvider {
		var requestFailure awserr.RequestFailure
		if errors.As(cause, &requestFailure) {
			switch requestFailure.StatusCode() {
			case http.StatusBadRequest:
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("火山引擎 TOS %s请求被拒绝，请检查 Bucket、Region 和 Endpoint", operation), cause)
			case http.StatusUnauthorized, http.StatusForbidden:
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("火山引擎 TOS %s鉴权失败，请检查 Access Key ID、Secret Access Key、Region 和 Bucket 权限", operation), cause)
			case http.StatusNotFound:
				return WrapAppError(http.StatusBadGateway, fmt.Sprintf("火山引擎 TOS %s未找到 Bucket，请检查 Bucket、Region 和 Endpoint", operation), cause)
			}
		}
	}

	return WrapAppError(http.StatusBadGateway, fmt.Sprintf("%s %s测试失败，请检查 Endpoint、Bucket、访问密钥和存储桶权限", providerName, operation), cause)
}

func (s *Service) upsertStorageLocation(scope string, ownerID string, value ossSettingValue) (*model.StorageLocation, error) {
	digest := storageLocationDigest(value)
	location, err := s.repo.StorageLocationByDigest(scope, ownerID, value.Provider, digest)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	stored, err := s.encryptOSSSettingSecrets(value)
	if err != nil {
		return nil, err
	}
	stored.Enabled = true
	stored.StorageLocationID = ""
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	if location == nil {
		location = &model.StorageLocation{ID: newID(), Scope: scope, OwnerID: ownerID, Provider: value.Provider, LocationDigest: digest, ValueJSON: string(encoded)}
		if err := s.repo.CreateStorageLocation(location); err != nil {
			return nil, err
		}
		return location, nil
	}
	location.ValueJSON = string(encoded)
	return location, nil
}

func (s *Service) storageLocationValue(id string) (*model.StorageLocation, ossSettingValue, error) {
	location, err := s.repo.StorageLocation(id)
	if err != nil {
		return nil, ossSettingValue{}, err
	}
	var value ossSettingValue
	if err := json.Unmarshal([]byte(location.ValueJSON), &value); err != nil {
		return nil, ossSettingValue{}, errors.New("对象存储位置配置格式无效")
	}
	if _, err := s.decryptOSSSettingSecrets(&value); err != nil {
		return nil, ossSettingValue{}, err
	}
	value.StorageLocationID = location.ID
	return location, normalizeOSSSetting(value), nil
}

func (s *Service) requireTestedS3Location(scope string, ownerID string, value ossSettingValue) (*model.StorageLocation, error) {
	location, err := s.repo.StorageLocationByDigest(scope, ownerID, value.Provider, storageLocationDigest(value))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("对象存储关键配置尚未通过连接测试")
		}
		return nil, err
	}
	if location.TestedAt == nil || location.TestedDigest != storageTestDigest(value) {
		return nil, BadAuthRequest("对象存储关键配置或凭据已变化，请重新连接测试")
	}
	return location, nil
}

func (s *Service) populateStorageLocationPublic(result *PublicOSSSetting, scope string, ownerID string, id string) error {
	count, err := s.repo.StorageLocationHistoryCount(scope, ownerID)
	if err != nil {
		return err
	}
	result.HistoryCount = count
	if id == "" {
		return nil
	}
	location, err := s.repo.StorageLocation(id)
	if err != nil {
		return err
	}
	result.TestedAt = location.TestedAt
	result.TestedDigest = location.TestedDigest
	result.ReferencedResourceCount, err = s.repo.StorageLocationResourceCount(id)
	return err
}

func deleteOSSObject(setting ossSettingValue, objectKey string) error {
	switch normalizeOSSSetting(setting).Provider {
	case s3Provider, volcengineProvider:
		return deleteS3Object(setting, objectKey)
	case tencentCOSProvider:
		return deleteTencentCOSObject(setting, objectKey)
	case qiniuKodoProvider:
		return deleteQiniuObject(setting, objectKey)
	default:
		return deleteAliyunOSSObject(setting, objectKey)
	}
}
