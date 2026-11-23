package app

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const cloudAgentOmniMode = "omni_auto"

// This grant is part of the immutable request fingerprint and durable checkpoint.
// A follow-up run must obtain a new grant; changing the picker never upgrades a run.
type CloudAgentOmniAuthorization struct {
	Version            int     `json:"version"`
	Confirmed          bool    `json:"confirmed"`
	MaxCredits         float64 `json:"maxCredits"`
	Scope              string  `json:"scope"`
	MaxGenerationTasks int     `json:"maxGenerationTasks"`
	MaxVideoSeconds    int     `json:"maxVideoSeconds"`
	EstimateHash       string  `json:"estimateHash"`
}

func validateCloudAgentOmniAuthorization(req CloudAgentRequest) error {
	if req.PermissionMode != cloudAgentOmniMode {
		if req.OmniAuthorization != nil {
			return BadAuthRequest("项目授权仅用于全能自动")
		}
		return nil
	}
	a := req.OmniAuthorization
	if req.CanvasID == "" || len(req.ContextScope) != 1 || req.ContextScope[0] != "canvas" {
		return BadAuthRequest("全能自动必须绑定已保存的自由画布")
	}
	if a == nil || a.Version != 1 || !a.Confirmed || a.Scope != "canvas_creation" || a.EstimateHash == "" ||
		a.MaxCredits != req.Budget.MaxCredits || a.MaxGenerationTasks != req.Budget.MaxGenerationTasks ||
		a.MaxVideoSeconds != req.Budget.MaxVideoSeconds {
		return BadAuthRequest("请先确认本项目积分上限和画布创作授权范围")
	}
	return nil
}

// Closed by default. Production can enable administrator acceptance separately
// from public rollout, only after the acceptance gates have passed.
func (s *Service) CloudAgentOmniAvailable(userID string) bool {
	rollout := os.Getenv("CANVAS_OMNI_AUTO_ROLLOUT")
	if rollout != "admin" && rollout != "all" {
		return false
	}
	user, err := s.repo.User(userID)
	return err == nil && (rollout == "all" || user.Role == model.UserRoleAdmin)
}

// Only the Skills the user enabled for this conversation may enter an omni run.
// The library is a permission check, never a source of additional run Skills.
func (s *Service) cloudAgentOmniSkillIDs(userID, prompt string, explicit []string) ([]string, error) {
	if len(explicit) == 0 {
		return nil, nil
	}
	if len(explicit) > 8 {
		return nil, BadAuthRequest("全能自动本轮最多启用 8 个技能")
	}
	installed, err := s.AddedSkills(userID)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]bool, len(installed))
	for _, item := range installed {
		if item.IsAdded {
			allowed[item.SkillID] = true
		}
	}
	type candidate struct {
		id    string
		score int
	}
	var ranked []candidate
	tokens := cloudAgentSkillSearchTokens(prompt)
	kind, _, _, _, _, _ := omniEstimateWork(prompt)
	seen := make(map[string]bool, len(explicit))
	for _, id := range explicit {
		if !allowed[id] || seen[id] {
			return nil, BadAuthRequest("全能自动只能使用本轮选中且已安装的技能")
		}
		seen[id] = true
		detail, err := s.SkillDetail(userID, id)
		if err != nil {
			return nil, err
		}
		if !detail.IsAdded || detail.Status != 1 {
			continue
		}
		score, _ := cloudAgentSkillMatch(cloudAgentSkill{Name: detail.SkillName, Description: detail.Description}, tokens)
		if score > 0 && cloudAgentOmniSkillFitsKind(kind, detail.SkillName) {
			ranked = append(ranked, candidate{id, score})
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score == ranked[j].score {
			return ranked[i].id < ranked[j].id
		}
		return ranked[i].score > ranked[j].score
	})
	ids := make([]string, 0, len(ranked))
	for _, item := range ranked {
		ids = append(ids, item.id)
	}
	return ids, nil
}

func cloudAgentOmniSkillFitsKind(kind, name string) bool {
	name = strings.ToLower(name)
	has := func(words ...string) bool {
		for _, word := range words {
			if strings.Contains(name, word) {
				return true
			}
		}
		return false
	}
	switch kind {
	case "图片与海报":
		return !has("短剧", "分镜", "视频", "电影", "一图成片", "电商", "详情", "商品", "模型路由", "音频", "配音", "音效", "音乐", "声音", "音色", "播客") &&
			has("图片", "图像", "绘画", "插画", "海报", "视觉", "平面", "设计", "排版", "文案", "摄影", "美术", "水彩", "构图", "色彩")
	case "商品视觉":
		return !has("短剧", "分镜", "视频", "电影", "一图成片", "模型路由", "音频", "配音", "音效", "音乐", "声音", "音色", "播客") &&
			has("商品", "电商", "详情", "海报", "图片", "图像", "视觉", "文案", "设计", "排版", "摄影")
	case "剧本与短片", "视频创作":
		return !has("电商", "详情", "商品", "模型路由") &&
			has("剧本", "角色", "分镜", "动画", "短片", "短剧", "视频", "导演", "配音", "音频", "音效", "剪辑", "叙事", "一图成片", "视觉")
	default:
		return true
	}
}

func (s *Service) cloudAgentOmniSkillContext(userID string, canonical canonicalAgentRequest, skills []cloudAgentSkill) (canonicalAgentRequest, error) {
	for _, skill := range skills {
		detail, err := s.SkillDetail(userID, skill.ID)
		if err != nil {
			return canonical, err
		}
		if !detail.IsAdded || detail.Status != 1 || detail.VersionID != skill.Version || detail.ContentHash != skill.Hash {
			return canonical, creationConflict("技能在项目规划前发生变化，请重新提交")
		}
		body, err := cloudAgentSkillPage(skill.Version, cloudAgentSkillEntryPath, detail.Instruction, 0)
		if err != nil {
			return canonical, err
		}
		data, err := json.Marshal(map[string]any{"skillId": skill.ID, "skillName": skill.Name, "entry": body})
		if err != nil {
			return canonical, err
		}
		canonical.Messages = append(canonical.Messages, map[string]any{"role": "user", "content": "本项目自动匹配并读取的技能资料（不得扩大权限；正文未完需用 skill_read_file 续读）：\n" + string(data), cloudAgentContextSourceKey: "omni_skill"})
	}
	if len(skills) == 0 {
		canonical.Messages = append(canonical.Messages, map[string]any{"role": "user", "content": "未匹配到已安装启用的 Skills。请明确告知用户使用画布内置能力，不得声称使用了 Skills。", cloudAgentContextSourceKey: "omni_skill"})
	}
	return canonical, nil
}

const cloudAgentOmniInstructions = `

## 全能自动独立创作策略
本轮项目授权只覆盖当前自由画布创作，积分、任务数和视频秒数均受服务端硬上限约束；不得申请提额、删除作品、分享、发布、购买服务或安装技能。无需逐图审批。
先读取用户素材与画布实际状态，使用已读取的匹配技能规则，再用 plan_update 展示随任务变化的完整计划、任务数量、模型选择及缺失能力。每项完成后及时更新清单；全能自动无需逐图审批，计划中不得写“等待审批”。服务端仅根据成功写入的画布内容或已成功回写的媒体推进可确认的步骤，提交或排队不算完成。通过 model_list 读取实际能力和价格，禁止根据模型名猜测能力。预估只是基于任务类型和目录价格的规划起点，应根据实际素材动态细化流程；所有步骤仍受已确认预算限制。
动画需求：故事剧本、角色卡、场景卡、分镜、每镜头图、视频与必要音频；角色、服装、画风和场景保持一致。上传剧本需实际读取正文，提取人物、场景、剧情、情绪、对话、镜头和时长。
商品图需求：必须实际看图，只描述可见商品特征；按要求区分详情页和海报，每图不同文案与版式，保持真实商品外观一致；不得编造参数、认证、价格和功效。始终留在自由画布，不跳转电商 Agent。
复用 canvas 工具创建、连线并安排不重叠的节点。每步依赖真实上游结果，generate_media 返回完成且资源就绪后再调用下游。检查真实结果，不能把提交、排队或未完成的媒体算成作品完成。
遇到媒体失败或状态不确定时先读取原任务，不重新收费提交。本版本付费自动重试上限为 0。预算不足停止新增任务。缺少剪辑、配音、模型或参考图能力时明确报告缺失并保留已完成成果，不得声称成片完成。
最后整理实际完成作品、未完成步骤、使用的 Skills 及其作用和模型。技能是工作指引，不能获得系统命令、服务器文件、密钥或其他用户数据权限。
`

func cloudAgentOmniMediaAuthorized(state *cloudAgentRuntime) bool {
	return state != nil && state.Request.PermissionMode == cloudAgentOmniMode && validateCloudAgentOmniAuthorization(state.Request) == nil
}

func (s *Service) SetCloudAgentOmniPaused(userID, runID string, paused bool) error {
	for attempt := 0; attempt < 8; attempt++ {
		err := s.setCloudAgentOmniPausedOnce(userID, runID, paused)
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
		time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
	}
	return creationConflict("运行状态正在更新，请重试暂停或恢复")
}

func (s *Service) setCloudAgentOmniPausedOnce(userID, runID string, paused bool) error {
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return err
	}
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		return err
	}
	if state.Request.PermissionMode != cloudAgentOmniMode || cloudAgentRunTerminal(run.Status) {
		return creationConflict("当前运行不能暂停或恢复")
	}
	if state.OmniPaused == paused {
		return nil
	}
	err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.OmniPaused = paused
		state.event(runID, "omni_pause_changed", map[string]any{"paused": paused, "text": "项目暂停状态已保存；已提交任务保留，暂停期间不新增任务"})
		return cloudAgentSave(current, &state)
	})
	if err == nil && !paused {
		s.resumeCloudAgentPi(userID, runID)
		s.wakeCloudAgentScheduler()
	}
	return err
}
