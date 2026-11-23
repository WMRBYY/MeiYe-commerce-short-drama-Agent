package app

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/storage"
)

// verifyVolcenginePrivateCDN 用刚写入的测试对象真实请求火山引擎 CDN，确认：
//   - 有效签名可以读取完整字节（首次请求回源 TOS，验证跨服务授权）；
//   - 对象已进入边缘缓存后，未签名、过期、错误密钥、改路径复用签名均返回 403，
//     即 URL 鉴权先于缓存命中执行；
//   - 控制台「签名有效时间」与应用 TTL 一致（临近到期的签名仍可读、超期签名被拒）；
//   - x-tos-process 预览与 response-content-disposition 下载被回源且各自独立缓存。
//
// 任一项不满足都拒绝保存配置，防止在控制台未开启 URL 鉴权时把私有对象交给公开 CDN。
func verifyVolcenginePrivateCDN(value ossSettingValue, objectKey string, payload []byte) error {
	setting := storage.NormalizeSettings(value)
	ttl := storage.CDNURLTTL(setting)
	ttlSeconds := int64(ttl / time.Second)
	now := time.Now()
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	signed, err := storage.SignedVolcengineCDNAURL(setting, objectKey, now.Add(ttl))
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 签名生成失败", err)
	}
	margin := int64(30)
	if ttlSeconds < 2*margin {
		margin = ttlSeconds / 2
	}
	nearExpiry, err := storage.SignVolcengineCDNAAt(setting, objectKey, now.Unix()-ttlSeconds+margin)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 签名生成失败", err)
	}
	expired, err := storage.SignVolcengineCDNAAt(setting, objectKey, now.Unix()-ttlSeconds-60)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 过期签名生成失败", err)
	}
	unsigned, err := storage.OssCDNObjectURL(setting.CDNBaseURL, objectKey)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "CDN 对象地址无效", err)
	}
	wrongKeySetting := setting
	wrongKeySetting.Delivery.CDNPrimaryKey = "wrong-" + setting.Delivery.CDNPrimaryKey
	if len(wrongKeySetting.Delivery.CDNPrimaryKey) > 120 {
		wrongKeySetting.Delivery.CDNPrimaryKey = wrongKeySetting.Delivery.CDNPrimaryKey[:120]
	}
	wrongKey, err := storage.SignVolcengineCDNAAt(wrongKeySetting, objectKey, now.Unix())
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 测试签名生成失败", err)
	}
	tampered, err := moveSignedQueryToPath(signed, objectKey+".tampered")
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 测试地址生成失败", err)
	}

	type probe struct {
		name string
		url  string
		want int
	}
	for _, p := range []probe{
		{"签名私有读取", signed, http.StatusOK},
		{"临近到期签名读取（确认控制台有效时间不短于应用 TTL）", nearExpiry, http.StatusOK},
		{"未签名访问拒绝（对象已缓存）", unsigned, http.StatusForbidden},
		{"过期签名拒绝（确认控制台有效时间不长于应用 TTL）", expired, http.StatusForbidden},
		{"错误密钥签名拒绝", wrongKey, http.StatusForbidden},
		{"改路径复用签名拒绝", tampered, http.StatusForbidden},
	} {
		response, requestErr := client.Get(p.url)
		if requestErr != nil {
			return WrapAppError(http.StatusBadGateway, "火山引擎 CDN "+p.name+"请求失败", requestErr)
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, int64(len(payload)+1)))
		response.Body.Close()
		if readErr != nil || response.StatusCode != p.want || (p.want == http.StatusOK && !bytes.Equal(body, payload)) {
			return NewAppError(http.StatusBadGateway, "火山引擎 CDN "+p.name+"未通过，请核对 CDN 控制台 URL 鉴权（A 类型、密钥、签名参数名、鉴权算法、有效时间）")
		}
		if p.want == http.StatusOK && strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Disposition")), "attachment") {
			return NewAppError(http.StatusBadGateway, "火山引擎 CDN 默认图片读取意外返回附件头")
		}
	}

	downloadURL, err := storage.SignedVolcengineCDNDownloadURL(setting, objectKey, now.Add(ttl), "cdn-test.png")
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 下载签名失败", err)
	}
	download, err := client.Get(downloadURL)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 下载读取失败", err)
	}
	downloadBody, downloadErr := io.ReadAll(io.LimitReader(download.Body, int64(len(payload)+1)))
	download.Body.Close()
	if downloadErr != nil || download.StatusCode != http.StatusOK || !bytes.Equal(downloadBody, payload) || !strings.HasPrefix(strings.ToLower(download.Header.Get("Content-Disposition")), "attachment") {
		return NewAppError(http.StatusBadGateway, "火山引擎 CDN 原图下载未返回完整文件和附件头，请确认回源参数保留 response-content-disposition")
	}
	inlineAfterDownload, err := client.Get(signed)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN 下载缓存隔离复查失败", err)
	}
	inlineAfterDownload.Body.Close()
	if inlineAfterDownload.StatusCode != http.StatusOK || strings.HasPrefix(strings.ToLower(inlineAfterDownload.Header.Get("Content-Disposition")), "attachment") {
		return NewAppError(http.StatusBadGateway, "火山引擎 CDN 下载响应污染预览缓存，请确认缓存键保留 response-content-disposition")
	}

	previewURL, err := storage.SignedVolcengineCDNPreviewURL(setting, objectKey, now.Add(ttl), 320)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN WebP 预览签名失败", err)
	}
	preview, err := client.Get(previewURL)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "火山引擎 CDN WebP 预览读取失败", err)
	}
	previewBody, readErr := io.ReadAll(io.LimitReader(preview.Body, int64(len(payload))))
	preview.Body.Close()
	if readErr != nil || preview.StatusCode != http.StatusOK || len(previewBody) >= len(payload) || len(previewBody) < 12 || string(previewBody[:4]) != "RIFF" || string(previewBody[8:12]) != "WEBP" {
		return NewAppError(http.StatusBadGateway, "火山引擎 CDN WebP 预览未生效，请确认 x-tos-process 被回源且参与缓存键")
	}
	return nil
}

// moveSignedQueryToPath 把有效签名原样搬到另一个对象路径，用于确认签名与路径绑定。
func moveSignedQueryToPath(signed string, objectKey string) (string, error) {
	u, err := url.Parse(signed)
	if err != nil {
		return "", err
	}
	target, err := url.Parse("/" + strings.TrimLeft(objectKey, "/"))
	if err != nil {
		return "", err
	}
	u.Path = target.Path
	u.RawPath = target.RawPath
	return u.String(), nil
}
