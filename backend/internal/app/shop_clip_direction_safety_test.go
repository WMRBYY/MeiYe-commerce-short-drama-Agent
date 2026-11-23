package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestShopClipDirectionCannotChangeProductFactsFromReference(t *testing.T) {
	for _, pair := range [][2]string{
		{"这款保温杯容量是500毫升", "这款保温杯容量是500升"},
		{"这款面霜不含香精", "这款面霜含香精"},
		{"这款充电器支持15W输出", "这款充电器支持15V输出"},
		{"这款工具重量是1.5kg", "这款工具重量是15kg"},
		{"接口为USB3.0，请确认兼容性", "接口为USB30，请确认兼容性"},
		{"这一款来自品牌A", "这一款来自品牌B"},
	} {
		t.Run(pair[1], func(t *testing.T) {
			plan := ShopClipPlan{ReferenceText: pair[1], Transcript: []ShopClipCue{{StartMs: 250, EndMs: 12000, Text: pair[0]}}}
			raw, _ := json.Marshal(map[string]any{"captionMaxChars": 8, "summary": "已纠正品牌及参数", "corrections": []map[string]any{{"index": 0, "text": pair[1]}}})
			var result shopClipDirectorResult
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatal(err)
			}
			cues, ignored, err := applyShopClipDirection(plan, result)
			if err != nil || ignored != 1 || len(cues) == 0 {
				t.Fatalf("unsafe suggestion should be ignored without aborting: %+v ignored=%d %v", cues, ignored, err)
			}
			var recovered strings.Builder
			for i, cue := range cues {
				recovered.WriteString(cue.Text)
				if cue.EndMs-cue.StartMs < 400 || i > 0 && cues[i-1].EndMs != cue.StartMs {
					t.Fatalf("unsafe suggestion damaged cue continuity: %+v", cues)
				}
			}
			if recovered.String() != pair[0] || cues[0].StartMs != 250 || cues[len(cues)-1].EndMs != 12000 || plan.Transcript[0].Text != pair[0] {
				t.Fatalf("reference rewrote source facts or timing: %q => %+v", pair[0], cues)
			}
			if summary := shopClipDirectionSummary(result, ignored); !strings.Contains(summary, "已忽略 1 条") || strings.Contains(summary, "已纠正") {
				t.Fatalf("summary misrepresented an ignored edit: %s", summary)
			}
		})
	}
}

func TestShopClipDirectionAllowsPunctuationWithoutChangingWords(t *testing.T) {
	plan := ShopClipPlan{ReferenceText: "先看细节，再看实测。", Transcript: []ShopClipCue{{StartMs: 0, EndMs: 4000, Text: "先看细节再看实测"}}}
	var result shopClipDirectorResult
	if err := json.Unmarshal([]byte(`{"captionMaxChars":16,"summary":"补足句读，完整保留原话","corrections":[{"index":0,"text":"先看细节，再看实测。"}]}`), &result); err != nil {
		t.Fatal(err)
	}
	cues, ignored, err := applyShopClipDirection(plan, result)
	if err != nil || ignored != 0 || len(cues) != 1 || cues[0].Text != plan.ReferenceText || cues[0].StartMs != 0 || cues[0].EndMs != 4000 {
		t.Fatalf("safe punctuation correction failed: %+v %v", cues, err)
	}
}

func TestShopClipDirectionIgnoresUntrustedSuggestionsPerCue(t *testing.T) {
	plan := ShopClipPlan{ReferenceText: "先看细节，再看实测。品牌B支持15V。", Transcript: []ShopClipCue{
		{StartMs: 0, EndMs: 4000, Text: "先看细节再看实测"},
		{StartMs: 5000, EndMs: 9000, Text: "品牌A支持15W"},
	}}
	var result shopClipDirectorResult
	if err := json.Unmarshal([]byte(`{"captionMaxChars":16,"summary":"已改正品牌和功率","corrections":[{"index":0,"text":"先看细节，再看实测。"},{"index":1,"text":"品牌B支持15V。"}]}`), &result); err != nil {
		t.Fatal(err)
	}
	cues, ignored, err := applyShopClipDirection(plan, result)
	if err != nil || ignored != 1 || len(cues) != 2 || cues[0].Text != "先看细节，再看实测。" || cues[1] != plan.Transcript[1] || cues[0].EndMs != 4000 {
		t.Fatalf("one unsafe suggestion affected valid punctuation or source timing: %+v ignored=%d %v", cues, ignored, err)
	}
}

func TestShopClipDirectionWithoutReferenceStillSplitsOriginalSpeech(t *testing.T) {
	const original = "这一款来自品牌A，容量500毫升，重量1.5kg，不含香精，接口为USB3.0，请按原话核对。"
	plan := ShopClipPlan{Transcript: []ShopClipCue{{StartMs: 250, EndMs: 12000, Text: original}}}
	for _, suggestion := range []string{original, "这一款来自品牌B，容量500升，重量15kg，含香精，接口为USB30。", "", strings.Repeat("改", 81)} {
		raw, _ := json.Marshal(map[string]any{"captionMaxChars": 8, "summary": "已根据参考修正字幕", "corrections": []map[string]any{{"index": 0, "text": suggestion}}})
		var result shopClipDirectorResult
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatal(err)
		}
		cues, ignored, err := applyShopClipDirection(plan, result)
		if err != nil || ignored != 1 || len(cues) < 2 {
			t.Fatalf("missing reference or invalid suggestion blocked original segmentation: %+v ignored=%d %v", cues, ignored, err)
		}
		var recovered strings.Builder
		for i, cue := range cues {
			recovered.WriteString(cue.Text)
			if cue.EndMs-cue.StartMs < 400 || i > 0 && cues[i-1].EndMs != cue.StartMs {
				t.Fatalf("original timing lost: %+v", cues)
			}
		}
		if recovered.String() != original || cues[0].StartMs != 250 || cues[len(cues)-1].EndMs != 12000 {
			t.Fatalf("source facts or timing changed: %+v", cues)
		}
	}
}
