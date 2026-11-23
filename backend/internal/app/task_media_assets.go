package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// A deleted canvas/project must not be resurrected by an old download worker.
func (s *Service) mediaTaskProject(task *model.Task) (string, error) {
	id := task.ProjectID
	if id == "" {
		return "", nil
	}
	viaCanvas := false
	canvas, err := s.repo.CanvasProjectForUser(task.UserID, id)
	if err == nil {
		viaCanvas = true
		id = canvas.ProjectID
		if id == "" {
			return "", nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	project, err := s.repo.ProjectForUser(task.UserID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if !viaCanvas {
			// 电商任务的 project_id 是电商项目 ID（建任务时已按归属校验）。项目还在就照常交付，
			// 作品只进个人素材库，不挂到影视项目素材库；电商项目被删除时仍按项目不存在处理。
			if _, ecommerceErr := s.repo.EcommerceProject(task.UserID, id); ecommerceErr == nil {
				return "", nil
			} else if !errors.Is(ecommerceErr, gorm.ErrRecordNotFound) {
				return "", ecommerceErr
			}
		}
		return "", NotFound("任务所属画布或项目已不存在")
	}
	if err != nil {
		return "", err
	}
	if project.Status == model.ProjectStatusArchived {
		return "", BadAuthRequest("项目已归档，无法恢复作品")
	}
	return project.ID, nil
}

// AudioOutputDurationMs returns the measured duration of the first persisted
// audio output. A missing or unmeasured duration is returned as an error so
// per-second billing can enter review instead of silently undercharging.
func (s *Service) AudioOutputDurationMs(task model.Task) (int64, error) {
	if capabilityFromTaskType(task.Type) != "audio" {
		return 0, nil
	}
	var result map[string]any
	if json.Unmarshal([]byte(task.ResultJSON), &result) == nil {
		if audio, ok := result["audio"].(map[string]any); ok {
			if billed, ok := audio["billingDurationMs"].(float64); ok && billed > 0 && billed <= 120_000 {
				return int64(billed + 0.5), nil
			}
		}
	}
	resourceID, _ := taskOutputResource(task.ResultJSON, task.Type)
	if resourceID == "" {
		return 0, errors.New("音频结果缺少已保存的资源")
	}
	resource, err := s.repo.ResourceForUser(task.UserID, resourceID)
	if err != nil {
		return 0, err
	}
	if resource.DurationMs <= 0 {
		return 0, errors.New("音频结果缺少有效时长")
	}
	return resource.DurationMs, nil
}

func generationMediaAssetID(taskID string, index int) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("materialize:%s:%d", taskID, index)))
	return "generation_" + hex.EncodeToString(sum[:])
}

func registerTaskMediaAsset(repo *repository.Repository, task model.Task, resource *model.Resource, index, count int, mode, projectID string, policy RuntimePolicySetting) (string, error) {
	assetID := generationMediaAssetID(task.ID, index)
	if existing, err := repo.AssetForUser(task.UserID, assetID); err == nil {
		var payload struct {
			Data struct {
				StorageKey string `json:"storageKey"`
			} `json:"data"`
		}
		if json.Unmarshal([]byte(existing.PayloadJSON), &payload) != nil || payload.Data.StorageKey != "resource:"+resource.ID {
			return "", errors.New("生成素材与任务资源不匹配")
		}
		return assetID, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	now := time.Now()
	url := resourceFileURL(resource.ID)
	data := map[string]any{"storageKey": "resource:" + resource.ID, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs}
	if mode == "image" {
		data["dataUrl"] = url
	} else {
		data["url"] = url
	}
	title := generationMediaAssetTitle(task, mode, index, count)
	if title == "" {
		return "", errors.New("生成素材类型无效")
	}
	metadata := map[string]any{"source": "generation-task", "generationEffectKey": fmt.Sprintf("materialize:%s:%d", task.ID, index), "taskId": task.ID, "outputIndex": index}
	if projectID != "" {
		metadata["projectIds"] = []string{projectID}
	}
	payload, err := json.Marshal(map[string]any{"id": assetID, "kind": mode, "category": model.AssetCategoryMaterial, "status": model.AssetVersionStatusConfirmed, "source": "生成任务", "title": title, "coverUrl": url, "tags": []string{"生成"}, "createdAt": now.UTC().Format(time.RFC3339Nano), "updatedAt": now.UTC().Format(time.RFC3339Nano), "data": data, "metadata": metadata})
	if err != nil {
		return "", err
	}
	usage, err := repo.UserStorageUsage(task.UserID)
	if err != nil {
		return "", err
	}
	// The provider has already produced and the file is saved. Capacity for new
	// media is checked before task admission; concurrent accepted tasks must not
	// lose paid output merely because another task filled the final asset slot.
	if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", false, int64(len(payload)), policy.Resource); err != nil {
		return "", err
	}
	asset := &model.Asset{ID: assetID, UserID: task.UserID, Kind: mode, Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: title, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now}
	if err := repo.CreateAssetIfAbsent(asset); err != nil {
		return "", err
	}
	// Another worker may have won the insert. Verify its resource identity
	// instead of overwriting its metadata or assuming a duplicate is valid.
	stored, err := repo.AssetForUser(task.UserID, assetID)
	if err != nil {
		return "", err
	}
	var storedPayload struct {
		Data struct {
			StorageKey string `json:"storageKey"`
		} `json:"data"`
	}
	if json.Unmarshal([]byte(stored.PayloadJSON), &storedPayload) != nil || storedPayload.Data.StorageKey != "resource:"+resource.ID {
		return "", errors.New("生成素材与任务资源不匹配")
	}
	if projectID != "" {
		position, err := repo.NextProjectAssetPosition(projectID, "")
		if err != nil {
			return "", err
		}
		if _, err := repo.LinkProjectAsset(asset, nil, &model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: assetID, Position: position, CreatedAt: now}); err != nil {
			return "", err
		}
	}
	return assetID, nil
}

func generationMediaAssetTitle(task model.Task, kind string, index, count int) string {
	title := ""
	if context := taskClientContext(task.InputJSON); context != nil {
		title = context.AssetTitle
	}
	if title == "" {
		title = strings.Join(strings.Fields(task.Prompt), " ")
		if runes := []rune(title); len(runes) > 48 {
			title = string(runes[:48]) + "…"
		}
	}
	if title == "" {
		title = map[string]string{"text": "生成文本", "image": "生成图片", "video": "生成视频", "audio": "生成音频"}[kind] + " · " + task.ID[:min(len(task.ID), 8)]
	}
	if count > 1 {
		title += fmt.Sprintf(" · %d", index+1)
	}
	return title
}

// Uses the same effect key and ID as browser materialization, so reconnecting
// the canvas cannot create a second asset for a server-delivered output.
func (s *Service) registerRecoveredMediaAssets(task model.Task) error {
	projectID, err := s.mediaTaskProject(&task)
	if err != nil {
		return err
	}
	checkpoint, err := s.decodeMediaCheckpoint(&task)
	if err != nil {
		return err
	}
	representations, err := s.repo.AssetRepresentationsForTask(task.ID)
	if err != nil {
		return err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	for index, item := range checkpoint.Items {
		registered := false
		for _, representation := range representations {
			if representation.ResourceID == item.ResourceID && representation.AssetVersionID != "" {
				registered = true
				break
			}
		}
		if registered {
			continue
		}
		resource, err := s.repo.ResourceForUser(task.UserID, item.ResourceID)
		if err != nil {
			return err
		}
		if resource.Status != model.ResourceStatusReady {
			return errors.New("作品文件尚未保存完成")
		}
		if _, err := registerTaskMediaAsset(s.repo, task, resource, index, len(checkpoint.Items), checkpoint.Mode, projectID, policy); err != nil {
			return err
		}
	}
	return nil
}

// linkAssetToProject 把素材挂到项目素材库根目录末尾；链接已存在时 LinkProjectAsset 不做修改（幂等）。
func (s *Service) linkAssetToProject(asset *model.Asset, projectID string, now time.Time) error {
	position, err := s.repo.NextProjectAssetPosition(projectID, "")
	if err != nil {
		return err
	}
	_, err = s.repo.LinkProjectAsset(asset, nil, &model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: asset.ID, Position: position, CreatedAt: now})
	return err
}
