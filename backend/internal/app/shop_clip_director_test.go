package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestShopClipDirectionPreservesSourceSpeechAndTiming(t *testing.T) {
	text := "这是一个需要完整保留的商品介绍，容量和材质请以真实画面为准。"
	plan := ShopClipPlan{Transcript: []ShopClipCue{{StartMs: 250, EndMs: 12000, Text: text}}, ReferenceText: text, TemplateID: "beauty", Visual: ShopClipVisual{Animation: "pop"}}
	result := shopClipDirectorResult{CaptionMaxChars: 8, Summary: "保留完整说明，按信息点分句"}
	cues, ignored, err := applyShopClipDirection(plan, result)
	if err != nil || ignored != 0 || len(cues) < 2 {
		t.Fatalf("direction: %v %+v", err, cues)
	}
	var recovered strings.Builder
	for i, cue := range cues {
		if cue.EndMs-cue.StartMs < 400 || i > 0 && cues[i-1].EndMs != cue.StartMs {
			t.Fatalf("invalid continuity: %+v", cues)
		}
		recovered.WriteString(cue.Text)
	}
	if recovered.String() != text || cues[0].StartMs != 250 || cues[len(cues)-1].EndMs != 12000 || plan.Visual.Animation != "pop" || plan.TemplateID != "beauty" {
		t.Fatal("director changed user parameters, speech or boundaries")
	}
}

func TestShopClipDirectionRejectsInvalidCorrectionReferencesAndPacing(t *testing.T) {
	plan := ShopClipPlan{Transcript: []ShopClipCue{{StartMs: 0, EndMs: 4000, Text: "这款水杯容量五百毫升"}}, ReferenceText: "这款水杯容量三百毫升"}
	for _, raw := range []string{
		`{"captionMaxChars":16,"summary":"按知识编排","corrections":[{"index":-1,"text":"这是原话"}]}`,
		`{"captionMaxChars":16,"summary":"按知识编排","corrections":[{"index":5,"text":"这是原话"}]}`,
		`{"captionMaxChars":16,"summary":"按知识编排","corrections":[{"index":0,"text":"这款水杯容量三百毫升"},{"index":0,"text":"这款水杯容量五百毫升"}]}`,
		`{"captionMaxChars":1,"summary":"按知识编排"}`,
	} {
		var result shopClipDirectorResult
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			t.Fatal(err)
		}
		if _, _, err := applyShopClipDirection(plan, result); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestShopClipCreateRequiresTitleAndProtectsAnalysisMetadata(t *testing.T) {
	if _, err := shopClipCreatePlan(ShopClipCreateRequest{Title: "  "}); err == nil {
		t.Fatal("empty title accepted")
	}
	if _, err := shopClipCreatePlan(ShopClipCreateRequest{Title: strings.Repeat("字", 101)}); err == nil {
		t.Fatal("oversized title accepted")
	}
	plan, err := shopClipCreatePlan(ShopClipCreateRequest{Title: "  一支实测  ", AutoRender: true, ReferenceText: "原话", TrimStartMs: 1000, TrimEndMs: 3000})
	if err != nil || plan.Title != "一支实测" || !plan.AutoRender || plan.ReferenceText != "原话" {
		t.Fatalf("plan: %+v %v", plan, err)
	}
	for _, change := range []func(*ShopClipPlan){
		func(p *ShopClipPlan) { p.TrimStartMs = 0 }, func(p *ShopClipPlan) { p.SourceDurationMs = 5000 }, func(p *ShopClipPlan) { p.AutoRender = false }, func(p *ShopClipPlan) { p.Director = &ShopClipDirection{Summary: "伪造知识"} },
	} {
		next := plan
		change(&next)
		if shopClipImmutablePlan(plan, next) == nil {
			t.Fatal("immutable analysis/source fields were mutable")
		}
	}
	for _, bounds := range [][3]int64{{-1, 1000, 5000}, {0, 6000, 5000}, {2000, 1000, 5000}, {1000, 1200, 5000}} {
		if _, err := shopClipTrimEnd(bounds[0], bounds[1], bounds[2]); err == nil {
			t.Fatalf("accepted trim %v", bounds)
		}
	}
}
