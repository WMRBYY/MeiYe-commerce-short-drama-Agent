package app

import (
	"reflect"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"
)

func TestShopClipTranscriptSplitsLongSpeechWithoutLosingText(t *testing.T) {
	for _, text := range []string{
		strings.Repeat("这款保温杯容量是五百毫升，出门携带很方便。", 6),
		strings.Repeat("This bottle keeps drinks warm and fits in your bag. ", 5),
		strings.Repeat("Everyday comfort with a soft lining, easy to clean; ready to go! ", 4),
		strings.Repeat("长句没有标点也应该完整保留", 12),
	} {
		t.Run(text[:min(len(text), 30)], func(t *testing.T) {
			cues, err := shopClipTranscript([]timelineTranscriptionSegment{{StartMs: 250, EndMs: 12000, Text: text}}, 12500)
			if err != nil {
				t.Fatal(err)
			}
			if len(cues) < 2 || cues[0].StartMs != 250 || cues[len(cues)-1].EndMs != 12000 {
				t.Fatalf("segment bounds or splitting: %+v", cues)
			}
			var joined strings.Builder
			previous := int64(250)
			for _, cue := range cues {
				if cue.StartMs != previous || cue.EndMs-cue.StartMs < shopClipCaptionMinSplitMs || utf8.RuneCountInString(cue.Text) > 80 || strings.TrimSpace(cue.Text) == "" {
					t.Fatalf("invalid split: %+v", cue)
				}
				previous = cue.EndMs
				joined.WriteString(cue.Text)
			}
			if captionNonWhitespace(joined.String()) != captionNonWhitespace(text) {
				t.Fatalf("split lost text: %q", joined.String())
			}
		})
	}
}

func TestShopClipTranscriptKeepsEnglishWordsAndPunctuation(t *testing.T) {
	text := "This comfortable bottle keeps your water warm, and the lid never leaks. Take it on your next trip."
	cues, err := shopClipTranscript([]timelineTranscriptionSegment{{StartMs: 1000, EndMs: 10000, Text: text}}, 12000)
	if err != nil {
		t.Fatal(err)
	}
	parts := make([]string, len(cues))
	for i, cue := range cues {
		parts[i] = cue.Text
	}
	if strings.Join(parts, " ") != text {
		t.Fatalf("split inside a word or lost punctuation: %#v", parts)
	}
}

func TestShopClipTranscriptKeepsUnicodeCharacterSequences(t *testing.T) {
	text := strings.Repeat("轻巧🇨🇳 e\u0301👩🏽‍💻舒适，", 12)
	cues, err := shopClipTranscript([]timelineTranscriptionSegment{{StartMs: 0, EndMs: 15000, Text: text}}, 15000)
	if err != nil {
		t.Fatal(err)
	}
	var joined strings.Builder
	for _, cue := range cues {
		characters := []rune(cue.Text)
		if unicode.IsMark(characters[0]) || characters[0] == '\u200d' || characters[len(characters)-1] == '\u200d' || strings.Count(cue.Text, "🇨") != strings.Count(cue.Text, "🇳") || strings.Count(cue.Text, "👩") != strings.Count(cue.Text, "💻") {
			t.Fatalf("split a character sequence: %q", cue.Text)
		}
		joined.WriteString(cue.Text)
	}
	if captionNonWhitespace(joined.String()) != captionNonWhitespace(text) {
		t.Fatal("unicode text changed")
	}
}

func TestShopClipTranscriptSortsClampsAndSharesSmallOverlap(t *testing.T) {
	input := []timelineTranscriptionSegment{
		{StartMs: 1900, EndMs: 3100, Text: "第二句"},
		{StartMs: -50, EndMs: 2000, Text: "第一句"},
		{StartMs: 900, EndMs: 1200, Text: " "},
	}
	original := append([]timelineTranscriptionSegment(nil), input...)
	cues, err := shopClipTranscript(input, 3000)
	if err != nil {
		t.Fatal(err)
	}
	want := []ShopClipCue{{StartMs: 0, EndMs: 1950, Text: "第一句"}, {StartMs: 1950, EndMs: 3000, Text: "第二句"}}
	if !reflect.DeepEqual(cues, want) || !reflect.DeepEqual(input, original) {
		t.Fatalf("incorrect normalized bounds or input mutation: %+v", cues)
	}
}

func TestShopClipTranscriptPreservesShortSegmentAndGaps(t *testing.T) {
	input := []timelineTranscriptionSegment{{StartMs: 250, EndMs: 255, Text: "好"}, {StartMs: 500, EndMs: 1750, Text: "识别的商品字幕"}}
	cues, err := shopClipTranscript(input, 2000)
	if err != nil {
		t.Fatal(err)
	}
	want := []ShopClipCue{{StartMs: 250, EndMs: 255, Text: "好"}, {StartMs: 500, EndMs: 1750, Text: "识别的商品字幕"}}
	if !reflect.DeepEqual(cues, want) {
		t.Fatalf("ordinary timestamps changed: %+v", cues)
	}
}

func TestShopClipTranscriptUsesLargerClausesForShortSpeech(t *testing.T) {
	text := strings.Repeat("素材", 30)
	cues, err := shopClipTranscript([]timelineTranscriptionSegment{{StartMs: 0, EndMs: 200, Text: text}}, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(cues) != 2 || cues[0].EndMs < 100 || cues[1].EndMs != 200 || cues[0].Text+cues[1].Text != text {
		t.Fatalf("short speech should retain all text in fewer cues: %+v", cues)
	}
}

func TestShopClipTranscriptRejectsUnrecoverableTimingWithoutDroppingText(t *testing.T) {
	cases := map[string][]timelineTranscriptionSegment{
		"empty":           {{StartMs: 0, EndMs: 1000, Text: " "}},
		"outside_media":   {{StartMs: 1001, EndMs: 2000, Text: "不能丢弃"}},
		"reversed":        {{StartMs: 500, EndMs: 400, Text: "不能丢弃"}},
		"zero":            {{StartMs: 500, EndMs: 500, Text: "不能丢弃"}},
		"severe_overlap":  {{StartMs: 0, EndMs: 700, Text: "第一句"}, {StartMs: 300, EndMs: 900, Text: "第二句"}},
		"contained":       {{StartMs: 0, EndMs: 500, Text: "第一句"}, {StartMs: 400, EndMs: 410, Text: "第二句"}},
		"too_dense":       {{StartMs: 0, EndMs: 10, Text: strings.Repeat("字", 81)}},
		"invalid_unicode": {{StartMs: 0, EndMs: 1000, Text: string([]byte{0xff})}},
		"huge_cluster":    {{StartMs: 0, EndMs: 1000, Text: "e" + strings.Repeat("\u0301", 80)}},
		"excessive_text":  {{StartMs: 0, EndMs: 1000, Text: strings.Repeat("字", 80001)}},
	}
	for name, segments := range cases {
		t.Run(name, func(t *testing.T) {
			if cues, err := shopClipTranscript(segments, 1000); err == nil || cues != nil {
				t.Fatalf("must fail without partial output: %+v %v", cues, err)
			}
		})
	}
}

func TestShopClipTranscriptRejectsTooManyCues(t *testing.T) {
	segments := make([]timelineTranscriptionSegment, 1001)
	for i := range segments {
		segments[i] = timelineTranscriptionSegment{StartMs: int64(i * 100), EndMs: int64((i + 1) * 100), Text: "字幕"}
	}
	if cues, err := shopClipTranscript(segments, 110000); err == nil || cues != nil {
		t.Fatalf("accepted more than plan limit: %d %v", len(cues), err)
	}
}

func captionNonWhitespace(text string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, text)
}
