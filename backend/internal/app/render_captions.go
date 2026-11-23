package app

import (
	"fmt"

	"os"

	"path/filepath"

	"strings"

	"unicode/utf8"
)

type RenderCaptionCue struct {
	StartMs int64  `json:"startMs"`
	EndMs   int64  `json:"endMs"`
	Text    string `json:"text"`
}

type RenderCaptionPlan struct {
	Style    string            `json:"style"`
	Font     string            `json:"font,omitempty"`
	Cues     []RenderCaptionCue `json:"cues"`
	Design   *RenderTextDesign  `json:"design,omitempty"`
	Overlays []RenderOverlayCue `json:"overlays,omitempty"`
}

func renderCaptionASS(plan *RenderCaptionPlan, width, height int) (string, error) {
	if plan == nil || (len(plan.Cues) == 0 && len(plan.Overlays) == 0) {
		return "", nil
	}
	family, bold, err := renderTextFace(renderSubtitleFont(plan))
	if err != nil {
		return "", err
	}
	size := max(32, height/24)
	outline, margin := 2, max(54, height/16)
	switch renderSubtitleStyle(plan) {
	case "editorial":
		size, outline, margin = max(29, height/29), 1, max(80, height/10)
		if bold < 0 {
			bold = 0
		}
	case "bold":
		size, outline, margin = max(38, height/19), 3, max(60, height/15)
	}
	overlayStyles, err := renderOverlayStyles(plan.Design, plan.Overlays, width, height)
	if err != nil {
		return "", err
	}
	var out strings.Builder
	fmt.Fprintf(&out, "[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n", width, height)
	fmt.Fprintf(&out, "Style: Default,%s,%d,&H00FFFFFF,&H00FFFFFF,&HCC101010,&H66000000,%d,0,1,%d,0,2,%d,%d,%d,1\n", family, size, bold, outline, margin, margin, margin)
	out.WriteString(overlayStyles)
	out.WriteString("\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	for _, cue := range plan.Cues {
		if cue.EndMs <= cue.StartMs || strings.TrimSpace(cue.Text) == "" {
			continue
		}
		fmt.Fprintf(&out, "Dialogue: 0,%s,%s,Default,,0,0,0,,%s\n", renderASSTime(cue.StartMs), renderASSTime(cue.EndMs), escapeRenderASS(cue.Text))
	}
	for _, cue := range plan.Overlays {
		if cue.EndMs <= cue.StartMs || strings.TrimSpace(cue.Text) == "" {
			continue
		}
		out.WriteString(renderOverlayEvent(cue))
	}
	return out.String(), nil
}

func renderCaptionFamily(font, style string) (string, error) {
	_, serif := renderCaptionFamilyName(font, style)
	candidates := []struct{ family, path string }{}
	if serif {
		candidates = append(candidates,
			struct{ family, path string }{"Noto Serif CJK SC", filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "noto", "NotoSerifCJK-Regular.ttc")},
			struct{ family, path string }{"Noto Serif CJK SC", filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "noto-cjk", "NotoSerifCJK-Regular.ttc")},
			struct{ family, path string }{"Noto Serif CJK SC", filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "truetype", "noto", "NotoSerifCJK-Regular.ttc")},
			struct{ family, path string }{"SimSun", `C:\Windows\Fonts\simsun.ttc`},
		)
	} else {
		candidates = append(candidates,
			struct{ family, path string }{"Noto Sans CJK SC", filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "noto", "NotoSansCJK-Regular.ttc")},
			struct{ family, path string }{"Noto Sans CJK SC", filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "noto-cjk", "NotoSansCJK-Regular.ttc")},
			struct{ family, path string }{"Noto Sans CJK SC", filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "truetype", "noto", "NotoSansCJK-Regular.ttc")},
			struct{ family, path string }{"Microsoft YaHei", `C:\Windows\Fonts\msyh.ttc`},
			struct{ family, path string }{"Microsoft YaHei", `C:\Windows\Fonts\msyh.ttf`},
		)
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate.path); err == nil && info.Size() > 0 {
			return candidate.family, nil
		}
	}
	return "", fmt.Errorf("selected CJK subtitle font is unavailable")
}

func renderCaptionFamilyName(font, style string) (string, bool) {
	serif := font == "serif" || (font == "auto" && style == "editorial")
	if serif {
		return "Noto Serif CJK SC", true
	}
	return "Noto Sans CJK SC", false
}

func renderASSTime(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	cs := (ms % 1000) / 10
	seconds := ms / 1000
	return fmt.Sprintf("%d:%02d:%02d.%02d", seconds/3600, seconds/60%60, seconds%60, cs)
}

func escapeRenderASS(value string) string {
	value = strings.NewReplacer("\\", "\\\\", "{", "\\{", "}", "\\}", "\r", "", "\n", "\\N").Replace(value)
	if utf8.RuneCountInString(value) > 80 {
		value = string([]rune(value)[:80])
	}
	return value
}
