package storage

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// 火山引擎 CDN URL 鉴权 A 类型（官方文档：https://www.volcengine.com/docs/6454/1129831）：
//
//		scheme://host/uri?<签名参数名>=timestamp-rand-uid-<SIGNATURE>
//		SIGNATURE = md5|sha256("uri-timestamp-rand-uid-key")，小写十六进制
//
//	  - uri 以 / 开头、不含域名与查询参数，含非 ASCII 字符时须编码；
//	  - timestamp 为十进制 Unix 秒，CDN 判定过期的条件是 timestamp + 控制台「签名有效时间」< 当前时间，
//	    因此 timestamp 表示有效期起点，应用 TTL 必须与控制台有效时间一致；
//	  - rand 为 1–100 位字母或数字，uid 暂未使用，必须为 0；
//	  - CDN 不把签名参数放入缓存键（无论是否开启「保留鉴权参数」）。
//
// 签名只绑定路径，不绑定查询参数：x-tos-process、response-content-disposition
// 等业务参数仍需在缓存键中保留，才能区分不同响应。
const (
	VolcengineCDNAlgorithmMD5    = "md5"
	VolcengineCDNAlgorithmSHA256 = "sha256"
	defaultVolcengineCDNSign     = "sign"
	volcengineCDNMaxKeyLength    = 120
	volcengineCDNRandLength      = 16
)

var volcengineCDNSignParamPattern = regexp.MustCompile(`^[A-Za-z0-9_.,!-]{1,100}$`)

// VolcengineCDNSignParam 返回签名参数名，默认与控制台默认值 sign 相同。
func VolcengineCDNSignParam(setting Settings) string {
	if name := strings.TrimSpace(setting.Delivery.CDNSignParam); name != "" {
		return name
	}
	return defaultVolcengineCDNSign
}

// VolcengineCDNAlgorithm 返回鉴权算法；未配置时使用 SHA-256（需与控制台一致）。
func VolcengineCDNAlgorithm(setting Settings) string {
	if algorithm := strings.ToLower(strings.TrimSpace(setting.Delivery.CDNAuthAlgorithm)); algorithm != "" {
		return algorithm
	}
	return VolcengineCDNAlgorithmSHA256
}

// ValidVolcengineCDNSignParam 按控制台输入要求校验签名参数名，且不能与业务查询参数冲突。
func ValidVolcengineCDNSignParam(name string) bool {
	if !volcengineCDNSignParamPattern.MatchString(name) || !strings.ContainsAny(strings.ToLower(name), "abcdefghijklmnopqrstuvwxyz0123456789") {
		return false
	}
	switch strings.ToLower(name) {
	case "x-tos-process", "response-content-disposition", "response-cache-control":
		return false
	}
	return true
}

// ValidVolcengineCDNKey 校验 CDN 鉴权密钥：控制台限制不超过 120 个字符；
// 应用额外要求至少 6 位可见 ASCII 字符，避免空白或多字节字符造成两端计算不一致。
func ValidVolcengineCDNKey(key string) bool {
	if len(key) < 6 || len(key) > volcengineCDNMaxKeyLength {
		return false
	}
	for _, r := range key {
		if r < 0x21 || r > 0x7e {
			return false
		}
	}
	return true
}

// SignedVolcengineCDNAURL 为私有 TOS 对象签发火山引擎 CDN A 类型地址。
// expires 是应用期望的失效时间；timestamp = expires - TTL，使 CDN 侧失效时间与之一致。
func SignedVolcengineCDNAURL(setting Settings, objectKey string, expires time.Time) (string, error) {
	if setting.Provider != volcengineProvider || setting.Delivery.CDNAuthMode != CDNAuthVolcengineA || setting.Delivery.CDNPrimaryKey == "" {
		return "", errors.New("火山引擎 CDN A 类型鉴权未配置")
	}
	ttl := CDNURLTTL(setting)
	now := time.Now()
	if ttl > maxCDNURLTTL*time.Second || !expires.After(now) || expires.After(now.Add(ttl)) {
		return "", errors.New("火山引擎 CDN 签名有效期无效")
	}
	return SignVolcengineCDNAAt(setting, objectKey, expires.Unix()-int64(ttl/time.Second))
}

// SignVolcengineCDNAAt 按指定 timestamp 签名。应用只用当前时间窗签发；
// 连接测试会用它构造已过期地址，验证 CDN 确实拒绝。
func SignVolcengineCDNAAt(setting Settings, objectKey string, timestamp int64) (string, error) {
	key := setting.Delivery.CDNPrimaryKey
	if !ValidVolcengineCDNKey(key) || timestamp <= 0 {
		return "", errors.New("火山引擎 CDN 签名参数无效")
	}
	signParam := VolcengineCDNSignParam(setting)
	if !ValidVolcengineCDNSignParam(signParam) {
		return "", errors.New("火山引擎 CDN 签名参数名无效")
	}
	algorithm := VolcengineCDNAlgorithm(setting)
	raw, err := OssCDNObjectURL(setting.CDNBaseURL, objectKey)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	uri := u.EscapedPath()
	if !strings.HasPrefix(uri, "/") || len(uri) < 2 {
		return "", errors.New("火山引擎 CDN 签名路径无效")
	}
	stamp := strconv.FormatInt(timestamp, 10)
	rand := volcengineCDNRand(key, uri, stamp)
	signature, err := volcengineCDNASignature(algorithm, uri, stamp, rand, "0", key)
	if err != nil {
		return "", err
	}
	u.RawQuery = url.QueryEscape(signParam) + "=" + stamp + "-" + rand + "-0-" + signature
	return u.String(), nil
}

// volcengineCDNASignature 实现官方公式 md5|sha256(uri-timestamp-rand-uid-key)。
func volcengineCDNASignature(algorithm, uri, timestamp, rand, uid, key string) (string, error) {
	text := uri + "-" + timestamp + "-" + rand + "-" + uid + "-" + key
	switch algorithm {
	case VolcengineCDNAlgorithmMD5:
		sum := md5.Sum([]byte(text))
		return hex.EncodeToString(sum[:]), nil
	case VolcengineCDNAlgorithmSHA256:
		sum := sha256.Sum256([]byte(text))
		return hex.EncodeToString(sum[:]), nil
	}
	return "", fmt.Errorf("火山引擎 CDN 鉴权算法不支持：%s", algorithm)
}

// volcengineCDNRand 由密钥派生，不可预测；同一对象在同一时间窗内得到相同地址，
// 浏览器可复用 HTTP 缓存。CDN 不校验 rand 的唯一性，只把它纳入签名。
func volcengineCDNRand(key, uri, timestamp string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte("volcengine-cdn-rand\n" + uri + "\n" + timestamp))
	return hex.EncodeToString(mac.Sum(nil))[:volcengineCDNRandLength]
}

// SignedVolcengineCDNPreviewURL 在已签名地址上附加 TOS 图片处理参数。
// 签名仍绑定原对象路径；CDN 缓存键必须保留 x-tos-process，避免不同尺寸互相覆盖。
func SignedVolcengineCDNPreviewURL(setting Settings, objectKey string, expires time.Time, width int) (string, error) {
	if width != 320 && width != 640 {
		return "", errors.New("预览尺寸无效")
	}
	raw, err := SignedVolcengineCDNAURL(setting, objectKey, expires)
	if err != nil {
		return "", err
	}
	return appendQuery(raw, "x-tos-process", fmt.Sprintf("image/resize,w_%d/format,webp", width))
}

// SignedVolcengineCDNDownloadURL 让 TOS 经 CDN 回写附件响应头。
// 该参数必须参与缓存键，否则附件响应会污染同一对象的内联展示缓存。
func SignedVolcengineCDNDownloadURL(setting Settings, objectKey string, expires time.Time, fileName string) (string, error) {
	raw, err := SignedVolcengineCDNAURL(setting, objectKey, expires)
	if err != nil {
		return "", err
	}
	return appendQuery(raw, "response-content-disposition", objectDownloadContentDisposition(fileName, objectKey))
}

func appendQuery(raw, name, value string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	extra := url.QueryEscape(name) + "=" + url.QueryEscape(value)
	if u.RawQuery == "" {
		u.RawQuery = extra
	} else {
		u.RawQuery += "&" + extra
	}
	return u.String(), nil
}
