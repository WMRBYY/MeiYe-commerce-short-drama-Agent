package app

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	shopClipCaptionColumns    = 40
	shopClipCaptionMaxRunes   = 80
	shopClipCaptionMaxCues    = 1000
	shopClipCaptionMinSplitMs = 100
	shopClipCaptionOverlapMs  = 250
)

// shopClipTranscript keeps ASR segment boundaries, except small timestamp
// overlaps and media-boundary rounding. Sub-cue times are proportional estimates
// within each segment, not word alignment or newly detected speech boundaries.
func shopClipTranscript(segments []timelineTranscriptionSegment, durationMs int64) ([]ShopClipCue, error) {
	if durationMs <= 0 || durationMs > 300000 {
		return nil, fmt.Errorf("字幕原视频时长无效")
	}
	ordered := make([]timelineTranscriptionSegment, 0, len(segments))
	characters := 0
	for _, segment := range segments {
		segment.Text = strings.TrimSpace(segment.Text)
		if segment.Text == "" {
			continue
		}
		if !utf8.ValidString(segment.Text) {
			return nil, fmt.Errorf("识别字幕包含无效文字，请检查音轨后重试")
		}
		characters += utf8.RuneCountInString(segment.Text)
		if characters > shopClipCaptionMaxRunes*shopClipCaptionMaxCues {
			return nil, fmt.Errorf("识别字幕文字过多，请缩短视频后重试")
		}
		segment.StartMs = max(0, segment.StartMs)
		segment.EndMs = min(durationMs, segment.EndMs)
		if segment.EndMs <= segment.StartMs {
			return nil, fmt.Errorf("识别字幕没有可用时间范围，请检查音轨后重试")
		}
		ordered = append(ordered, segment)
	}
	if len(ordered) == 0 {
		return nil, fmt.Errorf("没有识别到可用口播，请检查音轨")
	}
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].StartMs < ordered[j].StartMs })
	for i := 1; i < len(ordered); i++ {
		previous, current := &ordered[i-1], &ordered[i]
		if previous.EndMs <= current.StartMs {
			continue
		}
		overlap := previous.EndMs - current.StartMs
		boundary := current.StartMs + overlap/2
		if overlap > shopClipCaptionOverlapMs || boundary <= previous.StartMs || boundary >= current.EndMs {
			return nil, fmt.Errorf("识别字幕时间重叠过多，无法自动校正，请检查音轨后重试")
		}
		previous.EndMs, current.StartMs = boundary, boundary
	}
	result := make([]ShopClipCue, 0, len(ordered))
	for _, segment := range ordered {
		parts, err := splitShopClipCaption(segment.Text)
		if err != nil {
			return nil, err
		}
		span := segment.EndMs - segment.StartMs
		// If an unusually short segment cannot fit readable sub-cues, retain
		// larger clauses up to the API limit. Never discard text to fit time.
		maxParts := max(1, int(span/shopClipCaptionMinSplitMs))
		for len(parts) > maxParts {
			merge, shortest := -1, int(^uint(0)>>1)
			for i := 0; i+1 < len(parts); i++ {
				count := utf8.RuneCountInString(strings.TrimSpace(parts[i] + parts[i+1]))
				if count <= shopClipCaptionMaxRunes && count < shortest {
					merge, shortest = i, count
				}
			}
			if merge < 0 {
				return nil, fmt.Errorf("识别字幕过密，无法在原时间内完整分句，请检查音轨后重试")
			}
			parts[merge] += parts[merge+1]
			parts = append(parts[:merge+1], parts[merge+2:]...)
		}
		if len(result)+len(parts) > shopClipCaptionMaxCues {
			return nil, fmt.Errorf("识别字幕超过 1000 句，请缩短视频后重试")
		}
		weights, total := make([]int64, len(parts)), int64(0)
		for i, part := range parts {
			weights[i] = int64(shopClipCaptionWidth([]rune(strings.TrimSpace(part))))
			total += weights[i]
		}
		minimum := min(int64(shopClipCaptionMinSplitMs), span/int64(len(parts)))
		remaining := span - minimum*int64(len(parts))
		cursor, usedWeight := segment.StartMs, int64(0)
		for i, part := range parts {
			usedWeight += weights[i]
			end := segment.StartMs + minimum*int64(i+1) + remaining*usedWeight/total
			result = append(result, ShopClipCue{StartMs: cursor, EndMs: end, Text: strings.TrimSpace(part)})
			cursor = end
		}
	}
	return result, nil
}

// Prefer punctuation and word boundaries around a short display line. Whitespace
// at cuts remains in the parts so merging cannot join separate English words.
func splitShopClipCaption(text string) ([]string, error) {
	return splitShopClipCaptionColumns(text, shopClipCaptionColumns)
}

func splitShopClipCaptionColumns(text string, columns int) ([]string, error) {
	runes := []rune(text)
	parts := []string{}
	for len(runes) > 0 {
		limit, width, punctuation, space := 0, 0, 0, 0
		for i, r := range runes {
			width += shopClipCaptionRuneWidth(r)
			if !shopClipCaptionBoundary(runes, i+1) {
				continue
			}
			if i+1 > shopClipCaptionMaxRunes {
				break
			}
			limit = i + 1
			if width >= columns/2 {
				if strings.ContainsRune("。！？；，、!?;,", r) || r == '.' && (i+1 == len(runes) || unicode.IsSpace(runes[i+1])) {
					punctuation = limit
				}
				if unicode.IsSpace(r) {
					space = limit
				}
			}
			if width >= columns {
				break
			}
		}
		if limit == 0 {
			return nil, fmt.Errorf("识别字幕包含无法分开的超长字符组合，请检查音轨后重试")
		}
		if limit < len(runes) {
			if punctuation > 0 {
				limit = punctuation
			} else if space > 0 {
				limit = space
			}
		}
		part := string(runes[:limit])
		if strings.TrimSpace(part) == "" {
			// Preserve internal whitespace rather than creating an empty cue.
			if len(parts) > 0 {
				parts[len(parts)-1] += part
			}
		} else {
			parts = append(parts, part)
		}
		runes = runes[limit:]
	}
	return parts, nil
}

func shopClipCaptionWidth(text []rune) int {
	width := 0
	for _, r := range text {
		width += shopClipCaptionRuneWidth(r)
	}
	return max(1, width)
}

func shopClipCaptionRuneWidth(r rune) int {
	if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) || r >= 0x1f000 {
		return 2
	}
	return 1
}

func shopClipCaptionBoundary(text []rune, at int) bool {
	if at == len(text) {
		return true
	}
	previous, next := text[at-1], text[at]
	if previous == '\u200d' || next == '\u200d' || unicode.IsMark(next) || next >= 0xfe00 && next <= 0xfe0f || next >= 0x1f3fb && next <= 0x1f3ff || next >= 0xe0100 && next <= 0xe01ef {
		return false
	}
	if previous >= 0x1f1e6 && previous <= 0x1f1ff && next >= 0x1f1e6 && next <= 0x1f1ff {
		count := 0
		for i := at - 1; i >= 0 && text[i] >= 0x1f1e6 && text[i] <= 0x1f1ff; i-- {
			count++
		}
		return count%2 == 0
	}
	return true
}
