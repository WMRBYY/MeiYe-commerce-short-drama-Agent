package app

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// Clip inputs retain their original aspect ratio, including small landscape
// videos. All text metrics therefore scale with the shorter image dimension.
func shopClipStyledCaptionASS(plan *RenderCaptionPlan, width, height int, visual ShopClipVisual, preview ShopClipTemplatePreview) (string, error) {
	if width <= 0 || height <= 0 {
		return "", fmt.Errorf("字幕画面尺寸无效")
	}
	font := preview.Font
	if font == "sans" {
		font = "sans-light"
	} else if font == "serif" {
		font = "serif-light"
	}
	if visual.SubtitleStyle == "serif" {
		font = "serif-bold"
	}
	family, bold, err := renderTextFace(font)
	if err != nil {
		return "", err
	}
	titleFamily, titleBold, err := renderTextFace("sans-bold")
	if err != nil {
		return "", err
	}
	unit := float64(min(width, height))
	size := unit * 0.055
	if visual.SubtitleStyle == "solid" || visual.SubtitleStyle == "highlight" {
		size = unit * 0.065
	}
	side, bottom, top := float64(width)*0.06, float64(height)*0.08, float64(height)*0.08
	outline := math.Max(0.4, unit*0.003)
	var out strings.Builder
	fmt.Fprintf(&out, "[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n", width, height)
	captionOutline := outline
	if visual.SubtitleStyle == "solid" {
		captionOutline *= 1.5
	}
	panel := visual.SubtitleStyle == "panel" || visual.SubtitleStyle == "highlight" || visual.SubtitleStyle == "bubble"
	if panel {
		captionOutline = 0
	}
	fmt.Fprintf(&out, "Style: Default,%s,%.2f,%s,%s,%s,&H66000000,%d,0,1,%.2f,0,2,%.0f,%.0f,%.0f,1\n", family, size, assColor(preview.Foreground, 0), assColor(preview.Foreground, 0), assColor(preview.Background, 0), bold, captionOutline, side, side, bottom)
	fmt.Fprintf(&out, "Style: Hook,%s,%.2f,&H00FFFFFF,&H00FFFFFF,&H00111111,&H78000000,%d,0,1,%.2f,0,8,%.0f,%.0f,%.0f,1\n", titleFamily, unit*0.085, titleBold, outline*1.4, side, side, top)
	fmt.Fprintf(&out, "Style: Point,%s,%.2f,&H00111111,&H00111111,%s,&H64000000,%d,0,3,%.2f,0,8,%.0f,%.0f,%.0f,1\n", titleFamily, unit*0.07, assColor(preview.Accent, 16), titleBold, unit*0.009, side, side, top)
	fmt.Fprintf(&out, "Style: Shape,%s,1,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,1,0,0,7,0,0,0,1\n", family)
	out.WriteString("\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	for _, cue := range plan.Cues {
		text, fit := shopClipFitCaption(cue.Text, size, width, height)
		// The maximum 110% pop scale fits inside the same 6% side margins.
		if visual.Animation == "pop" || panel {
			text, fit = shopClipFitCaption(cue.Text, size*0.94, int(float64(width)*0.94), height)
		}
		cx, cy := float64(width)/2, float64(height)-bottom
		effect := shopClipTextAnimation(visual.Animation, cue.EndMs-cue.StartMs, cx, cy, unit*0.035, true)
		if panel {
			lines := strings.Split(text, "\n")
			textWidth := 0.0
			for _, line := range lines {
				textWidth = math.Max(textWidth, shopClipTextWeight([]rune(line))*fit)
			}
			padding := unit * 0.018
			boxWidth := math.Min(float64(width)*0.86, textWidth+padding*2)
			boxHeight := float64(len(lines))*fit*1.45 + padding*2
			x, y := cx-boxWidth/2, cy-float64(len(lines))*fit*1.45-padding
			alpha, radius := 38, unit*0.018
			if visual.SubtitleStyle != "panel" {
				alpha = 0
			}
			if visual.SubtitleStyle == "bubble" {
				radius = math.Min(unit*0.05, boxHeight/3)
			}
			path := shopClipRoundedPanel(boxWidth, boxHeight, radius, visual.SubtitleStyle == "bubble")
			// Move the panel with its text; its own anchor is the top-left.
			shapeEffect := shopClipTextAnimation(visual.Animation, cue.EndMs-cue.StartMs, x, y, unit*0.035, false)
			fmt.Fprintf(&out, "Dialogue: -1,%s,%s,Shape,,0,0,0,,{\\an7\\bord0\\shad0\\1c%s\\1a&H%02X&%s\\p1}%s{\\p0}\n", renderASSTime(cue.StartMs), renderASSTime(cue.EndMs), assColor(preview.Background, 0), alpha, shapeEffect, path)
		}
		fmt.Fprintf(&out, "Dialogue: 0,%s,%s,Default,,0,0,0,,{\\fs%.2f%s}%s\n", renderASSTime(cue.StartMs), renderASSTime(cue.EndMs), fit, effect, escapeShopClipASS(text))
		if visual.Widget == "underline" {
			lineWidth := math.Min(float64(width)*0.32, float64(len([]rune(cue.Text)))*fit*0.55)
			shopClipASSShape(&out, cue.StartMs, cue.EndMs, cx-lineWidth/2, cy+unit*0.013, preview.Accent, 0,
				fmt.Sprintf("m 0 0 l %.2f 0 %.2f %.2f 0 %.2f", lineWidth, lineWidth, unit*0.009, unit*0.009), "")
		}
	}
	for _, cue := range plan.Overlays {
		base, style := unit*0.085, "Hook"
		effect := shopClipTextAnimation(visual.Animation, cue.EndMs-cue.StartMs, float64(width)/2, top, unit*0.035, true)
		if cue.Kind == "point" {
			base, style = unit*0.07, "Point"
		}
		// Leave width for the peak of the title's 110% entrance animation.
		text, fit := shopClipFitText(cue.Text, base, float64(width)*0.76)
		fmt.Fprintf(&out, "Dialogue: 1,%s,%s,%s,,0,0,0,,{\\fs%.2f%s}%s\n", renderASSTime(cue.StartMs), renderASSTime(cue.EndMs), style, fit, effect, escapeShopClipASS(text))
	}
	end := int64(0)
	for _, cue := range plan.Cues {
		end = max(end, cue.EndMs)
	}
	if end > 0 && visual.Widget == "progress" {
		w, h := float64(width)*0.84, math.Max(1, unit*0.006)
		path := fmt.Sprintf("m 0 0 l %.2f 0 %.2f %.2f 0 %.2f", w, w, h, h)
		shopClipASSShape(&out, 0, end, float64(width)*0.08, float64(height)*0.95, preview.Accent, 180, path, "")
		shopClipASSShape(&out, 0, end, float64(width)*0.08, float64(height)*0.95, preview.Accent, 0, path, fmt.Sprintf(`\fscx0\t(0,%d,\fscx100)`, end))
	}
	if end > 0 && visual.Widget == "corner" {
		length, stroke := unit*0.07, math.Max(1, unit*0.006)
		for _, position := range [][2]float64{{side, top}, {float64(width) - side, top}} {
			direction := 1.0
			if position[0] > float64(width)/2 {
				direction = -1
			}
			path := fmt.Sprintf("m 0 %.2f l 0 0 %.2f 0 %.2f %.2f %.2f %.2f %.2f %.2f", length, direction*length, direction*length, stroke, direction*stroke, stroke, direction*stroke, length)
			shopClipASSShape(&out, 0, end, position[0], position[1], preview.Accent, 0, path, `\fad(180,180)`)
		}
	}
	return out.String(), nil
}

func shopClipTextAnimation(name string, duration int64, x, y, distance float64, text bool) string {
	entry, exit := min(int64(180), duration/4), min(int64(140), duration/5)
	position := fmt.Sprintf(`\pos(%.2f,%.2f)`, x, y)
	switch name {
	case "fade":
		return position + fmt.Sprintf(`\fad(%d,%d)`, entry, exit)
	case "rise":
		return fmt.Sprintf(`\move(%.2f,%.2f,%.2f,%.2f,0,%d)\fad(%d,%d)`, x, y+distance, x, y, entry, entry/2, exit)
	case "pop":
		// Text scales around its center; panel geometry stays stable behind it.
		if text {
			return position + fmt.Sprintf(`\fad(%d,%d)\fscx90\fscy90\t(0,%d,\fscx110\fscy110)\t(%d,%d,\fscx100\fscy100)`, entry/3, exit, entry/2, entry/2, entry)
		}
		return position + fmt.Sprintf(`\fad(%d,%d)`, entry/3, exit)
	default:
		return position
	}
}

func shopClipASSShape(out *strings.Builder, start, end int64, x, y float64, color string, alpha int, path, animation string) {
	fmt.Fprintf(out, "Dialogue: -1,%s,%s,Shape,,0,0,0,,{\\an7\\pos(%.2f,%.2f)\\bord0\\shad0\\1c%s\\1a&H%02X&%s\\p1}%s{\\p0}\n", renderASSTime(start), renderASSTime(end), x, y, assColor(color, 0), alpha, animation, path)
}

// Original vector panel with an optional speech tail; no external asset or
// proprietary editor graphics are embedded in rendered videos.
func shopClipRoundedPanel(w, h, radius float64, tail bool) string {
	r := math.Min(radius, math.Min(w, h)/2)
	path := fmt.Sprintf("m %.2f 0 l %.2f 0 b %.2f 0 %.2f %.2f %.2f %.2f l %.2f %.2f b %.2f %.2f %.2f %.2f %.2f %.2f", r, w-r, w, w, r, w, r, w, h-r, w, h, w-r, h, w-r, h)
	if tail {
		path += fmt.Sprintf(" l %.2f %.2f %.2f %.2f %.2f %.2f", w*0.29, h, w*0.23, h+r*0.55, w*0.23, h)
	}
	path += fmt.Sprintf(" l %.2f %.2f b 0 %.2f 0 %.2f 0 %.2f l 0 %.2f b 0 0 %.2f 0 %.2f 0", r, h, h, h-r, h-r, r, r, r)
	return path
}

// Narrow portrait frames have room for more caption lines. Use that space
// before reducing long edited captions to unreadably small glyphs.
func shopClipFitCaption(text string, base float64, width, height int) (string, float64) {
	available := float64(width) * 0.84
	wrapped, fit := shopClipFitText(text, base, available)
	if height <= width || fit >= base*0.75 {
		return wrapped, fit
	}
	lines := strings.Split(wrapped, "\n")
	fit = math.Min(base, float64(height)*0.24/6)
	for i, line := range lines {
		var lineFit float64
		lines[i], lineFit = shopClipFitText(line, base, available)
		fit = math.Min(fit, lineFit)
	}
	return strings.Join(lines, "\n"), fit
}

// Keep at most two display lines without removing text or changing cue timing.
// Conservative glyph widths leave space for CJK fallback fonts and outlines.
func shopClipFitText(text string, base, available float64) (string, float64) {
	runes := []rune(strings.Join(strings.Fields(text), " "))
	weight := shopClipTextWeight
	if len(runes) < 2 || weight(runes)*base <= available {
		return string(runes), base
	}
	best, bestWidth := 1, math.Inf(1)
	// Prefer word boundaries; CJK can wrap between characters. Fall back to a
	// character boundary for long unbroken identifiers so no content is clipped.
	for pass := 0; pass < 2; pass++ {
		for i := 1; i < len(runes); i++ {
			if !shopClipCaptionBoundary(runes, i) {
				continue
			}
			boundary := unicode.IsSpace(runes[i-1]) || unicode.IsSpace(runes[i]) || runes[i-1] > 127 || runes[i] > 127
			if pass == 0 && !boundary {
				continue
			}
			lineWidth := math.Max(weight(runes[:i]), weight(runes[i:]))
			if lineWidth < bestWidth {
				best, bestWidth = i, lineWidth
			}
		}
		if !math.IsInf(bestWidth, 1) {
			break
		}
	}
	if math.IsInf(bestWidth, 1) {
		return string(runes), math.Min(base, available/weight(runes))
	}
	return strings.TrimSpace(string(runes[:best])) + "\n" + strings.TrimSpace(string(runes[best:])), math.Min(base, available/bestWidth)
}

func shopClipTextWeight(values []rune) float64 {
	total := 0.0
	for _, r := range values {
		switch {
		case unicode.IsSpace(r):
			total += 0.4
		case r < 128:
			total += 1.0
		default:
			total += 1.05
		}
	}
	return total
}

// The plan limit applies before escaping. Counting ASS control sequences as
// user characters would truncate the end of otherwise valid 80-character cues.
func escapeShopClipASS(text string) string {
	return strings.NewReplacer("\\", "\\\\", "{", "\\{", "}", "\\}", "\r", "", "\n", "\\N").Replace(text)
}
