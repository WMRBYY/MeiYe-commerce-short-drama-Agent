package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

func TestThumbnailConcurrentOriginReservation(t *testing.T) {
	s := &Service{}
	q := s.localThumbnailQueue()
	var starts atomic.Int32
	var wg sync.WaitGroup
	for range 64 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, started := q.begin("same-image", false, time.Now()); started {
				starts.Add(1)
			}
		}()
	}
	wg.Wait()
	if starts.Load() != 1 {
		t.Fatalf("concurrent origin reads: %d", starts.Load())
	}
	done, started := q.begin("same-image", false, time.Now())
	if started || done == nil {
		t.Fatal("waiter did not join in-flight read")
	}
	q.finish("same-image")
	select {
	case <-done:
	default:
		t.Fatal("waiter still blocked")
	}
}

func TestThumbnailFailedSourceBackoffAndRecovery(t *testing.T) {
	svc, db := newMediaRecoveryTestService(t)
	r := model.Resource{ID: newID(), UserID: "retry-owner", Kind: "image", Provider: "local", Status: model.ResourceStatusReady, MimeType: "image/png", ObjectKey: "recover.png", Size: 100, CreatedAt: time.Now()}
	if err := db.Create(&r).Error; err != nil {
		t.Fatal(err)
	}
	svc.ensureResourceThumbnail(&r)
	state := svc.thumbnails.retries[r.ID]
	if state.attempts != 1 || !state.after.After(time.Now()) {
		t.Fatal("failed read was not delayed")
	}
	if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", r.ObjectKey), mediaTestPNG(t), 0600); err != nil {
		t.Fatal(err)
	}
	svc.ensureResourceThumbnail(&r)
	if r.ThumbnailStatus == model.ThumbnailStatusReady || svc.thumbnails.retries[r.ID].attempts != 1 {
		t.Fatal("refresh bypassed failure cooldown")
	}
	state.after = time.Now().Add(-time.Second)
	svc.thumbnails.retries[r.ID] = state
	svc.ensureResourceThumbnail(&r)
	if r.ThumbnailStatus != model.ThumbnailStatusReady {
		t.Fatal("resource did not recover after cooldown")
	}
	if _, exists := svc.thumbnails.retries[r.ID]; exists {
		t.Fatal("success did not clear failure history")
	}
}

func TestThumbnailBackoffBoundAndFreshSource(t *testing.T) {
	s := &Service{}
	q := s.localThumbnailQueue()
	now := time.Now()
	for range 20 {
		q.sourceFailed("denied", &storage.HTTPStatusError{StatusCode: 403}, now)
	}
	state := q.retries["denied"]
	if delay := state.after.Sub(now); delay > 15*time.Minute || delay < 5*time.Minute {
		t.Fatalf("invalid cooldown: %v", delay)
	}
	if done, started := q.begin("denied", false, now); started || done != nil {
		t.Fatal("failure was retried during cooldown")
	}
	if _, started := q.begin("denied", true, now); !started {
		t.Fatal("fresh uploaded bytes cannot repair failure")
	}
	q.finish("denied")
	for i := 0; i < thumbnailRetryLimit+5; i++ {
		q.sourceFailed(fmt.Sprint(i), errors.New("offline"), now)
	}
	if len(q.retries) > thumbnailRetryLimit {
		t.Fatal("unbounded failure cache")
	}
}
