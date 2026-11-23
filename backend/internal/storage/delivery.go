package storage

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

// DeliverySettings is independent from origin credentials. Public CDN access must be an explicit choice.
type DeliverySettings struct {
	CDNAuthMode      string `json:"cdnAuthMode"`
	CDNPrimaryKey    string `json:"cdnPrimaryKey,omitempty"`
	CDNBackupKey     string `json:"cdnBackupKey,omitempty"`
	CDNURLTTLSeconds int    `json:"cdnUrlTtlSeconds,omitempty"`
	// CDNSignParam 与 CDNAuthAlgorithm 仅用于火山引擎 CDN A 类型鉴权，
	// 必须与 CDN 控制台「签名参数名」「鉴权算法」完全一致。
	CDNSignParam      string `json:"cdnSignParam,omitempty"`
	CDNAuthAlgorithm  string `json:"cdnAuthAlgorithm,omitempty"`
	RequireCDN        bool   `json:"requireCDN"`
	AllowPrivateProxy bool   `json:"allowPrivateProxy"`
	PrivateMediaProxy bool   `json:"privateMediaProxy"`
}

const (
	CDNAuthPublic      = "public"
	CDNAuthQiniu       = "qiniu"
	CDNAuthAliyunA     = "aliyun_a"
	CDNAuthVolcengineA = "volcengine_a"
	defaultCDNURLTTL   = 300
	maxCDNURLTTL       = 3600
)

func CDNEnabled(setting Settings) bool {
	if setting.CDNBaseURL == "" {
		return false
	}
	switch setting.Delivery.CDNAuthMode {
	case CDNAuthPublic, CDNAuthQiniu, CDNAuthAliyunA, CDNAuthVolcengineA:
		return true
	}
	return false
}

// SignedCDNMode 表示由 CDN 节点校验短时签名、并按 CDNURLTTLSeconds 计算有效期的鉴权方式。
// 鉴权方式必须与对象存储厂商匹配：阿里云 A 方式只用于 OSS，火山引擎 A 类型只用于 TOS。
func SignedCDNMode(setting Settings) bool {
	switch setting.Delivery.CDNAuthMode {
	case CDNAuthAliyunA:
		return setting.Provider == aliyunOSSProvider
	case CDNAuthVolcengineA:
		return setting.Provider == volcengineProvider
	}
	return false
}

// CDNURLTTL 返回签名 CDN 的有效时长；未配置时为 300 秒。
func CDNURLTTL(setting Settings) time.Duration {
	seconds := setting.Delivery.CDNURLTTLSeconds
	if seconds <= 0 {
		seconds = defaultCDNURLTTL
	}
	return time.Duration(seconds) * time.Second
}

func SignCDNURL(setting Settings, objectKey string, expires time.Time) (string, error) {
	switch setting.Delivery.CDNAuthMode {
	case CDNAuthPublic:
		return OssCDNObjectURL(setting.CDNBaseURL, objectKey)
	case CDNAuthQiniu:
		if setting.Provider == qiniuKodoProvider {
			return SignedQiniuObjectURL(setting, objectKey, expires)
		}
	case CDNAuthAliyunA:
		if setting.Provider == aliyunOSSProvider {
			return SignedAliyunCDNAURL(setting, objectKey, expires)
		}
	case CDNAuthVolcengineA:
		if setting.Provider == volcengineProvider {
			return SignedVolcengineCDNAURL(setting, objectKey, expires)
		}
	}
	return "", errors.New("CDN 用户访问鉴权方式未配置或不支持")
}

// SignedCDNPreviewURL 返回绑定原对象路径签名的 WebP 预览地址；图片处理参数由对象存储执行。
func SignedCDNPreviewURL(setting Settings, objectKey string, expires time.Time, width int) (string, error) {
	switch setting.Delivery.CDNAuthMode {
	case CDNAuthAliyunA:
		return SignedAliyunCDNPreviewURL(setting, objectKey, expires, width)
	case CDNAuthVolcengineA:
		return SignedVolcengineCDNPreviewURL(setting, objectKey, expires, width)
	}
	return "", errors.New("CDN 预览鉴权方式不支持")
}

// SignedCDNDownloadURL 返回要求源站回写 Content-Disposition: attachment 的签名 CDN 地址。
func SignedCDNDownloadURL(setting Settings, objectKey string, expires time.Time, fileName string) (string, error) {
	switch setting.Delivery.CDNAuthMode {
	case CDNAuthAliyunA:
		return SignedAliyunCDNDownloadURL(setting, objectKey, expires, fileName)
	case CDNAuthVolcengineA:
		return SignedVolcengineCDNDownloadURL(setting, objectKey, expires, fileName)
	}
	return "", errors.New("CDN 下载鉴权方式不支持")
}

// SignedAliyunCDNAURL follows Alibaba Cloud CDN type A: auth_key is
// timestamp-rand-uid-MD5(URI-timestamp-rand-uid-key). The timestamp is the
// start of the CDN validity window, not its expiry.
func SignedAliyunCDNAURL(setting Settings, objectKey string, expires time.Time) (string, error) {
	if setting.Provider != aliyunOSSProvider || setting.Delivery.CDNAuthMode != "aliyun_a" || setting.Delivery.CDNPrimaryKey == "" {
		return "", errors.New("阿里云 CDN A 方式未配置")
	}
	ttl := setting.Delivery.CDNURLTTLSeconds
	if ttl <= 0 {
		ttl = 300
	}
	if ttl > 3600 || !expires.After(time.Now()) || expires.After(time.Now().Add(time.Duration(ttl)*time.Second)) {
		return "", errors.New("阿里云 CDN 签名有效期无效")
	}
	return signAliyunCDNAAt(setting.CDNBaseURL, objectKey, setting.Delivery.CDNPrimaryKey, expires.Unix()-int64(ttl))
}

// SignedAliyunCDNPreviewURL keeps the CDN A signature bound to the object URI.
// x-oss-process must be preserved in the CDN cache key and forwarded to OSS.
func SignedAliyunCDNPreviewURL(setting Settings, objectKey string, expires time.Time, width int) (string, error) {
	if width != 320 && width != 640 {
		return "", errors.New("预览尺寸无效")
	}
	raw, err := SignedAliyunCDNAURL(setting, objectKey, expires)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("x-oss-process", fmt.Sprintf("image/resize,w_%d/format,webp", width))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// SignedAliyunCDNDownloadURL requests an attachment response from the private
// OSS origin. The connection test must verify that the CDN forwards this query
// and keeps attachment and inline responses in separate cache entries.
func SignedAliyunCDNDownloadURL(setting Settings, objectKey string, expires time.Time, fileName string) (string, error) {
	raw, err := SignedAliyunCDNAURL(setting, objectKey, expires)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("response-content-disposition", objectDownloadContentDisposition(fileName, objectKey))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func signAliyunCDNAAt(baseURL, objectKey, key string, timestamp int64) (string, error) {
	if key == "" || timestamp <= 0 {
		return "", errors.New("阿里云 CDN 签名参数无效")
	}
	raw, err := OssCDNObjectURL(baseURL, objectKey)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	stamp := strconv.FormatInt(timestamp, 10)
	uri := u.EscapedPath()
	checksum := md5.Sum([]byte(fmt.Sprintf("%s-%s-0-0-%s", uri, stamp, key)))
	u.RawQuery = "auth_key=" + stamp + "-0-0-" + hex.EncodeToString(checksum[:])
	return u.String(), nil
}

// SignAliyunCDNAAt is used by connection diagnostics for an intentionally
// expired URL; the application never issues it to clients.
func SignAliyunCDNAAt(baseURL, objectKey, key string, timestamp int64) (string, error) {
	return signAliyunCDNAAt(baseURL, objectKey, key, timestamp)
}

func PublicOrigin(setting Settings) bool {
	if setting.Provider == qiniuKodoProvider {
		return true
	} // The SDK signs the public Kodo S3 origin, not its upload endpoint.
	if setting.Provider == volcengineTOSProvider && volcengineTOSInternalEndpoint(setting.Endpoint) {
		return false // ivolces.com 只在火山引擎内网可达，浏览器拿到的预签名地址打不开。
	}
	return PublicHTTPSStorageEndpoint(setting.Endpoint)
}

func DeliveryRevision(setting Settings) string {
	// Only a digest leaves the server; changes to credentials/configuration invalidate descriptors.
	data, _ := json.Marshal(setting)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}
