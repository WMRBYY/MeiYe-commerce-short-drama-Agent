package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"yingce/backend/internal/outbound"
	"yingce/backend/internal/storage"
)

func inspirationVideoDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func inspirationVideoObjectKey(setting ossSettingValue, digest string) string {
	return path.Join(setting.PathPrefix, "inspirations", "seedance", digest+".mp4")
}

func (s *Service) inspirationVideoStorage() (ossSettingValue, error) {
	setting, err := s.activeOSSSetting()
	if err != nil {
		return ossSettingValue{}, err
	}
	if setting.Provider != "aliyun" || setting.CDNBaseURL == "" || setting.Delivery.CDNAuthMode != "aliyun_a" || !setting.Delivery.RequireCDN {
		return ossSettingValue{}, errors.New("精选视频需要已启用的阿里云 OSS 与签名 CDN")
	}
	return setting, nil
}

// InspirationVideoCDNURL only signs the dedicated, publicly licensed catalog prefix.
// User-owned resources remain behind their existing ownership checks.
func (s *Service) InspirationVideoCDNURL(digest string) (string, error) {
	if !inspirationVideoDigest(digest) {
		return "", BadAuthRequest("视频标识无效")
	}
	setting, err := s.inspirationVideoStorage()
	if err != nil {
		return "", err
	}
	return storage.SignCDNURL(setting, inspirationVideoObjectKey(setting, digest), time.Now().Add(5*time.Minute))
}

// InspirationVideoPutURL is only used by the offline migration command.
// The signed URL is never returned by a public handler.
func (s *Service) InspirationVideoPutURL(digest string) (string, error) {
	if !inspirationVideoDigest(digest) {
		return "", BadAuthRequest("视频标识无效")
	}
	setting, err := s.inspirationVideoStorage()
	if err != nil {
		return "", err
	}
	return storage.SignedAliyunOSSPutURL(setting, inspirationVideoObjectKey(setting, digest), "video/mp4", time.Now().Add(time.Hour))
}

func (s *Service) VerifyInspirationVideoOrigin(digest string) error {
	if !inspirationVideoDigest(digest) {
		return BadAuthRequest("视频标识无效")
	}
	setting, err := s.inspirationVideoStorage()
	if err != nil {
		return err
	}
	stream, err := storage.GetOriginObjectRange(setting, inspirationVideoObjectKey(setting, digest), "")
	if err != nil {
		return err
	}
	defer stream.Body.Close()
	if stream.StatusCode != http.StatusOK {
		return errors.New("精选视频 OSS 回读失败")
	}
	verified := sha256.New()
	if _, err := io.Copy(verified, stream.Body); err != nil {
		return err
	}
	if hex.EncodeToString(verified.Sum(nil)) != digest {
		return errors.New("精选视频 OSS 回读 SHA-256 不一致")
	}
	return nil
}

func (s *Service) VerifyInspirationVideoCDN(digest string) error {
	cdnURL, err := s.InspirationVideoCDNURL(digest)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodGet, cdnURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Range", "bytes=0-11")
	resp, err := outbound.OutboundHTTPClient(15 * time.Second).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		return errors.New("精选视频 CDN Range 请求未返回 206")
	}
	var header [12]byte
	if _, err := io.ReadFull(resp.Body, header[:]); err != nil || !strings.Contains(string(header[4:12]), "ftyp") {
		return errors.New("精选视频 CDN 返回内容无效")
	}
	return nil
}

// ImportInspirationVideo uploads an already verified local MP4 to the licensed
// catalog prefix. Its name is the file SHA-256, making retries idempotent.
func (s *Service) ImportInspirationVideo(digest, filePath string) error {
	if !inspirationVideoDigest(digest) {
		return BadAuthRequest("视频标识无效")
	}
	setting, err := s.inspirationVideoStorage()
	if err != nil {
		return err
	}
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 12 || info.Size() > 256<<20 {
		return errors.New("精选视频文件大小或类型无效")
	}
	var header [12]byte
	if _, err := io.ReadFull(file, header[:]); err != nil || !strings.Contains(string(header[4:12]), "ftyp") {
		return errors.New("精选视频不是 MP4 文件")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != digest {
		return errors.New("精选视频 SHA-256 与标识不符")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	key := inspirationVideoObjectKey(setting, digest)
	if _, err := storage.PutOSSObject(setting, key, "video/mp4", info.Size(), file); err != nil {
		return err
	}
	stream, err := storage.GetOriginObjectRange(setting, key, "")
	if err != nil {
		return err
	}
	defer stream.Body.Close()
	verified := sha256.New()
	if _, err := io.Copy(verified, stream.Body); err != nil {
		return err
	}
	if hex.EncodeToString(verified.Sum(nil)) != digest {
		return errors.New("精选视频 OSS 回读 SHA-256 不一致")
	}
	return nil
}
