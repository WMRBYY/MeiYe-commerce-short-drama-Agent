package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaSettingsWakeSchedulerAfterSaving(t *testing.T) {
	svc, _ := newDramaTestService(t)
	summary := createTestDrama(t, svc, DramaReviewAuto)
	for {
		select {
		case <-dramaWakeChannel():
		default:
			goto drained
		}
	}
drained:
	budget := int64(123_000_000)
	if _, err := svc.UpdateDramaSettings("usr-drama", summary.Project.ID, UpdateDramaSettingsRequest{BudgetMicrocredits: &budget}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-dramaWakeChannel():
	default:
		t.Fatal("saved settings must wake the scheduler without waiting for the periodic scan")
	}
	stored, err := svc.repo.DramaProduction(summary.Project.ID)
	if err != nil || stored.BudgetMicrocredits != budget {
		t.Fatalf("saved budget=%+v err=%v", stored, err)
	}
}

func TestDramaEpisodeExposesPreparationProgressForOwner(t *testing.T) {
	svc, _ := newDramaTestService(t)
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{
		Name: "即时进度", Start: true,
		Settings: DramaSettings{EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1, Models: fakeDramaModels, MediaMode: DramaMediaManual},
		Chapters: []DramaChapterInput{{Title: "第一章", Text: "少年走入大厅。"}},
	})
	if err != nil || len(summary.Episodes) != 1 {
		t.Fatalf("create=%+v err=%v", summary, err)
	}
	runDramaTicks(t, svc, summary.Project.ID, 1)
	episodeID := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", summary.Project.ID, episodeID)
	if err != nil || detail.PreparationJob == nil || detail.PreparationJob.Kind != model.DramaJobBible || detail.PreparationJob.TaskID == "" {
		t.Fatalf("missing preparation task: %+v err=%v", detail.PreparationJob, err)
	}
	if _, err := svc.DramaEpisodeDetail("other-user", summary.Project.ID, episodeID); err == nil {
		t.Fatal("another user must not read task progress")
	}
}
