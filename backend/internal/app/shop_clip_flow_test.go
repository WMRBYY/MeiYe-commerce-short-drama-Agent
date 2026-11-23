package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/cliprender"
	"yingce/backend/internal/model"
)

// Exercises the real Service -> durable queue -> worker -> resource path.
// Only speech recognition is simulated, at its HTTP transport boundary; this
// test does not establish ASR accuracy or the quality of real model output.
func TestShopClipSubtitleFlowCreatesAnalyzesEditsAndRenders(t *testing.T) {
	requireFFmpegTools(t)
	if err := shopClipRenderCapability("subtitle"); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	recognized := strings.Repeat("这款保温杯容量是五百毫升，出门携带很方便。", 4)
	asr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/inference" {
			t.Errorf("unexpected ASR request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("ASR multipart: %v", err)
			http.Error(w, "bad multipart", http.StatusBadRequest)
			return
		}
		defer r.MultipartForm.RemoveAll()
		file, _, err := r.FormFile("file")
		if err != nil {
			t.Errorf("ASR audio file: %v", err)
			http.Error(w, "missing audio", http.StatusBadRequest)
			return
		}
		defer file.Close()
		audio, err := io.ReadAll(file)
		if err != nil || len(audio) < 32000 || string(audio[:4]) != "RIFF" || string(audio[8:12]) != "WAVE" || r.FormValue("response_format") != "verbose_json" {
			t.Errorf("ASR did not receive a real extracted WAV: bytes=%d err=%v", len(audio), err)
			http.Error(w, "bad WAV", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(whisperVerboseJSON{Language: "zh", Segments: []whisperSegment{{Start: 0.25, End: 1.75, Text: recognized}}})
	}))
	defer asr.Close()
	t.Setenv(shopClipWhisperEnv, asr.URL)
	t.Setenv(whisperLangEnv, "http://127.0.0.1:1")

	// Use the complete isolated schema for task admission, quota accounting,
	// activity logs and resource references, with the same temporary local storage
	// setup used by newResourceTestService.
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	svc.activeCancels = map[string]context.CancelFunc{}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	features := defaultFeatureAvailability()
	features.EcommerceEnabled = true
	saveAdmissionFeatures(t, svc, features)

	ffmpeg, err := renderFfmpegBinary()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	if output, err := cliprender.Run(context.Background(), ffmpeg, []string{
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", source,
	}, dir); err != nil {
		t.Fatalf("create real video: %v %s", err, output)
	}
	payload, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	const owner = "shop-clip-flow-owner"
	if err := db.Create(&model.CreditAccount{UserID: owner, AvailableMicrocredits: 100 * CreditScale}).Error; err != nil {
		t.Fatal(err)
	}
	assertBalance := func(credits int64) {
		t.Helper()
		account, err := svc.repo.CreditAccount(owner)
		if err != nil || account.AvailableMicrocredits != credits*CreditScale || account.ReservedMicrocredits != 0 {
			t.Fatalf("wallet should have %d available credits and no frozen funds: %+v %v", credits, account, err)
		}
	}
	resource, _, err := svc.storeResource(owner, "media", "source.mp4", "video/mp4", int64(len(payload)), 320, 180, 2000, bytes.NewReader(payload), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	expectedCredits := int64(10)
	request := ShopClipCreateRequest{IdempotencyKey: "flow-create-one", Mode: "subtitle", SourceResourceID: resource.ID, TemplateID: "clean", Title: "保温杯使用分享", ExpectedCredits: &expectedCredits}
	quote, err := svc.QuoteShopClip(owner, request)
	if err != nil || quote.Credits != 10 || quote.ChargeMode != "fixed" || calls.Load() != 0 {
		t.Fatalf("quote should price the finished clip without ASR or charging: %+v %v", quote, err)
	}
	assertBalance(100)
	created, err := svc.CreateShopClip(ctx, owner, request)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if created.Status != "analyzing" || created.TaskID == "" || calls.Load() != 0 {
		t.Fatalf("creation must persist a queued task: %+v calls=%d", created, calls.Load())
	}
	duplicate, err := svc.CreateShopClip(ctx, owner, request)
	if err != nil || duplicate.ID != created.ID || duplicate.TaskID != created.TaskID {
		t.Fatalf("duplicate creation: %+v %v", duplicate, err)
	}
	assertBalance(100)
	worker := newTaskWorkerCoordinator(svc)
	runQueued := func(expectedID, expectedType string) {
		t.Helper()
		task, err := svc.repo.ClaimNextTask("flow-worker-"+expectedType, time.Minute)
		if err != nil || task == nil || task.ID != expectedID || task.Type != expectedType {
			t.Fatalf("claim durable task: %+v %v", task, err)
		}
		if err := worker.processClaimedTask(task, nil); err != nil {
			t.Fatalf("worker dispatch: %v", err)
		}
		stored, err := svc.repo.TaskForUser(owner, task.ID)
		if err != nil || stored.Status != model.TaskStatusSucceeded {
			t.Fatalf("worker terminal result: %+v %v", stored, err)
		}
	}
	runQueued(created.TaskID, model.TaskTypeShopClipAnalysis)
	ready, err := svc.ShopClip(owner, created.ID)
	if err != nil || ready.Status != "ready" || len(ready.Plan.Transcript) < 2 || calls.Load() != 1 {
		t.Fatalf("analysis result: %+v %v calls=%d", ready, err, calls.Load())
	}
	assertBalance(100)
	var analysisOrders int64
	if err := db.Model(&model.BillingOrder{}).Where("task_id = ?", created.TaskID).Count(&analysisOrders).Error; err != nil || analysisOrders != 0 {
		t.Fatalf("review-only analysis must not create a charge: %d %v", analysisOrders, err)
	}
	if ready.Plan.Transcript[0].StartMs != 250 || ready.Plan.Transcript[len(ready.Plan.Transcript)-1].EndMs != 1750 {
		t.Fatalf("real transport segment boundaries were changed: %+v", ready.Plan.Transcript)
	}
	var recovered strings.Builder
	for _, cue := range ready.Plan.Transcript {
		if len([]rune(cue.Text)) > 80 {
			t.Fatalf("long ASR segment was not split: %+v", cue)
		}
		recovered.WriteString(cue.Text)
	}
	if recovered.String() != recognized || ready.AnalysisStep != "asr_done" {
		t.Fatalf("split transcript or durable ASR checkpoint missing: %+v", ready)
	}
	corrected := ready.Plan
	corrected.Transcript = append([]ShopClipCue(nil), ready.Plan.Transcript...)
	corrected.Transcript[0].Text = "校对后的商品字幕"
	edited, err := svc.UpdateShopClipPlan(ctx, owner, ready.ID, corrected)
	if err != nil || edited.Plan.Version != ready.Plan.Version+1 || edited.Plan.Transcript[0].Text != corrected.Transcript[0].Text {
		t.Fatalf("save correction: %+v %v", edited, err)
	}
	// Export must reuse the saved transcript even if the ASR service is no longer configured.
	t.Setenv(shopClipWhisperEnv, "")
	t.Setenv(whisperLangEnv, "")
	attempt := ShopClipAttemptRequest{IdempotencyKey: "flow-render-one", ExpectedCredits: &expectedCredits}
	rendering, err := svc.StartShopClipAttempt(ctx, owner, edited.ID, attempt, false)
	if err != nil || rendering.Status != "rendering" {
		t.Fatalf("start render: %+v %v", rendering, err)
	}
	assertBalance(90)
	runQueued(rendering.TaskID, model.TaskTypeShopClipRender)
	finished, err := svc.ShopClip(owner, edited.ID)
	if err != nil || finished.Status != "succeeded" || finished.OutputResourceID == "" || calls.Load() != 1 {
		t.Fatalf("finished project: %+v %v calls=%d", finished, err, calls.Load())
	}
	replayed, err := svc.StartShopClipAttempt(ctx, owner, edited.ID, attempt, false)
	if err != nil || replayed.TaskID != finished.TaskID {
		t.Fatalf("completed render replay must reuse task: %+v %v", replayed, err)
	}
	assertBalance(90)
	var orders []model.BillingOrder
	if err := db.Where("task_id = ?", finished.TaskID).Find(&orders).Error; err != nil || len(orders) != 1 || orders[0].Status != model.BillingStatusSettled || orders[0].ActualAmountMicrocredits != 10*CreditScale {
		t.Fatalf("completed render must settle exactly one 10-credit order: %+v %v", orders, err)
	}
	stored, reader, err := svc.OpenResource(owner, finished.OutputResourceID)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	outputPath := filepath.Join(dir, "actual-output.mp4")
	file, err := os.Create(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	_, copyErr := io.Copy(file, reader)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		t.Fatalf("read saved result: %v %v", copyErr, closeErr)
	}
	probe, err := probeMediaFile(ctx, outputPath)
	if err != nil || probe.Width != 320 || probe.Height != 180 || probe.DurationMs < 1950 || probe.DurationMs > 2100 || stored.MimeType != "video/mp4" {
		t.Fatalf("saved output invalid: %+v mime=%s err=%v", probe, stored.MimeType, err)
	}
	if audio, err := shopClipAudioStream(ctx, outputPath); err != nil || !audio {
		t.Fatalf("source audio not preserved: %v %v", audio, err)
	}
	var taskCount int64
	if err := db.Model(&model.Task{}).Where("user_id = ?", owner).Count(&taskCount).Error; err != nil || taskCount != 2 {
		t.Fatalf("replayed requests created extra tasks: %d %v", taskCount, err)
	}
	refs, err := svc.repo.ShopClipResourceReferences(owner, []string{resource.ID, finished.OutputResourceID})
	if err != nil || len(refs) != 2 {
		t.Fatalf("source and output not protected by project references: %+v %v", refs, err)
	}
}
