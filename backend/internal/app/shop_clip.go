package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/cliprender"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func shopClipView(p *model.ShopClipProject) *ShopClipView {
	v := &ShopClipView{ShopClipProject: *p}
	_ = json.Unmarshal([]byte(p.PlanJSON), &v.Plan)
	if v.Plan.Materials == nil {
		v.Plan.Materials = []string{}
	}
	if v.Plan.Transcript == nil {
		v.Plan.Transcript = []ShopClipCue{}
	}
	if v.Plan.Placements == nil {
		v.Plan.Placements = []ShopClipPlacement{}
	}
	v.RetryStage = "render"
	if shopClipNeedsAnalysis(p.Mode, v.Plan) {
		v.RetryStage = "analyze"
	}
	return v
}

func (s *Service) ShopClipCapabilities(userID string) ShopClipCapabilities {
	out := ShopClipCapabilities{Modes: map[string]ShopClipCapability{}, RenderModes: map[string]ShopClipCapability{}, AutoModes: map[string]ShopClipCapability{}, Templates: shopClipTemplates()}
	for _, mode := range []string{"koubo", "mix", "subtitle", "behind"} {
		err := s.RequireFeature(FeatureEcommerce)
		if err == nil {
			err = shopClipRenderCapability(mode)
		}
		render := ShopClipCapability{Enabled: err == nil}
		if err != nil {
			render.Reason = err.Error()
		}
		out.RenderModes[mode] = render
		if err == nil {
			err = s.shopClipAnalysisCapability(userID, mode)
		}
		item := ShopClipCapability{Enabled: err == nil}
		if err != nil {
			item.Reason = err.Error()
		}
		out.Modes[mode] = item
		if err == nil && mode != "behind" {
			_, _, err = s.shopClipMatchingConfig(userID, 1)
		}
		auto := ShopClipCapability{Enabled: err == nil}
		if err != nil {
			auto.Reason = err.Error()
		}
		out.AutoModes[mode] = auto
	}
	return out
}

func (s *Service) shopClipCapability(userID, mode string) error {
	if strings.TrimSpace(userID) == "" {
		return BadAuthRequest("请先登录")
	}
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return err
	}
	switch mode {
	case "koubo", "mix", "subtitle", "behind":
	default:
		return BadAuthRequest("不支持的剪辑模式")
	}
	if err := shopClipRenderCapability(mode); err != nil {
		return err
	}
	return s.shopClipAnalysisCapability(userID, mode)
}

func (s *Service) shopClipAnalysisCapability(userID, mode string) error {
	if mode != "behind" {
		if transcribe, reason := s.shopClipTranscriberFor(userID); transcribe == nil {
			return BadAuthRequest(reason)
		}
	}
	if mode == "mix" {
		if _, err := s.shopClipTextConfig(userID); err != nil {
			return err
		}
	}
	return nil
}

func shopClipRequestHash(req ShopClipCreateRequest) string {
	req.IdempotencyKey = ""
	data, _ := json.Marshal(req)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func validateShopClipKey(key string) error {
	if len(key) < 8 || len(key) > 128 || strings.TrimSpace(key) != key {
		return BadAuthRequest("提交标识无效，请刷新后重试")
	}
	return nil
}

func (s *Service) CreateShopClip(ctx context.Context, userID string, req ShopClipCreateRequest) (*ShopClipView, error) {
	if s.IsDraining() || agentHandoffGateClosed() {
		return nil, BadAuthRequest("服务正在维护，请稍后重试")
	}
	if err := validateShopClipKey(req.IdempotencyKey); err != nil {
		return nil, err
	}
	hash := shopClipRequestHash(req)
	if old, err := s.repo.ShopClipByRequest(userID, req.IdempotencyKey); err == nil {
		if old.RequestHash != hash {
			return nil, BadAuthRequest("同一提交标识不能用于不同素材或参数")
		}
		return s.ShopClip(userID, old.ID)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := s.shopClipCapability(userID, req.Mode); err != nil {
		return nil, err
	}
	if req.AutoRender && req.Mode != "behind" {
		if _, _, err := s.shopClipMatchingConfig(userID, 1); err != nil {
			return nil, err
		}
	}
	if req.Mode == "mix" {
		if _, _, err := s.shopClipMatchingConfig(userID, len(req.MaterialResourceIDs)); err != nil {
			return nil, err
		}
	}
	plan, err := shopClipCreatePlan(req)
	if err != nil {
		return nil, err
	}
	if req.ProjectID != "" {
		return nil, BadAuthRequest("新建剪辑不能指定已有项目")
	}
	plan.Credits, err = s.ShopClipPrice()
	if err != nil {
		return nil, err
	}
	plan.PricingVersion = 1
	if err := validateShopClipPrice(req.ExpectedCredits, plan.Credits); err != nil {
		return nil, err
	}
	assets, cleanup, err := s.inspectShopClipAssets(ctx, userID, plan)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		return nil, err
	}
	source := assets[plan.SourceResourceID]
	plan.Width, plan.Height, plan.DurationMs = source.width, source.height, source.duration
	plan.SourceDurationMs = source.originalDuration
	if req.Mode != "behind" && !source.audio {
		return nil, BadAuthRequest("口播视频没有可识别的音轨")
	}
	if err := validateShopClipPlan(req.Mode, plan, assets, false); err != nil {
		return nil, err
	}
	data, _ := json.Marshal(plan)
	p := &model.ShopClipProject{ID: newID(), UserID: userID, RequestKey: req.IdempotencyKey, RequestHash: hash, Mode: req.Mode, Title: plan.Title, Status: "analyzing", Stage: "等待素材分析", Progress: 1, PlanJSON: string(data), TaskID: newID(), AttemptKey: req.IdempotencyKey}
	task := newShopClipTask(p, model.TaskTypeShopClipAnalysis)
	order, err := shopClipBillingOrder(task, plan)
	if err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.CreateShopClip(p, shopClipResourceIDs(plan)); err != nil {
			return err
		}
		if err := tx.Create(&model.ShopClipAttempt{UserID: userID, ProjectID: p.ID, Key: req.IdempotencyKey, Hash: hash, TaskID: p.TaskID}); err != nil {
			return err
		}
		return createTaskWithStorageQuotaRepository(tx, task, order, policy)
	})
	s.storageMu.Unlock()
	if err != nil {
		if old, lookup := s.repo.ShopClipByRequest(userID, req.IdempotencyKey); lookup == nil && old.RequestHash == hash {
			return s.ShopClip(userID, old.ID)
		}
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return nil, BadAuthRequest("积分不足，请充值后再生成剪辑")
		}
		return nil, err
	}
	s.wakeTaskDispatcher()
	return shopClipView(p), nil
}

func newShopClipTask(p *model.ShopClipProject, kind string) *model.Task {
	data, _ := json.Marshal(map[string]string{"clipId": p.ID})
	return &model.Task{ID: p.TaskID, UserID: p.UserID, Type: kind, Status: model.TaskStatusQueued, Stage: p.Stage, Progress: 1, Provider: "local", Model: "shop-clip", InputJSON: string(data), Prompt: "电商视频剪辑", RequestID: p.ID}
}

func (s *Service) ShopClip(userID, id string) (*ShopClipView, error) {
	p, err := s.repo.ShopClip(userID, id)
	if err != nil {
		return nil, err
	}
	if p.Status == "analyzing" || p.Status == "rendering" {
		if task, e := s.repo.TaskForUser(userID, p.TaskID); e == nil {
			p.Progress, p.Stage = task.Progress, task.Stage
			if task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled {
				p.Status, p.Error = string(task.Status), task.Error
				if err := s.repo.UpdateShopClip(userID, id, p.TaskID, []string{"analyzing", "rendering"}, map[string]any{"status": p.Status, "error": p.Error, "stage": p.Stage, "progress": p.Progress}); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, err
				}
			}
		}
	}
	return shopClipView(p), nil
}

func (s *Service) ShopClips(userID string) ([]ShopClipView, error) {
	rows, err := s.repo.ShopClips(userID)
	if err != nil {
		return nil, err
	}
	out := make([]ShopClipView, 0, len(rows))
	for _, p := range rows {
		v, err := s.ShopClip(userID, p.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, nil
}

func (s *Service) UpdateShopClipPlan(ctx context.Context, userID, id string, plan ShopClipPlan) (*ShopClipView, error) {
	v, err := s.ShopClip(userID, id)
	if err != nil {
		return nil, err
	}
	if v.Status != "ready" {
		return nil, BadAuthRequest("当前状态不能修改剪辑方案")
	}
	if err := shopClipImmutablePlan(v.Plan, plan); err != nil {
		return nil, err
	}
	assets, cleanup, err := s.inspectShopClipAssets(ctx, userID, plan)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		return nil, err
	}
	if err := validateShopClipPlan(v.Mode, plan, assets, false); err != nil {
		return nil, err
	}
	plan.Version++
	data, _ := json.Marshal(plan)
	if err := s.repo.UpdateShopClipPlan(userID, id, v.TaskID, v.PlanJSON, string(data), plan.Title); err != nil {
		return nil, err
	}
	return s.ShopClip(userID, id)
}

func shopClipImmutablePlan(old, next ShopClipPlan) error {
	if old.PricingVersion != next.PricingVersion || old.Credits != next.Credits {
		return BadAuthRequest("不能修改剪辑价格快照")
	}
	if strings.TrimSpace(old.Title) != "" && strings.TrimSpace(next.Title) == "" {
		return BadAuthRequest("请保留成片标题")
	}
	if old.Version != next.Version || old.TemplateVersion != next.TemplateVersion {
		return BadAuthRequest("剪辑方案已更新，请刷新后重新修改")
	}
	if old.SourceResourceID != next.SourceResourceID || !reflect.DeepEqual(old.Materials, next.Materials) || old.Width != next.Width || old.Height != next.Height || old.DurationMs != next.DurationMs || old.SourceDurationMs != next.SourceDurationMs || old.TrimStartMs != next.TrimStartMs || old.TrimEndMs != next.TrimEndMs {
		return BadAuthRequest("不能修改原始素材和媒体规格，请新建剪辑")
	}
	if old.MusicResourceID != next.MusicResourceID {
		return BadAuthRequest("更换背景音乐请新建剪辑")
	}
	if old.AutoRender != next.AutoRender || old.ReferenceText != next.ReferenceText || !reflect.DeepEqual(old.Director, next.Director) {
		return BadAuthRequest("不能修改任务分析依据，请新建剪辑")
	}
	return nil
}

func (s *Service) StartShopClipAttempt(ctx context.Context, userID, id string, req ShopClipAttemptRequest, retry bool) (*ShopClipView, error) {
	if s.IsDraining() {
		return nil, BadAuthRequest("服务正在维护，请稍后重试")
	}
	if err := validateShopClipKey(req.IdempotencyKey); err != nil {
		return nil, err
	}
	v, err := s.ShopClip(userID, id)
	if err != nil {
		return nil, err
	}
	attemptData, _ := json.Marshal(req.Plan)
	attemptSum := sha256.Sum256(append(attemptData, []byte(fmt.Sprint(retry))...))
	attemptHash := hex.EncodeToString(attemptSum[:])
	if prior, err := s.repo.ShopClipAttempt(userID, id, req.IdempotencyKey); err == nil {
		if prior.Hash != attemptHash {
			return nil, BadAuthRequest("同一提交标识不能用于不同剪辑方案")
		}
		return v, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if v.AttemptKey == req.IdempotencyKey {
		if v.AttemptHash != attemptHash {
			return nil, BadAuthRequest("同一提交标识不能用于不同剪辑方案")
		}
		return v, nil
	}
	if retry {
		if v.Status != "failed" && v.Status != "cancelled" {
			return nil, BadAuthRequest("只有失败或取消的任务可以重试")
		}
	} else if v.Status != "ready" {
		return nil, BadAuthRequest("请先完成素材分析并校对方案")
	}
	plan := v.Plan
	if plan.PricingVersion > 0 && agentHandoffGateClosed() {
		return nil, BadAuthRequest("剪辑服务正在完成发布，请稍后重试")
	}
	if plan.PricingVersion > 0 {
		if err := validateShopClipPrice(req.ExpectedCredits, plan.Credits); err != nil {
			return nil, err
		}
	}
	if req.Plan != nil {
		if err := shopClipImmutablePlan(plan, *req.Plan); err != nil {
			return nil, err
		}
		plan = *req.Plan
	}
	assets, cleanup, err := s.inspectShopClipAssets(ctx, userID, plan)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		return nil, err
	}
	kind, status := model.TaskTypeShopClipRender, "rendering"
	if retry && shopClipNeedsAnalysis(v.Mode, plan) {
		kind, status = model.TaskTypeShopClipAnalysis, "analyzing"
	}
	if kind == model.TaskTypeShopClipAnalysis {
		if err := s.shopClipCapability(userID, v.Mode); err != nil {
			return nil, err
		}
	} else {
		if err := s.RequireFeature(FeatureEcommerce); err != nil {
			return nil, err
		}
		if err := shopClipRenderCapability(v.Mode); err != nil {
			return nil, err
		}
	}
	if err := validateShopClipPlan(v.Mode, plan, assets, kind == model.TaskTypeShopClipRender); err != nil {
		return nil, err
	}
	data, _ := json.Marshal(plan)
	p := v.ShopClipProject
	p.TaskID, p.Status, p.Stage, p.Progress, p.AttemptKey, p.PlanJSON = newID(), status, "等待队列调度", 1, req.IdempotencyKey, string(data)
	task := newShopClipTask(&p, kind)
	order, err := shopClipBillingOrder(task, plan)
	if err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.AssertShopClipPlan(userID, id, v.TaskID, v.PlanJSON); err != nil {
			return err
		}
		if retry {
			if err := shopClipRetryBillingReleased(tx, userID, v.TaskID); err != nil {
				return err
			}
		}
		if err := tx.Create(&model.ShopClipAttempt{UserID: userID, ProjectID: id, Key: req.IdempotencyKey, Hash: attemptHash, TaskID: p.TaskID}); err != nil {
			return err
		}
		if err := tx.UpdateShopClip(userID, id, v.TaskID, []string{v.Status}, map[string]any{"task_id": p.TaskID, "status": status, "stage": p.Stage, "progress": 1, "error": "", "attempt_key": req.IdempotencyKey, "attempt_hash": attemptHash, "plan_json": string(data), "title": plan.Title}); err != nil {
			return err
		}
		return createTaskWithStorageQuotaRepository(tx, task, order, policy)
	})
	s.storageMu.Unlock()
	if err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return nil, BadAuthRequest("积分不足，请充值后再生成剪辑")
		}
		return nil, err
	}
	s.wakeTaskDispatcher()
	return s.ShopClip(userID, id)
}

func (s *Service) CancelShopClip(ctx context.Context, userID, id string) (*ShopClipView, error) {
	v, err := s.ShopClip(userID, id)
	if err != nil {
		return nil, err
	}
	if v.Status != "analyzing" && v.Status != "rendering" {
		return v, nil
	}
	// Local clip tasks can be cancelled even while their registered worker is in a subprocess.
	task, err := s.repo.TaskForUser(userID, v.TaskID)
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusQueued && task.Status != model.TaskStatusRunning {
		return s.ShopClip(userID, id)
	}
	changed := false
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		var err error
		changed, err = tx.CancelTaskIfStatus(userID, task.ID, task.Status, time.Now())
		if err == nil && !changed && task.Status == model.TaskStatusQueued {
			changed, err = tx.CancelTaskIfStatus(userID, task.ID, model.TaskStatusRunning, time.Now())
		}
		if err != nil || !changed {
			return err
		}
		if task.BillingOrderID != "" {
			if err := tx.RefundBillingOrder(task.BillingOrderID, "剪辑已取消，积分退还"); err != nil {
				return err
			}
		}
		return tx.UpdateShopClip(userID, id, v.TaskID, []string{"analyzing", "rendering"}, map[string]any{"status": "cancelled", "stage": "已取消"})
	})
	if err != nil {
		return nil, err
	}
	if changed {
		s.cancelActiveTask(task.ID)
	}
	return s.ShopClip(userID, id)
}

type shopClipAsset struct {
	path             string
	width, height    int
	duration         int64
	originalDuration int64
	audio            bool
}

// Every referenced file is decoded/probed before any model request is allowed.
func (s *Service) inspectShopClipAssets(ctx context.Context, userID string, plan ShopClipPlan) (map[string]shopClipAsset, func(), error) {
	if plan.SourceResourceID == "" || len(plan.Materials) > 8 {
		return nil, nil, BadAuthRequest("请上传一个口播视频，辅助素材最多 8 个")
	}
	dir, err := os.MkdirTemp("", "yingce-clip-inspect-")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	out := map[string]shopClipAsset{}
	for _, id := range shopClipResourceIDs(plan) {
		if _, exists := out[id]; id == "" || exists {
			cleanup()
			return nil, nil, BadAuthRequest("素材引用为空或重复")
		}
		res, reader, err := s.OpenResource(userID, id)
		if err != nil || reader == nil {
			cleanup()
			return nil, nil, BadAuthRequest("素材不可读取：" + id)
		}
		expectedMime := "video/"
		if id == plan.MusicResourceID {
			expectedMime = "audio/"
		}
		if res == nil || res.Status != model.ResourceStatusReady || !strings.HasPrefix(res.MimeType, expectedMime) || res.Size > 512<<20 {
			reader.Close()
			cleanup()
			return nil, nil, BadAuthRequest("素材需为上传完成且不超过 512 MB 的视频：" + id)
		}
		path := filepath.Join(dir, fmt.Sprintf("%d%s", len(out), extForMime(res.MimeType)))
		stop := context.AfterFunc(ctx, func() { _ = reader.Close() })
		file, err := os.Create(path)
		if err != nil {
			stop()
			reader.Close()
			cleanup()
			return nil, nil, err
		}
		n, copyErr := io.Copy(file, io.LimitReader(reader, (512<<20)+1))
		stop()
		closeErr := file.Close()
		reader.Close()
		if copyErr != nil || closeErr != nil || n == 0 || n > 512<<20 {
			cleanup()
			return nil, nil, BadAuthRequest("素材文件读取失败或过大：" + id)
		}
		probe, err := probeMediaFile(ctx, path)
		if err != nil || (id != plan.MusicResourceID && (probe.Width <= 0 || probe.Height <= 0)) || probe.DurationMs <= 0 || probe.DurationMs > 300000 {
			cleanup()
			return nil, nil, BadAuthRequest("素材无法解析，或时长超过 5 分钟：" + id)
		}
		audio, err := probeHasAudioStream(ctx, path)
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		if id == plan.MusicResourceID && !audio {
			cleanup()
			return nil, nil, BadAuthRequest("背景音乐没有可读取音轨")
		}
		asset := shopClipAsset{path: path, width: probe.Width, height: probe.Height, duration: probe.DurationMs, originalDuration: probe.DurationMs, audio: audio}
		if id == plan.SourceResourceID {
			end, err := shopClipTrimEnd(plan.TrimStartMs, plan.TrimEndMs, probe.DurationMs)
			if err != nil {
				cleanup()
				return nil, nil, err
			}
			if plan.TrimStartMs != 0 || end != probe.DurationMs {
				ffmpeg, err := renderFfmpegBinary()
				if err != nil {
					cleanup()
					return nil, nil, err
				}
				asset.path, err = cliprender.Trim(ctx, ffmpeg, dir, path, plan.TrimStartMs, end)
				if err != nil {
					cleanup()
					return nil, nil, err
				}
				trimmed, err := probeMediaFile(ctx, asset.path)
				if err != nil || trimmed.Width <= 0 || trimmed.Height <= 0 || math.Abs(float64(trimmed.DurationMs-(end-plan.TrimStartMs))) > 100 {
					cleanup()
					return nil, nil, BadAuthRequest("剪辑范围处理失败，请调整范围后重试")
				}
				asset.width, asset.height, asset.duration = trimmed.Width, trimmed.Height, trimmed.DurationMs
			}
		}
		out[id] = asset
	}
	return out, cleanup, nil
}

func validateShopClipPlan(mode string, p ShopClipPlan, assets map[string]shopClipAsset, ready bool) error {
	if math.IsNaN(p.MusicVolume) || math.IsInf(p.MusicVolume, 0) || p.MusicVolume < 0 || p.MusicVolume > 0.5 {
		return BadAuthRequest("背景音乐音量须在 0 至 50% 之间")
	}
	if err := validateShopClipVisual(p.TemplateID, p.Visual, mode); err != nil {
		return BadAuthRequest(err.Error())
	}
	if utf8.RuneCountInString(p.Title) > 100 || utf8.RuneCountInString(p.BehindText) > 20 {
		return BadAuthRequest("成片标题最多 100 字，人后文字最多 20 字")
	}
	if utf8.RuneCountInString(p.ReferenceText) > 5000 {
		return BadAuthRequest("参考字幕最多 5000 字")
	}
	if mode == "mix" && len(p.Materials) == 0 {
		return BadAuthRequest("智能混剪至少需要一个辅助视频素材")
	}
	if mode != "mix" && len(p.Materials) > 0 {
		return BadAuthRequest("此模式不接受辅助素材")
	}
	if mode == "behind" {
		if strings.TrimSpace(p.BehindText) == "" {
			return BadAuthRequest("请输入要放在人物后方的文字")
		}
		b := p.SubjectBox
		for _, v := range b {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return BadAuthRequest("人物框选坐标无效")
			}
		}
		if len(b) != 4 || b[0] < 0 || b[1] < 0 || b[2] <= 0 || b[3] <= 0 || b[0]+b[2] > 1 || b[1]+b[3] > 1 {
			return BadAuthRequest("请在首帧框选人物")
		}
		if p.BehindPosition != "top" && p.BehindPosition != "center" && p.BehindPosition != "bottom" {
			return BadAuthRequest("请选择文字位置")
		}
	}
	if len(p.Transcript) > 1000 || len(p.Placements) > 200 {
		return BadAuthRequest("剪辑方案片段过多")
	}
	end := int64(0)
	for _, cue := range p.Transcript {
		if cue.StartMs < end || cue.EndMs <= cue.StartMs || cue.EndMs > p.DurationMs || strings.TrimSpace(cue.Text) == "" || utf8.RuneCountInString(cue.Text) > 80 {
			return BadAuthRequest("字幕时间或文本无效；单条最多 80 字，请检查断句")
		}
		end = cue.EndMs
	}
	end = 0
	allowed := map[string]bool{}
	for _, id := range p.Materials {
		allowed[id] = true
	}
	for _, place := range p.Placements {
		asset, ok := assets[place.ResourceID]
		if !ok || !allowed[place.ResourceID] || place.StartMs < end || place.EndMs <= place.StartMs || place.EndMs > p.DurationMs || place.SourceStartMs < 0 || place.SourceStartMs > asset.duration || place.EndMs-place.StartMs > asset.duration-place.SourceStartMs {
			return BadAuthRequest("混剪片段引用或时间范围无效")
		}
		end = place.EndMs
	}
	if ready && mode != "behind" && len(p.Transcript) == 0 {
		return BadAuthRequest("未识别到口播，不能生成字幕成片")
	}
	if ready && mode == "mix" && len(p.Placements) == 0 {
		return BadAuthRequest("没有匹配到可用素材，请调整素材后重试")
	}
	return nil
}

func shopClipResourceIDs(plan ShopClipPlan) []string {
	ids := append([]string{plan.SourceResourceID}, plan.Materials...)
	if plan.MusicResourceID != "" {
		ids = append(ids, plan.MusicResourceID)
	}
	return ids
}
