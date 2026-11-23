package app

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

type RenderTextDesign struct {
	Font    string `json:"font"`
	Primary string `json:"primary"`
	Accent  string `json:"accent"`
	Layout  string `json:"layout"`
	Reason  string `json:"reason"`
}

type RenderOverlayCue struct {
	StartMs  int64  `json:"startMs"`
	EndMs    int64  `json:"endMs"`
	Text     string `json:"text"`
	Kind     string `json:"kind"`
	Position string `json:"position"`
}

type renderFontFace struct {
	family string
	bold   int
	files  []string
	serif  bool
}

var renderFontDirs = []string{
	filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "noto"),
	filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "noto-cjk"),
	filepath.Join(string(os.PathSeparator), "usr", "share", "fonts", "truetype", "noto"),
}

var renderTextFonts = map[string][]renderFontFace{
	"sans-black":  {{"Noto Sans CJK SC Black", 0, []string{"NotoSansCJK-Black.ttc"}, false}, {"Noto Sans CJK SC", -1, []string{"NotoSansCJK-Bold.ttc"}, false}},
	"sans-bold":   {{"Noto Sans CJK SC", -1, []string{"NotoSansCJK-Bold.ttc", "NotoSansCJK-Regular.ttc"}, false}},
	"sans-light":  {{"Noto Sans CJK SC Light", 0, []string{"NotoSansCJK-Light.ttc"}, false}, {"Noto Sans CJK SC", 0, []string{"NotoSansCJK-Regular.ttc"}, false}},
	"serif-black": {{"Noto Serif CJK SC Black", 0, []string{"NotoSerifCJK-Black.ttc"}, true}, {"Noto Serif CJK SC", -1, []string{"NotoSerifCJK-Bold.ttc"}, true}},
	"serif-bold":  {{"Noto Serif CJK SC", -1, []string{"NotoSerifCJK-Bold.ttc", "NotoSerifCJK-Regular.ttc"}, true}},
	"serif-light": {{"Noto Serif CJK SC Light", 0, []string{"NotoSerifCJK-Light.ttc"}, true}, {"Noto Serif CJK SC", 0, []string{"NotoSerifCJK-Regular.ttc"}, true}},
}

func renderValidTextFont(font string) bool {
	_, ok := renderTextFonts[font]
	return ok
}

func renderValidOverlayPosition(position string) bool {
	switch position {
	case "top", "center", "upper-left", "upper-right":
		return true
	}
	return false
}

var renderHexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func normalizeRenderTextDesign(in *RenderTextDesign) *RenderTextDesign {
	if in == nil {
		return nil
	}
	out := RenderTextDesign{
		Font: strings.TrimSpace(in.Font), Primary: strings.ToUpper(strings.TrimSpace(in.Primary)), Accent: strings.ToUpper(strings.TrimSpace(in.Accent)),
		Layout: clipText(strings.TrimSpace(in.Layout), 300), Reason: clipText(strings.TrimSpace(in.Reason), 300),
	}
	if !renderValidTextFont(out.Font) {
		out.Font = "sans-bold"
	}
	if !renderHexColor.MatchString(out.Primary) {
		out.Primary = "#FFFFFF"
	}
	if !renderHexColor.MatchString(out.Accent) {
		out.Accent = "#FFD400"
	}
	return &out
}

func renderFontFileExists(name string) bool {
	for _, dir := range renderFontDirs {
		if info, err := os.Stat(filepath.Join(dir, name)); err == nil && info.Size() > 0 {
			return true
		}
	}
	return false
}

func renderTextFace(font string) (string, int, error) {
	faces, ok := renderTextFonts[font]
	if !ok {
		faces = renderTextFonts["sans-bold"]
	}
	for _, face := range faces {
		for _, file := range face.files {
			if renderFontFileExists(file) {
				return face.family, face.bold, nil
			}
		}
	}
	base := map[bool]string{true: "serif", false: "sans"}[faces[0].serif]
	family, err := renderCaptionFamily(base, "clean")
	if err != nil {
		return "", 0, err
	}
	return family, map[bool]int{true: 0, false: -1}[strings.HasSuffix(font, "light")], nil
}

func renderSubtitleFont(plan *RenderCaptionPlan) string {
	switch plan.Font {
	case "sans":
		return "sans-bold"
	case "serif":
		return "serif-bold"
	}
	if plan.Design != nil && renderValidTextFont(plan.Design.Font) {
		return strings.Replace(plan.Design.Font, "-black", "-bold", 1)
	}
	if plan.Style == "editorial" {
		return "serif-light"
	}
	return "sans-bold"
}

func renderSubtitleStyle(plan *RenderCaptionPlan) string {
	if plan.Style != "" && plan.Style != "auto" {
		return plan.Style
	}
	if plan.Design != nil {
		switch {
		case plan.Design.Font == "sans-black" || plan.Design.Font == "serif-black":
			return "bold"
		case strings.HasSuffix(plan.Design.Font, "light"):
			return "editorial"
		}
	}
	return "clean"
}

func assColor(hex string, alpha int) string {
	r, g, b := renderRGB(hex)
	return fmt.Sprintf("&H%02X%02X%02X%02X", alpha, b, g, r)
}

func renderRGB(hex string) (int64, int64, int64) {
	if !renderHexColor.MatchString(hex) {
		return 255, 255, 255
	}
	r, _ := strconv.ParseInt(hex[1:3], 16, 64)
	g, _ := strconv.ParseInt(hex[3:5], 16, 64)
	b, _ := strconv.ParseInt(hex[5:7], 16, 64)
	return r, g, b
}

func renderLuminance(hex string) float64 {
	r, g, b := renderRGB(hex)
	channel := func(v int64) float64 {
		c := float64(v) / 255
		if c <= 0.03928 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(r) + 0.7152*channel(g) + 0.0722*channel(b)
}

func renderContrast(a, b string) float64 {
	la, lb := renderLuminance(a), renderLuminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

func renderReadableOn(text, background string) string {
	if renderContrast(text, background) >= 3 {
		return text
	}
	if renderContrast("#111111", background) >= renderContrast("#FFFFFF", background) {
		return "#111111"
	}
	return "#FFFFFF"
}

func renderOverlayAlignment(position string) int {
	switch position {
	case "center":
		return 5
	case "upper-left":
		return 7
	case "upper-right":
		return 9
	}
	return 8
}

func renderOverlayStyles(design *RenderTextDesign, overlays []RenderOverlayCue, width, height int) (string, error) {
	if len(overlays) == 0 {
		return "", nil
	}
	if design == nil {
		design = normalizeRenderTextDesign(&RenderTextDesign{})
	}
	family, bold, err := renderTextFace(design.Font)
	if err != nil {
		return "", err
	}
	longest := map[string]int{}
	for _, cue := range overlays {
		longest[cue.Kind] = max(longest[cue.Kind], utf8.RuneCountInString(cue.Text))
	}
	fit := func(kind string, base int) int {
		runes := max(longest[kind], 4)
		return max(28, min(base, int(float64(width)*0.82/float64(runes))))
	}
	side, top := max(40, width/18), max(90, height/8)
	hookOutline := "#111111"
	if renderContrast(design.Primary, design.Accent) >= 3 {
		hookOutline = design.Accent
	}
	boxText := renderReadableOn(design.Primary, design.Accent)
	var out strings.Builder

	fmt.Fprintf(&out, "Style: Hook,%s,%d,%s,%s,%s,&H78000000,%d,0,1,%d,3,8,%d,%d,%d,1\n", family, fit("hook", max(48, height/12)), assColor(design.Primary, 0), assColor(design.Primary, 0), assColor(hookOutline, 0), bold, max(3, height/320), side, side, top)

	fmt.Fprintf(&out, "Style: Point,%s,%d,%s,%s,%s,&H64000000,%d,0,3,%d,0,8,%d,%d,%d,1\n", family, fit("point", max(32, height/24)), assColor(boxText, 0), assColor(boxText, 0), assColor(design.Accent, 16), bold, max(8, height/110), side, side, top)
	fmt.Fprintf(&out, "Style: Cta,%s,%d,%s,%s,%s,&H64000000,%d,0,3,%d,0,8,%d,%d,%d,1\n", family, fit("cta", max(36, height/20)), assColor(boxText, 0), assColor(boxText, 0), assColor(design.Accent, 0), bold, max(10, height/96), side, side, top)
	return out.String(), nil
}

func renderOverlayEvent(cue RenderOverlayCue) string {
	style, effect := "Point", `\fad(160,160)\fscx70\t(0,180,\fscx104)\t(180,260,\fscx100)`
	switch cue.Kind {
	case "hook":
		style, effect = "Hook", `\fad(80,200)\fscx55\fscy55\t(0,200,\fscx110\fscy110)\t(200,320,\fscx100\fscy100)`
	case "cta":
		style, effect = "Cta", `\fad(120,0)\fscx60\fscy60\t(0,220,\fscx108\fscy108)\t(220,340,\fscx100\fscy100)`
	}
	return fmt.Sprintf("Dialogue: 1,%s,%s,%s,,0,0,0,,{\\an%d%s}%s\n", renderASSTime(cue.StartMs), renderASSTime(cue.EndMs), style, renderOverlayAlignment(cue.Position), effect, escapeRenderASS(cue.Text))
}
