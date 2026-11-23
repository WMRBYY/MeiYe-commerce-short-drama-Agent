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
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// External intelligence is a controlled HTTP fixture. Actual source trimming,
// extraction, durable tasks, ASS rendering and saved MP4 decoding remain real.
func TestShopClipAutoFlowResumesDirectorAndRendersSelectedRange(t *testing.T) {
	requireFFmpegTools(t)
	if err := shopClipRenderCapability("koubo"); err != nil {
		t.Fatal(err)
	}
	f := newShopClipCostFixture(t)
	if err := f.db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	svc := f.svc
	if err := f.db.Model(&model.CreditAccount{}).Where("user_id = ?", "owner").Update("available_microcredits", 100*CreditScale).Error; err != nil {
		t.Fatal(err)
	}
	assertBalance := func(available, reserved int64) {
		t.Helper()
		account, err := svc.repo.CreditAccount("owner")
		if err != nil || account.AvailableMicrocredits != available*CreditScale || account.ReservedMicrocredits != reserved*CreditScale {
			t.Fatalf("wallet should be available=%d reserved=%d credits: %+v %v", available, reserved, account, err)
		}
	}
	connection, err := f.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "vision-test")
	profile.Text.References.MaxImages = 5
	if err := f.db.Model(&model.ChannelModel{}).Where("id = ?", "cm-text").Updates(map[string]any{"protocol": model.ChannelInterfaceChatCompletion, "capability_config_json": mustEncodeModelCapabilityConfig(t, profile)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Model(&model.ModelChannel{}).Where("id = ?", "ch-1").Update("api_key", "fixture-key").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: `{"vision":{"channelModelId":"cm-text","channelId":"ch-1","modelKey":"vision-test"},"asr":{"mode":"vision"}}`}); err != nil {
		t.Fatal(err)
	}
	var asrCalls, categoryCalls, directorCalls atomic.Int32
	asr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asrCalls.Add(1)
		if r.URL.Path != "/inference" {
			t.Errorf("unexpected ASR endpoint %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(whisperVerboseJSON{Language: "zh", Segments: []whisperSegment{{Start: 0.1, End: 1.9, Text: "这一处商品细节值得放大看清楚"}}})
	}))
	defer asr.Close()
	t.Setenv(shopClipWhisperEnv, asr.URL)
	t.Setenv(whisperLangEnv, "")
	category := svc.ShopClipKnowledgeCategories()[0].ID
	f.reply.Store(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		content := ""
		switch {
		case bytes.Contains(body, []byte("captionMaxChars")):
			if directorCalls.Add(1) == 1 {
				http.Error(w, "fixture planning failure", http.StatusBadRequest)
				return
			}
			if !bytes.Contains(body, []byte("bubble")) || !bytes.Contains(body, []byte("knowledge")) {
				t.Error("director did not receive selected visuals and knowledge")
			}
			content = `{"captionMaxChars":8,"summary":"按真实口播拆分短句，保留字幕与原声的时间边界。","corrections":[]}`
		case bytes.Contains(body, []byte("categories")):
			categoryCalls.Add(1)
			if !bytes.Contains(body, []byte("data:image/jpeg;base64,")) {
				t.Error("category recognition received no actual extracted frames")
			}
			data, _ := json.Marshal(map[string]any{"categoryId": category, "evidence": []string{"测试画面存在色块，口播提到商品细节。"}})
			content = string(data)
		default:
			t.Error("unexpected model request")
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "clip-response", "choices": []any{map[string]any{"message": map[string]any{"content": content}}}, "usage": map[string]int{"prompt_tokens": 100, "completion_tokens": 50}})
	})
	ffmpeg, err := renderFfmpegBinary()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "original.mp4")
	if logs, err := cliprender.Run(context.Background(), ffmpeg, []string{"-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", sourcePath}, dir); err != nil {
		t.Fatalf("source: %v %s", err, logs)
	}
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	resource, _, err := svc.storeResource("owner", "media", "original.mp4", "video/mp4", int64(len(data)), 320, 180, 3000, bytes.NewReader(data), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	expectedCredits := int64(10)
	req := ShopClipCreateRequest{IdempotencyKey: "auto-studio-create", Mode: "koubo", AutoRender: true, Title: "把商品细节讲清楚", SourceResourceID: resource.ID, TemplateID: "bubble", TrimStartMs: 500, TrimEndMs: 2500, ExpectedCredits: &expectedCredits}
	quote, err := svc.QuoteShopClip("owner", req)
	if err != nil || quote.Credits != 10 || quote.ChargeMode != "fixed" || f.calls.Load() != 0 || asrCalls.Load() != 0 {
		t.Fatalf("quote should be local and fixed at 10 credits: %+v %v", quote, err)
	}
	assertBalance(100, 0)
	admissionCounts := func() [4]int64 {
		t.Helper()
		var counts [4]int64
		for i, entity := range []any{&model.ShopClipProject{}, &model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
			if err := f.db.Model(entity).Where("user_id = ?", "owner").Count(&counts[i]).Error; err != nil {
				t.Fatal(err)
			}
		}
		return counts
	}
	beforeAdmission := admissionCounts()
	if err := f.db.Model(&model.CreditAccount{}).Where("user_id = ?", "owner").Update("available_microcredits", 9*CreditScale).Error; err != nil {
		t.Fatal(err)
	}
	unfunded := req
	unfunded.IdempotencyKey = "auto-studio-insufficient-balance"
	if project, err := svc.CreateShopClip(context.Background(), "owner", unfunded); err == nil || project != nil {
		t.Fatalf("insufficient credits should reject admission: %+v %v", project, err)
	}
	assertBalance(9, 0)
	if afterAdmission := admissionCounts(); afterAdmission != beforeAdmission {
		t.Fatalf("rejected admission left project/task/order/ledger records: before=%v after=%v", beforeAdmission, afterAdmission)
	}
	if f.calls.Load() != 0 || asrCalls.Load() != 0 {
		t.Fatal("rejected admission called an upstream service")
	}
	if err := f.db.Model(&model.CreditAccount{}).Where("user_id = ?", "owner").Update("available_microcredits", 100*CreditScale).Error; err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateShopClip(context.Background(), "owner", req)
	if err != nil {
		t.Fatal(err)
	}
	if created.Plan.DurationMs != 2000 || created.Plan.SourceDurationMs != 3000 {
		t.Fatalf("source and selected clocks confused: %+v", created.Plan)
	}
	if created.Plan.PricingVersion != 1 || created.Plan.Credits != 10 {
		t.Fatalf("created plan lacks fixed pricing snapshot: %+v", created.Plan)
	}
	assertBalance(90, 0)
	replayedCreate, err := svc.CreateShopClip(context.Background(), "owner", req)
	if err != nil || replayedCreate.ID != created.ID || replayedCreate.TaskID != created.TaskID {
		t.Fatalf("replayed create changed charged task: %+v %v", replayedCreate, err)
	}
	assertBalance(90, 0)
	worker := newTaskWorkerCoordinator(svc)
	run := func(id, kind, status string) {
		t.Helper()
		task, err := svc.repo.ClaimNextTask("auto-studio-worker", time.Minute)
		if err != nil || task == nil || task.ID != id || task.Type != kind {
			t.Fatalf("claim: %+v %v", task, err)
		}
		if err := worker.processClaimedTask(task, nil); err != nil {
			t.Fatal(err)
		}
		stored, err := svc.repo.TaskForUser("owner", id)
		if err != nil || string(stored.Status) != status {
			t.Fatalf("task result: %+v %v", stored, err)
		}
	}
	run(created.TaskID, model.TaskTypeShopClipAnalysis, string(model.TaskStatusFailed))
	failed, err := svc.ShopClip("owner", created.ID)
	if err != nil || failed.Plan.Director == nil || failed.Plan.Director.CaptionMaxChars != 0 || failed.AnalysisStep != "director_running" || failed.RetryStage != "analyze" {
		t.Fatalf("paid category checkpoint not preserved: %+v %v", failed, err)
	}
	assertBalance(100, 0)
	var refunded []model.BillingOrder
	if err := f.db.Where("task_id = ? AND amount_microcredits > 0", created.TaskID).Find(&refunded).Error; err != nil || len(refunded) != 1 || refunded[0].Status != model.BillingStatusRefunded || refunded[0].AmountMicrocredits != 10*CreditScale {
		t.Fatalf("failed auto clip did not refund its single order: %+v %v", refunded, err)
	}
	attempt := ShopClipAttemptRequest{IdempotencyKey: "auto-studio-resume", ExpectedCredits: &expectedCredits}
	resumed, err := svc.StartShopClipAttempt(context.Background(), "owner", created.ID, attempt, true)
	if err != nil {
		t.Fatal(err)
	}
	assertBalance(90, 0)
	replayedRetry, err := svc.StartShopClipAttempt(context.Background(), "owner", created.ID, attempt, true)
	if err != nil || replayedRetry.TaskID != resumed.TaskID {
		t.Fatalf("replayed retry changed charged task: %+v %v", replayedRetry, err)
	}
	assertBalance(90, 0)
	run(resumed.TaskID, model.TaskTypeShopClipAnalysis, string(model.TaskStatusSucceeded))
	finished, err := svc.ShopClip("owner", created.ID)
	if err != nil || finished.Status != "succeeded" || finished.OutputResourceID == "" || finished.Plan.Director.CaptionMaxChars != 8 || finished.Plan.Director.KnowledgeDigest == "" {
		t.Fatalf("automatic render did not finish: %+v %v", finished, err)
	}
	if asrCalls.Load() != 1 || categoryCalls.Load() != 1 || directorCalls.Load() != 2 {
		t.Fatalf("resume repeated completed external stages: asr=%d category=%d director=%d", asrCalls.Load(), categoryCalls.Load(), directorCalls.Load())
	}
	assertBalance(90, 0)
	replayedRetry, err = svc.StartShopClipAttempt(context.Background(), "owner", created.ID, attempt, true)
	if err != nil || replayedRetry.TaskID != resumed.TaskID {
		t.Fatalf("completed retry replay changed charged task: %+v %v", replayedRetry, err)
	}
	assertBalance(90, 0)
	cancelled, err := svc.CancelShopClip(context.Background(), "owner", finished.ID)
	if err != nil || cancelled.Status != "succeeded" || cancelled.OutputResourceID != finished.OutputResourceID {
		t.Fatalf("cancellation changed a completed clip: %+v %v", cancelled, err)
	}
	assertBalance(90, 0)
	var settled []model.BillingOrder
	if err := f.db.Where("task_id = ? AND amount_microcredits > 0", resumed.TaskID).Find(&settled).Error; err != nil || len(settled) != 1 || settled[0].Status != model.BillingStatusSettled || settled[0].ActualAmountMicrocredits != 10*CreditScale {
		t.Fatalf("successful auto clip did not settle exactly 10 credits: %+v %v", settled, err)
	}
	var ledger []model.CreditLedgerEntry
	if err := f.db.Where("billing_order_id IN ?", []string{refunded[0].ID, settled[0].ID}).Find(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	var availableDelta, reservedDelta int64
	consumeCount, refundCount := 0, 0
	for _, entry := range ledger {
		availableDelta += entry.AvailableDeltaMicrocredits
		reservedDelta += entry.ReservedDeltaMicrocredits
		if entry.Type == model.CreditLedgerConsume {
			consumeCount++
		}
		if entry.Type == model.CreditLedgerRefund {
			refundCount++
		}
	}
	if availableDelta != -10*CreditScale || reservedDelta != 0 || consumeCount != 2 || refundCount != 1 {
		t.Fatalf("retry/refund ledger does not reconcile to one completed clip: %+v", ledger)
	}
	_, reader, err := svc.OpenResource("owner", finished.OutputResourceID)
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "saved-output.mp4")
	file, err := os.Create(output)
	if err != nil {
		reader.Close()
		t.Fatal(err)
	}
	_, copyErr := io.Copy(file, reader)
	reader.Close()
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		t.Fatalf("saved output: %v %v", copyErr, closeErr)
	}
	probe, err := probeMediaFile(context.Background(), output)
	if err != nil || probe.DurationMs < 1950 || probe.DurationMs > 2100 || probe.Width != 320 || probe.Height != 180 {
		t.Fatalf("selected output incorrect: %+v %v", probe, err)
	}
	if audio, err := shopClipAudioStream(context.Background(), output); err != nil || !audio {
		t.Fatalf("trim lost voice: %v %v", audio, err)
	}
	var tasks int64
	if err := f.db.Model(&model.Task{}).Where("user_id = ?", "owner").Count(&tasks).Error; err != nil || tasks != 2 {
		t.Fatalf("auto completion created an unnecessary extra render task: %d %v", tasks, err)
	}
}

func TestShopClipRenderCheckpointRemainsCancellable(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	svc.activeCancels = map[string]context.CancelFunc{}
	p := &model.ShopClipProject{ID: "clip-render-retry", UserID: "owner", RequestKey: "render-retry-key", Status: "rendering", TaskID: "render-retry-task", PlanJSON: `{}`}
	if err := svc.repo.CreateShopClip(p, nil); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(newShopClipTask(p, model.TaskTypeShopClipRender)).Error; err != nil {
		t.Fatal(err)
	}
	task, err := svc.repo.ClaimNextTask("render-retry-worker", time.Minute)
	if err != nil || task == nil {
		t.Fatalf("claim render task: %+v %v", task, err)
	}
	if err := svc.repo.ShopClipCheckpoint(task, p.ID, "render_running", `{}`); err != nil {
		t.Fatalf("rendering project cannot checkpoint: %v", err)
	}
	if _, err := svc.CancelShopClip(context.Background(), "owner", p.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.ShopClipCheckpoint(task, p.ID, "render_running", `{}`); err == nil || !strings.Contains(err.Error(), repository.ErrTaskStateConflict.Error()) {
		t.Fatalf("cancelled render checkpoint accepted: %v", err)
	}
}
