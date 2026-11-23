package app

import (
	"time"

	"yingce/backend/internal/storage"
)

const thumbnailRetryLimit = 2048

type thumbnailRetry struct {
	attempts int
	after    time.Time
}

func (s *Service) localThumbnailQueue() *thumbnailQueue {
	q := &s.thumbnails
	q.once.Do(func() {
		q.jobs = make(chan thumbnailJob, thumbnailQueueSize)
		q.inflight = make(map[string]chan struct{})
		q.retries = make(map[string]thumbnailRetry)
		for range thumbnailWorkers {
			go s.runThumbnailWorker(q)
		}
	})
	return q
}

// Both upload jobs and first-view requests reserve the same resource, so only
// one origin read can run at a time. A fresh upload can repair an earlier error.
func (q *thumbnailQueue) begin(id string, freshSource bool, now time.Time) (<-chan struct{}, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if done := q.inflight[id]; done != nil {
		return done, false
	}
	if !freshSource && now.Before(q.retries[id].after) {
		return nil, false
	}
	done := make(chan struct{})
	q.inflight[id] = done
	return done, true
}

func (q *thumbnailQueue) finish(id string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if done := q.inflight[id]; done != nil {
		delete(q.inflight, id)
		close(done)
	}
}

func (q *thumbnailQueue) sourceSucceeded(id string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	delete(q.retries, id)
}

func (q *thumbnailQueue) sourceFailed(id string, err error, now time.Time) {
	q.mu.Lock()
	defer q.mu.Unlock()
	retry := q.retries[id]
	retry.attempts = min(retry.attempts+1, 5)
	delay := time.Minute * time.Duration(1<<(retry.attempts-1))
	failure := storage.ClassifyError(err)
	if failure.StatusCode == 403 || failure.StatusCode == 404 {
		delay = max(delay, 5*time.Minute)
	}
	retry.after = now.Add(min(delay, 15*time.Minute))
	if len(q.retries) >= thumbnailRetryLimit {
		// Keep the failure cache bounded without permanently disabling old images.
		oldestID := ""
		var oldest time.Time
		for key, state := range q.retries {
			if oldestID == "" || state.after.Before(oldest) {
				oldestID, oldest = key, state.after
			}
		}
		delete(q.retries, oldestID)
	}
	q.retries[id] = retry
}
