package app

import (
	"context"
	"crypto/tls"

	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/videoparser"
)

const videoLinkKuaishouPage = `<html><script>window.INIT_STATE = {"a":{"photo":{"caption":"测试商品视频","photoType":"VIDEO","userName":"测试作者","duration":5000,"width":320,"height":240,"mainMvUrls":[{"cdn":"txmov2.a.kwimgs.com","url":"https://txmov2.a.kwimgs.com/upic/test_b.mp4"}]}}}</script></html>`

// newVideoLinkTestService 组合资源存储（本地存储）、通用素材库的表；解析服务的网络出口指向本地假上游。
func newVideoLinkTestService(t *testing.T, media []byte) (*Service, *httptest.Server) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}, &model.UserDailyUploadUsage{}, &model.Resource{}, &model.ResourceOffloadJob{}, &model.UploadReservation{}, &model.UserStorageGrant{}, &model.UserStorageState{},
		&model.Task{}, &model.Asset{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Host == "v.kuaishou.com":
			http.Redirect(w, r, "https://www.kuaishou.com/short-video/3x8zha3ipq6bg8q", http.StatusFound)
		case r.Host == "www.kuaishou.com":
			_, _ = w.Write([]byte("<html></html>"))
		case r.Host == "v.m.chenzhongtech.com":
			_, _ = w.Write([]byte(videoLinkKuaishouPage))
		case strings.HasSuffix(r.URL.Path, ".mp4"):
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write(media)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	addr := upstream.Listener.Addr().String()
	client := func(timeout time.Duration, _ string) *http.Client {
		return &http.Client{Timeout: timeout, Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, network, addr)
			},
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // 仅测试：本地自签证书
		}}
	}
	ffmpeg, _ := exec.LookPath("ffmpeg")
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"videoWorkbenchEnabled":true}`}); err != nil {
		t.Fatal(err)
	}
	svc.videoLinkParserSvc = videoparser.New(videoparser.Options{HTTPClient: client, FFmpegPath: ffmpeg, YTDLPPath: "/fake/yt-dlp", NoBrowser: true, MaxBytes: mediaMaxVideoBytes, MaxDurationMs: mediaReferenceMaxSourceMs}, nil)
	return svc, upstream
}

func videoLinkTestMedia(t *testing.T) []byte {
	t.Helper()
	out := filepath.Join(t.TempDir(), "source.mp4")
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mp4", out}
	if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		args[len(args)-9] = "mpeg4"
		if retry, retryErr := exec.Command("ffmpeg", args...).CombinedOutput(); retryErr != nil {
			t.Fatalf("ffmpeg: %v %s %s", retryErr, output, retry)
		}
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// 资源：转存完成、类型为视频、媒体参数来自 ffprobe。

// 素材库：素材指向这个资源，来源记录平台信息，不保存上游临时地址。

// 项目：参考视频就是这个资源，ffprobe 读到画面与音轨（供「保留原音乐和节奏」使用）。

// 再次粘贴同一作品：复用已转存的资源与素材，不重复下载、不重复登记。

// 真实授权集成测试：用真实平台的公开作品走完整导入（解析 → 下载 → ffprobe → 资源 → 素材库 → 参考视频），默认跳过。
//
//	VIDEO_PARSER_LIVE=1 VIDEO_PARSER_LIVE_LINK='<分享链接或文案>' go test ./internal/app -run TestImportVideoLinkLive -v
