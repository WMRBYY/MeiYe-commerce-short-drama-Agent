package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/protocol"
)

func TestDramaRecoversSavedVideoWithoutNewGeneration(t *testing.T) {
	svc, fake := newDramaTestService(t)
	svc.dataDir = t.TempDir()
	projectID := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, projectID, 14)
	episodes, err := svc.repo.DramaEpisodes(projectID)
	if err != nil {
		t.Fatal(err)
	}
	jobs, err := svc.repo.RecentDramaSegmentJobs(projectID, episodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	var job model.DramaJob
	for _, j := range jobs {
		if j.Kind == model.DramaJobSegmentVideo && j.TaskID != "" {
			job = j
			break
		}
	}
	if job.ID == "" {
		t.Fatal("missing video job")
	}
	task, err := svc.repo.Task(job.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	result := task.ResultJSON
	checkpoint := mediaCheckpoint{Mode: "video", StartedAt: time.Now(), Items: []mediaCheckpointItem{{Reference: protocol.MediaReference{URL: "https://example.test/video"}}}}
	raw, _ := json.Marshal(checkpoint)
	encrypted, err := svc.encryptSettingSecret(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusFailed, "media_recovery_json": encrypted, "media_stage": "download", "error": "download failed"}).Error; err != nil {
		t.Fatal(err)
	}
	attempts, _ := json.Marshal([]DramaJobAttempt{{TaskID: task.ID, Status: string(model.TaskStatusFailed)}})
	if err := fake.db.Model(&model.DramaJob{}).Where("id = ?", job.ID).Updates(map[string]any{"status": model.DramaJobFailed, "attempts_json": string(attempts)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Model(&model.DramaSegment{}).Where("id = ?", job.ShotID).Updates(map[string]any{"video_status": model.DramaMediaFailed, "video_resource_id": "", "tail_frame_resource_id": ""}).Error; err != nil {
		t.Fatal(err)
	}
	segment, err := svc.repo.DramaSegment(projectID, job.ShotID)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", projectID, episodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	shown := false
	for _, s := range detail.Segments {
		if s.ID == segment.ID {
			shown = s.VideoReprocessable
		}
	}
	if !shown {
		t.Fatal("existing output must be recoverable in episode detail")
	}
	count := fake.byKind["video"]
	if _, err := svc.ReprocessDramaSegmentVideo("usr-drama", projectID, episodes[0].ID, segment.SegmentIndex); err != nil {
		t.Fatal(err)
	}
	task, _ = svc.repo.Task(task.ID)
	if task.Status != model.TaskStatusQueued {
		t.Fatalf("task not requeued: %s", task.Status)
	}
	jobPtr, _ := svc.repo.DramaJob(projectID, job.ID)
	if jobPtr.Status != model.DramaJobRunning || jobPtr.TaskID != task.ID {
		t.Fatal("job did not resume original task")
	}
	if err := fake.db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": result}).Error; err != nil {
		t.Fatal(err)
	}
	prod, _ := svc.repo.DramaProduction(projectID)
	project, _ := svc.repo.ProjectForUser("usr-drama", projectID)
	run := &dramaRun{s: svc, production: prod, project: project}
	if err := run.syncRunningJob(jobPtr); err != nil {
		t.Fatal(err)
	}
	segment, _ = svc.repo.DramaSegment(projectID, job.ShotID)
	if segment.VideoStatus != model.DramaMediaReady || segment.VideoResourceID == "" || segment.TailFrameResourceID == "" {
		t.Fatalf("recovered segment: %+v", segment)
	}
	if fake.byKind["video"] != count {
		t.Fatal("recovery submitted another video")
	}
}

func TestVideoRecoveryLimitAndSizeMessage(t *testing.T) {
	if got := platform.DefaultRuntimePolicy().Resource.GeneratedFileMB; got != 512 {
		t.Fatalf("limit=%d", got)
	}
	e := &mediaRecoveryError{stage: "download", cause: errTaskMediaTooLarge}
	if !strings.Contains(e.Error(), "大小限制") {
		t.Fatal(e.Error())
	}
}
