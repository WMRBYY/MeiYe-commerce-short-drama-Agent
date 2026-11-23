package app

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestShopClipPlanRejectsInventedAssetsAndOutOfBounds(t *testing.T) {
	assets := map[string]shopClipAsset{"source": {duration: 10000}, "material": {duration: 4000}}
	base := ShopClipPlan{SourceResourceID: "source", Materials: []string{"material"}, DurationMs: 10000, TemplateID: "clean", Transcript: []ShopClipCue{{StartMs: 0, EndMs: 5000, Text: "这是实际口播"}}, Placements: []ShopClipPlacement{{ResourceID: "material", StartMs: 1000, EndMs: 3000, SourceStartMs: 500}}}
	if err := validateShopClipPlan("mix", base, assets, true); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []ShopClipPlacement{
		{ResourceID: "invented", StartMs: 1000, EndMs: 3000},
		{ResourceID: "source", StartMs: 1000, EndMs: 3000},
		{ResourceID: "material", StartMs: 9000, EndMs: 11000},
		{ResourceID: "material", StartMs: 1000, EndMs: 3000, SourceStartMs: 3000},
	} {
		p := base
		p.Placements = []ShopClipPlacement{bad}
		if validateShopClipPlan("mix", p, assets, true) == nil {
			t.Fatalf("accepted unsafe placement: %+v", bad)
		}
	}
	p := base
	p.Transcript = []ShopClipCue{{StartMs: 0, EndMs: 2000, Text: "一"}, {StartMs: 1000, EndMs: 3000, Text: "二"}}
	if validateShopClipPlan("mix", p, assets, true) == nil {
		t.Fatal("overlapping subtitles accepted")
	}
	p = base
	p.MusicVolume = .6
	if validateShopClipPlan("mix", p, assets, true) == nil {
		t.Fatal("unsafe music volume accepted")
	}
}

func TestShopClipRequestAndPlanConcurrency(t *testing.T) {
	a := ShopClipCreateRequest{IdempotencyKey: "request-one", SourceResourceID: "original", Mode: "subtitle"}
	b := a
	b.IdempotencyKey = "request-two"
	if shopClipRequestHash(a) != shopClipRequestHash(b) {
		t.Fatal("key must not change request fingerprint")
	}
	b.SourceResourceID = "different"
	if shopClipRequestHash(a) == shopClipRequestHash(b) {
		t.Fatal("different input has same fingerprint")
	}
	p := ShopClipPlan{Version: 2, TemplateVersion: 1, SourceResourceID: "original"}
	q := p
	q.Version = 1
	if shopClipImmutablePlan(p, q) == nil {
		t.Fatal("stale editor version accepted")
	}
	q = p
	q.SourceResourceID = "different"
	if shopClipImmutablePlan(p, q) == nil {
		t.Fatal("source mutation accepted")
	}
}

func TestShopClipDurableQueueCancellationAndReferences(t *testing.T) {
	s, db := newTimelineTaskTestService(t)
	s.activeCancels = map[string]context.CancelFunc{}
	data, _ := json.Marshal(ShopClipPlan{Version: 1, TemplateVersion: 1, SourceResourceID: "source", TemplateID: "clean"})
	p := &model.ShopClipProject{ID: "clip-1", UserID: "user-1", RequestKey: "request-1", Mode: "subtitle", Status: "analyzing", PlanJSON: string(data), TaskID: "clip-task"}
	if err := s.repo.CreateShopClip(p, []string{"source"}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(newShopClipTask(p, model.TaskTypeShopClipAnalysis)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.repo.ShopClip("user-2", p.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-user read: %v", err)
	}
	claimed, err := s.repo.ClaimNextTask("worker-1", time.Minute)
	if err != nil || claimed == nil || claimed.Type != model.TaskTypeShopClipAnalysis {
		t.Fatalf("task not claimable: %+v %v", claimed, err)
	}
	if err := s.repo.ShopClipCheckpoint(claimed, p.ID, "asr_running", string(data)); err != nil {
		t.Fatal(err)
	}
	stale := *claimed
	if err := db.Model(&model.Task{}).Where("id = ?", claimed.ID).Update("lease_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	claimed, err = s.repo.ClaimNextTask("worker-after-restart", time.Minute)
	if err != nil || claimed == nil || claimed.Attempts != 2 {
		t.Fatalf("lease recovery: %+v %v", claimed, err)
	}
	if err := s.repo.ShopClipCheckpoint(&stale, p.ID, "asr_done", string(data)); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("stale lease updated plan: %v", err)
	}
	cancelled := false
	s.activeCancels[claimed.ID] = func() { cancelled = true }
	v, err := s.CancelShopClip(context.Background(), "user-1", p.ID)
	if err != nil || v.Status != "cancelled" || !cancelled {
		t.Fatalf("cancel: %+v %v called=%v", v, err, cancelled)
	}
	if err := s.repo.ShopClipCheckpoint(claimed, p.ID, "asr_done", string(data)); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("stale worker checkpoint: %v", err)
	}
	claimed.Status = model.TaskStatusSucceeded
	now := time.Now()
	claimed.CompletedAt = &now
	if err := s.repo.SaveTaskCompletion(claimed, model.TaskStatusRunning, nil); err == nil {
		t.Fatal("cancelled worker wrote success")
	}
	refs, err := s.repo.ShopClipResourceReferences("user-1", []string{"source"})
	if err != nil || len(refs) != 1 {
		t.Fatalf("missing resource protection: %+v %v", refs, err)
	}
	refs, err = s.repo.ShopClipResourceReferences("user-2", []string{"source"})
	if err != nil || len(refs) != 0 {
		t.Fatal("cross-user reference exposed")
	}
}

func TestShopClipPlanCASPreventsTwoEditors(t *testing.T) {
	s, _ := newTimelineTaskTestService(t)
	p := &model.ShopClipProject{ID: "clip-edit", UserID: "user", RequestKey: "edit-key", Status: "ready", TaskID: "task", PlanJSON: `{"version":1}`}
	if err := s.repo.CreateShopClip(p, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.repo.UpdateShopClipPlan("user", p.ID, "task", p.PlanJSON, `{"version":2}`, "first"); err != nil {
		t.Fatal(err)
	}
	if err := s.repo.UpdateShopClipPlan("user", p.ID, "task", p.PlanJSON, `{"version":2}`, "stale"); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("stale edit overwrote newer plan: %v", err)
	}
}

func TestShopClipAttemptKeysRemainReservedAfterNewAttempt(t *testing.T) {
	s, _ := newTimelineTaskTestService(t)
	for _, key := range []string{"attempt-A", "attempt-B"} {
		if err := s.repo.Create(&model.ShopClipAttempt{UserID: "user", ProjectID: "project", Key: key, Hash: key + "-hash", TaskID: key + "-task"}); err != nil {
			t.Fatal(err)
		}
	}
	old, err := s.repo.ShopClipAttempt("user", "project", "attempt-A")
	if err != nil || old.Hash != "attempt-A-hash" {
		t.Fatalf("old attempt forgotten: %+v %v", old, err)
	}
	if err := s.repo.Create(&model.ShopClipAttempt{UserID: "user", ProjectID: "project", Key: "attempt-A", Hash: "different", TaskID: "third-task"}); err == nil {
		t.Fatal("historical attempt key was reused")
	}
	if _, err := s.repo.ShopClipAttempt("other-user", "project", "attempt-A"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("attempt leaked across users")
	}
}
