package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const avatarMaxBytes = 4 << 20
const avatarMaxDimension = 4096

var avatarTokenPattern = regexp.MustCompile(`^[a-f0-9]{32}\.jpg$`)

func (s *Service) UpdateOwnProfile(actor *model.User, nickname *string, header *multipart.FileHeader) (*auth.AuthUser, error) {
	if actor == nil || actor.ID == "" {
		return nil, Unauthorized("请先登录")
	}
	var normalized *string
	if nickname != nil {
		name, err := auth.NormalizeProfileNickname(*nickname)
		if err != nil {
			return nil, err
		}
		normalized = &name
	}
	if normalized == nil && header == nil {
		return nil, BadAuthRequest("请选择头像或填写昵称")
	}
	var avatarURL *string
	if header != nil {
		if header.Size <= 0 || header.Size > avatarMaxBytes {
			return nil, BadAuthRequest("头像文件须小于 4MB")
		}
		file, err := header.Open()
		if err != nil {
			return nil, err
		}
		defer file.Close()
		payload, err := io.ReadAll(io.LimitReader(file, avatarMaxBytes+1))
		if err != nil {
			return nil, err
		}
		if len(payload) > avatarMaxBytes {
			return nil, BadAuthRequest("头像文件须小于 4MB")
		}
		value, err := s.storeAvatar(actor.ID, payload)
		if err != nil {
			return nil, err
		}
		avatarURL = &value
	}
	user, err := s.repo.UpdateOwnProfile(actor.ID, normalized, avatarURL)
	if err != nil {
		if avatarURL != nil {
			_ = os.Remove(s.avatarPath(filepath.Base(*avatarURL)))
		}
		return nil, err
	}
	public, err := s.PublicAuthUser(user)
	if err != nil {
		return nil, err
	}
	return &public, nil
}

func (s *Service) avatarPath(token string) string { return filepath.Join(s.dataDir, "avatars", token) }

func (s *Service) storeAvatar(userID string, payload []byte) (string, error) {
	encoded, err := normalizeAvatarImage(payload)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, "avatars"), 0o700); err != nil {
		return "", err
	}
	token := kernel.NewID() + ".jpg"
	path := s.avatarPath(token)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	if _, err = file.Write(encoded); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return "", err
	}
	if err = file.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return "/api/profile/avatars/" + url.PathEscape(userID) + "/" + token, nil
}

func normalizeAvatarImage(payload []byte) ([]byte, error) {
	if len(payload) == 0 || len(payload) > avatarMaxBytes {
		return nil, BadAuthRequest("头像文件须小于 4MB")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(payload))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return nil, BadAuthRequest("仅支持 JPG、PNG、WebP 图片")
	}
	if config.Width < 32 || config.Height < 32 || config.Width > avatarMaxDimension || config.Height > avatarMaxDimension || int64(config.Width)*int64(config.Height) > 12_000_000 {
		return nil, BadAuthRequest("头像尺寸须在 32–4096 像素且不超过 1200 万像素")
	}
	decoded, decodedFormat, err := image.Decode(bytes.NewReader(payload))
	if err != nil || decodedFormat != format {
		return nil, BadAuthRequest("头像图片内容无效")
	}
	bounds := decoded.Bounds()
	side := bounds.Dx()
	if bounds.Dy() < side {
		side = bounds.Dy()
	}
	source := image.Rect(bounds.Min.X+(bounds.Dx()-side)/2, bounds.Min.Y+(bounds.Dy()-side)/2, bounds.Min.X+(bounds.Dx()+side)/2, bounds.Min.Y+(bounds.Dy()+side)/2)
	dst := image.NewRGBA(image.Rect(0, 0, 512, 512))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(dst, dst.Bounds(), decoded, source, draw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (s *Service) AvatarForUser(userID, token string) ([]byte, error) {
	if !avatarTokenPattern.MatchString(token) {
		return nil, NotFound("头像不存在")
	}
	user, err := s.repo.User(userID)
	if err != nil {
		return nil, NotFound("头像不存在")
	}
	if user.AvatarURL != "/api/profile/avatars/"+url.PathEscape(userID)+"/"+token {
		return nil, NotFound("头像不存在")
	}
	return os.ReadFile(s.avatarPath(token))
}

// StoreWeChatAvatar stores only an actual image from a Tencent avatar host.
// The dialer pins a public DNS result and redirects are forbidden.
func (s *Service) StoreWeChatAvatar(ctx context.Context, userID, rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Port() != "" || !strings.HasSuffix(strings.ToLower(u.Hostname()), ".qlogo.cn") {
		return "", BadAuthRequest("微信头像地址无效")
	}
	u.Scheme = "https"
	lookupCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIPAddr(lookupCtx, u.Hostname())
	if err != nil || len(ips) == 0 {
		return "", errors.New("微信头像域名解析失败")
	}
	var publicIP string
	for _, candidate := range ips {
		ip, ok := netip.AddrFromSlice(candidate.IP)
		if !ok || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			return "", BadAuthRequest("微信头像地址无效")
		}
		if publicIP == "" {
			publicIP = ip.String()
		}
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 4 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(publicIP, "443"))
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.ContentLength > avatarMaxBytes {
		return "", fmt.Errorf("微信头像下载失败: %d", resp.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, avatarMaxBytes+1))
	if err != nil {
		return "", err
	}
	stored, err := s.storeAvatar(userID, payload)
	if err != nil {
		return "", err
	}
	return stored, nil
}
