package app

import (
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

// 恢复保存时生成已经结束：图片 8 分钟的生成超时不能截断仍在传输的结果下载。
func TestTaskAttemptTimeoutGivesMediaRecoveryItsOwnBudget(t *testing.T) {
	policy := defaultRuntimePolicy().Task
	image := &model.Task{Type: "canvas_image"}
	if got, want := taskAttemptTimeout(image, policy), taskExecutionTimeout(image, policy); got != want {
		t.Fatalf("generation attempt timeout = %s, want %s", got, want)
	}
	image.MediaRecoveryJSON = "sealed-checkpoint"
	if got := taskAttemptTimeout(image, policy); got != mediaRecoveryAttemptTimeout {
		t.Fatalf("image media recovery timeout = %s, want %s", got, mediaRecoveryAttemptTimeout)
	}
	if mediaRecoveryAttemptTimeout < mediaDownloadMaxDuration {
		t.Fatalf("media recovery timeout %s must cover one full download %s", mediaRecoveryAttemptTimeout, mediaDownloadMaxDuration)
	}
	video := &model.Task{Type: "canvas_video", MediaRecoveryJSON: "sealed-checkpoint"}
	if got, want := taskAttemptTimeout(video, policy), max(taskExecutionTimeout(video, policy), mediaRecoveryAttemptTimeout); got != want {
		t.Fatalf("video media recovery timeout = %s, want %s", got, want)
	}
}

// 一直没等到保存名额时还没开始下载，失败原因要如实说明。
func TestMediaRecoveryBusyTimeoutIsNotReportedAsDownloadFailure(t *testing.T) {
	busy := &mediaRecoveryError{stage: "download", retryable: true, cause: errMediaRecoveryBusy}
	if got := busy.Error(); strings.Contains(got, "下载结果失败") || !strings.Contains(got, "等待保存名额超时") {
		t.Fatalf("busy timeout message = %q", got)
	}
	download := &mediaRecoveryError{stage: "download", retryable: true, cause: errors.New("connection reset")}
	if got := download.Error(); got != "作品已生成，但保存未完成：下载结果失败" {
		t.Fatalf("download failure message = %q", got)
	}
}
