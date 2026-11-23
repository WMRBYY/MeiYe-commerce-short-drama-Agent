package app

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
)

type CloudAgentOmniQuoteItem struct {
	Capability       string  `json:"capability"`
	Model            string  `json:"model"`
	Count            int     `json:"count"`
	Seconds          int     `json:"seconds,omitempty"`
	EstimatedCredits float64 `json:"estimatedCredits"`
	ChannelID        string  `json:"channelId,omitempty"`
	ChannelModelKey  string  `json:"channelModelKey,omitempty"`
	LogicalModelID   string  `json:"logicalModelId,omitempty"`
}

type CloudAgentOmniQuote struct {
	Hash             string                    `json:"hash"`
	Kind             string                    `json:"kind"`
	EstimatedCredits float64                   `json:"estimatedCredits"`
	Items            []CloudAgentOmniQuoteItem `json:"items"`
	Skills           []cloudAgentSkill         `json:"skills"`
	Missing          []string                  `json:"missing"`
	Method           string                    `json:"method"`
}

var omniImageCount = regexp.MustCompile(`([0-9]{1,3})\s*[张幅]`)
var omniDuration = regexp.MustCompile(`([0-9]{1,4})\s*秒`)
var omniExcludedMedia = regexp.MustCompile(`(?:不要|不需要|无需)(?:生成)?(?:视频|音频|配音|音乐)(?:或(?:视频|音频|配音|音乐))*|no\s+(?:video|audio)`)

// The preflight is entirely local: it does not create tasks, charge credits or
// call an upstream. Counts are estimates; the LLM refines the actual workflow
// after consent. Every later task still goes through normal capability admission.
func omniEstimateWork(prompt string) (kind string, text, images, videos, seconds, audio int) {
	kind, text = "自由创作", 4
	p := strings.ToLower(prompt)
	p = omniExcludedMedia.ReplaceAllString(p, "")
	contains := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(p, w) {
				return true
			}
		}
		return false
	}
	if contains("动画", "短片", "分镜", "剧本", "video", "animation") {
		kind, text, seconds = "剧本与短片", 10, 30
		if match := omniDuration.FindStringSubmatch(p); len(match) > 1 {
			seconds, _ = strconv.Atoi(match[1])
		}
		seconds = min(600, max(1, seconds))
		videos = (seconds + 4) / 5
		images, audio = videos+2, 1
	} else if contains("详情页", "电商", "商品", "产品图") {
		kind, text, images = "商品视觉", 6, 1
	} else if contains("海报", "poster", "生图", "图片", "画一", "画个", "生成图") {
		kind, images = "图片与海报", 1
	} else if contains("视频") {
		kind, text, images, videos, seconds = "视频创作", 6, 1, 1, 5
	}
	if match := omniImageCount.FindStringSubmatch(p); len(match) > 1 {
		images, _ = strconv.Atoi(match[1])
		images = min(100, max(1, images))
	}
	if contains("配音", "音频", "音乐", "audio") {
		audio = 1
	}
	return
}

func omniEstimatePrice(m PublicChannelModel, count, seconds int) (int64, bool) {
	var upper int64
	if len(m.PriceTiers) == 0 {
		return 0, false
	}
	for _, tier := range m.PriceTiers {
		var amount int64
		switch tier.BillingMode {
		case "fixed_request":
			amount = tier.UnitPriceMicrocredits * int64(count)
		case "per_second":
			amount = tier.UnitPriceMicrocredits * int64(max(seconds, count*5))
		case "token":
			if normalizeCapability(m.Capability) != "text" {
				return 0, false
			}
			// Forecast 16k input and 4k output tokens per planner turn, using
			// published per-million-token rates. It is not a billing reservation.
			amount = int64(math.Ceil(float64(tier.InputTokenPriceMicrocredits)*0.016+float64(tier.OutputTokenPriceMicrocredits)*0.004)) * int64(count)
		default:
			return 0, false
		}
		if amount < 0 || amount > 1_000_000*CreditScale {
			return 0, false
		}
		upper = max(upper, amount)
	}
	return upper, true
}

func (s *Service) CloudAgentOmniQuote(userID string, req CloudAgentRequest) (*CloudAgentOmniQuote, error) {
	if !s.CloudAgentOmniAvailable(userID) {
		return nil, Forbidden("全能自动尚未开放当前账号验收")
	}
	probe := req
	probe.PermissionMode, probe.OmniAuthorization = "auto", nil
	if err := validateCloudAgentRequest(&probe); err != nil {
		return nil, err
	}
	if req.CanvasID == "" {
		return nil, BadAuthRequest("全能自动需要当前自由画布")
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, req.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	imageRefs := 0
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["type"]) == "image" {
			imageRefs++
		}
	}
	kind, text, images, videos, seconds, audio := omniEstimateWork(req.Prompt)
	quote := &CloudAgentOmniQuote{Kind: kind, Items: []CloudAgentOmniQuoteItem{}, Skills: []cloudAgentSkill{}, Missing: []string{}, Method: "按任务类型预估数量；采用当前模型目录全部有效价格档中的保守价格，文本按每步输入16000和输出4000 token估算。素材分析后计划可能调整，每次任务仍按实际规格报价并受项目总上限约束。"}
	ids, err := s.cloudAgentOmniSkillIDs(userID, req.Prompt, req.SkillIDs)
	if err != nil {
		return nil, err
	}
	pool, err := s.cloudAgentBuildSkillPool(userID, req.Prompt, ids)
	if err != nil {
		return nil, err
	}
	for _, skill := range pool.Pinned {
		skill.Files = nil
		skill.Instruction = ""
		quote.Skills = append(quote.Skills, skill)
	}
	access, err := s.userGroupAccess(userID)
	if err != nil {
		return nil, err
	}
	for _, work := range []struct {
		capability     string
		count, seconds int
	}{{"text", text, 0}, {"image", images, 0}, {"video", videos, seconds}, {"audio", audio, 0}} {
		if work.count == 0 {
			continue
		}
		intent := &ModelRequestIntent{Capability: work.capability, Inputs: map[string]int{}}
		if ((work.capability == "image" || work.capability == "text") && imageRefs > 0) || work.capability == "video" {
			intent.Inputs["image"] = 1
		}
		catalog, err := s.ModelCatalog(access, intent)
		if err != nil {
			return nil, err
		}
		var best *CloudAgentOmniQuoteItem
		if work.capability == "text" && req.LogicalModelID != "" {
			models, err := s.PublicLogicalModels(access, intent)
			if err != nil {
				return nil, err
			}
			for _, m := range models {
				if m.ID != req.LogicalModelID || !m.Available {
					continue
				}
				projected := PublicChannelModel{Capability: m.Capability}
				for _, tier := range m.PriceTiers {
					projected.PriceTiers = append(projected.PriceTiers, PublicChannelModelPriceTier{BillingMode: tier.BillingMode, UnitPriceMicrocredits: tier.UnitPriceMicrocredits, InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits})
				}
				if amount, known := omniEstimatePrice(projected, work.count, work.seconds); known {
					best = &CloudAgentOmniQuoteItem{Capability: work.capability, Model: m.Name, Count: work.count, EstimatedCredits: float64(amount) / float64(CreditScale), LogicalModelID: m.ID}
				}
			}
		}
		for _, channel := range catalog.Channels {
			for _, m := range channel.Models {
				if !m.Available || m.ManagedNodeOnly || normalizeCapability(m.Capability) != work.capability {
					continue
				}
				amount, known := omniEstimatePrice(m, work.count, work.seconds)
				if !known {
					continue
				}
				item := CloudAgentOmniQuoteItem{Capability: work.capability, Model: m.DisplayName, Count: work.count, Seconds: work.seconds, EstimatedCredits: float64(amount) / float64(CreditScale), ChannelID: channel.ID, ChannelModelKey: m.ModelKey}
				preferred := work.capability == "text" && channel.ID == req.ChannelID && m.ModelKey == req.ChannelModelKey
				bestPreferred := best != nil && work.capability == "text" && ((best.LogicalModelID != "" && best.LogicalModelID == req.LogicalModelID) || (best.ChannelID == req.ChannelID && best.ChannelModelKey == req.ChannelModelKey))
				if best == nil || (preferred && !bestPreferred) || (!bestPreferred && item.EstimatedCredits < best.EstimatedCredits) {
					copied := item
					best = &copied
				}
			}
		}
		if best == nil {
			quote.Missing = append(quote.Missing, "未找到可预估价格且满足输入能力的"+work.capability+"模型")
			continue
		}
		quote.Items = append(quote.Items, *best)
		quote.EstimatedCredits += best.EstimatedCredits
	}
	if videos > 0 {
		quote.Missing = append(quote.Missing, "现有 Agent 工具没有自动剪辑成片能力，将整理镜头视频与音频素材并报告缺口")
	}
	if images+videos+audio > req.Budget.MaxGenerationTasks {
		quote.Missing = append(quote.Missing, "预计媒体任务数超过本次授权数量，执行时会停止于授权上限")
	}
	if seconds > req.Budget.MaxVideoSeconds {
		quote.Missing = append(quote.Missing, "预计视频总时长超过本次授权上限")
	}
	if quote.EstimatedCredits > req.Budget.MaxCredits {
		quote.Missing = append(quote.Missing, fmt.Sprintf("预估 %.4f 积分超过预算 %.4f，可能只能完成部分步骤", quote.EstimatedCredits, req.Budget.MaxCredits))
	}
	// Bind the forecast to the caller, source material revision, user input,
	// scope, route, skill versions, task ceilings and current prices.
	requestCopy := req
	requestCopy.OmniAuthorization = nil
	requestCopy.ProfileRevision = ""
	requestCopy.IdempotencyKey = ""
	raw, _ := json.Marshal(struct {
		User    string
		Request CloudAgentRequest
		Canvas  string
		Quote   *CloudAgentOmniQuote
	}{userID, requestCopy, canvas.PayloadJSON, quote})
	quote.Hash = hashContentSHA256(string(raw))
	return quote, nil
}

func omniCommittedBudget(order model.BillingOrder) int64 {
	switch order.Status {
	case model.BillingStatusSettled:
		return max(0, order.ActualAmountMicrocredits)
	case model.BillingStatusRefunded:
		return 0
	default:
		return max(0, order.AmountMicrocredits)
	}
}
