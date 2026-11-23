package app

import "fmt"

// Presets only select renderer-owned enums and original colors. Neither model
// output nor browser input can supply an ASS tag, font path or FFmpeg expression.
func shopClipTemplates() []ShopClipTemplate {
	common := []string{"koubo", "subtitle", "mix"}
	makeTemplate := func(id, name, description, group string, tags []string, style, animation, filter, transition, widget, layout, fg, bg, accent, font string) ShopClipTemplate {
		modes := append([]string(nil), common...)
		if transition != "cut" || layout == "pip" {
			modes = []string{"mix"}
		}
		return ShopClipTemplate{ID: id, Name: name, Description: description, Group: group, Tags: tags, Modes: modes,
			Visual:  ShopClipVisual{SubtitleStyle: style, Animation: animation, Filter: filter, Transition: transition, Widget: widget, Layout: layout},
			Preview: ShopClipTemplatePreview{Foreground: fg, Background: bg, Accent: accent, Font: font}}
	}
	return []ShopClipTemplate{
		makeTemplate("clean", "清晰讲述", "白字细描边，保留真实画面与自然口播。", "通用口播", []string{"清晰", "日常"}, "outline", "none", "original", "cut", "none", "full", "#FFFFFF", "#151923", "#C5D3F0", "sans"),
		makeTemplate("bold", "重点直给", "粗体白字配短促入场，让表达更有分量。", "通用口播", []string{"重点", "测评"}, "solid", "rise", "crisp", "cut", "underline", "full", "#FFFFFF", "#171717", "#FFD45C", "sans-bold"),
		makeTemplate("pop", "节奏强调", "弹性字幕、原话重点贴纸与轻微镜头推进。", "通用口播", []string{"节奏", "观点"}, "solid", "pop", "original", "cut", "label", "full", "#FFFFFF", "#161616", "#FFD400", "sans-bold"),
		makeTemplate("editorial", "编辑手记", "宋体字幕与纤细线条，适合慢讲和深度介绍。", "质感叙事", []string{"人文", "书籍"}, "serif", "fade", "original", "cut", "underline", "full", "#F6F1E7", "#25231E", "#D8C29C", "serif"),
		makeTemplate("luxury", "鎏金细节", "米金色字、柔和画面与克制角标，突出材质。", "质感叙事", []string{"饰品", "高质感"}, "serif", "fade", "soft", "cut", "corner", "full", "#F3E4C5", "#211E19", "#DAB66F", "serif"),
		makeTemplate("beauty", "柔光试色", "粉色半透明字幕底板，配柔和色调和轻盈入场。", "品类灵感", []string{"美妆", "护肤"}, "panel", "rise", "soft", "cut", "none", "full", "#FFF4F7", "#502A3D", "#F6A8C4", "sans"),
		makeTemplate("food", "热气上桌", "暖色画面与奶油色字幕卡，保留食物细节。", "品类灵感", []string{"食品", "餐饮"}, "highlight", "pop", "warm", "cut", "none", "full", "#302018", "#FFDEA8", "#E89451", "sans-bold"),
		makeTemplate("tech", "参数有据", "冷色字幕面板与进度线，适合功能演示和实测。", "品类灵感", []string{"数码", "家电"}, "panel", "fade", "cool", "cut", "progress", "full", "#E7F8FF", "#152B3C", "#6DCEEC", "sans-bold"),
		makeTemplate("home", "住进日常", "暖白细字与自然淡入，让生活场景成为主角。", "品类灵感", []string{"家居", "生活"}, "outline", "fade", "warm", "cut", "corner", "full", "#FFF6E6", "#403B31", "#D4BE97", "sans"),
		makeTemplate("sport", "状态拉满", "清晰锐化、粗体重点和荧光下划线。", "品类灵感", []string{"运动", "户外"}, "solid", "pop", "crisp", "cut", "underline", "full", "#F4FFE9", "#1F2C1D", "#C3F55D", "sans-bold"),
		makeTemplate("kids", "轻松开讲", "淡紫圆角气泡与柔和动效，适合亲子与趣味分享。", "品类灵感", []string{"母婴", "亲子"}, "bubble", "rise", "original", "cut", "none", "full", "#392C4E", "#EDE0FF", "#C4A0F0", "sans"),
		makeTemplate("bubble", "聊点有趣", "青色对话气泡与弹性入场，让口播更有亲近感。", "花字与气泡", []string{"气泡", "分享"}, "bubble", "pop", "original", "cut", "none", "full", "#143638", "#C8F3ED", "#69CAB8", "sans-bold"),
		makeTemplate("label", "观点便签", "黄色重点卡配原话标签，适合经验与清单分享。", "花字与气泡", []string{"观点", "经验"}, "highlight", "rise", "original", "cut", "label", "full", "#332D1B", "#FFE79F", "#FFC857", "sans-bold"),
		makeTemplate("documentary", "纪实旁白", "黑白画面、留白宋体与平稳字幕，突出叙述。", "质感叙事", []string{"纪实", "故事"}, "serif", "none", "mono", "cut", "none", "full", "#F1EFE9", "#242424", "#C7C7C7", "serif"),
		makeTemplate("film", "暖调独白", "暖色影像与深色半透明底板，让旁白清楚耐看。", "质感叙事", []string{"旅行", "独白"}, "panel", "fade", "warm", "cut", "none", "full", "#F6E9D0", "#33281E", "#C9A47B", "serif"),
		makeTemplate("neon", "夜色霓虹", "冷调影像、青色粗体与紫色重点线。", "花字与气泡", []string{"潮流", "音乐"}, "solid", "rise", "cool", "cut", "underline", "full", "#AEF4FF", "#18233D", "#C3A2FF", "sans-bold"),
		makeTemplate("mint", "薄荷清单", "薄荷色字幕卡与进度线，适合步骤讲解。", "花字与气泡", []string{"步骤", "清单"}, "highlight", "fade", "original", "cut", "progress", "full", "#204137", "#D8F1DF", "#78B79B", "sans"),
		makeTemplate("warm-corner", "手作温度", "暖调宋体与细小边角线，表现手作和工艺。", "品类灵感", []string{"手作", "工艺"}, "serif", "rise", "warm", "cut", "corner", "full", "#FFEACB", "#473326", "#DAA465", "serif"),
		makeTemplate("mix-dissolve", "流动叙事", "辅助画面柔和叠化，主视频人声持续保留。", "智能混剪", []string{"叠化", "辅助画面"}, "outline", "fade", "soft", "dissolve", "none", "full", "#FFFFFF", "#25252B", "#AEBFE5", "sans"),
		makeTemplate("pip-review", "同屏实测", "辅助画面滑入右侧小窗，人声与主画面连续呈现。", "智能混剪", []string{"画中画", "测评"}, "panel", "rise", "original", "slide", "progress", "pip", "#FFFFFF", "#1B2835", "#6EC5DF", "sans-bold"),
	}
}

func resolveShopClipVisual(templateID string, visual ShopClipVisual) (ShopClipTemplate, ShopClipVisual, error) {
	if templateID == "" {
		templateID = "clean"
	}
	var template ShopClipTemplate
	for _, candidate := range shopClipTemplates() {
		if candidate.ID == templateID {
			template = candidate
			break
		}
	}
	if template.ID == "" {
		return template, visual, fmt.Errorf("剪辑模板不存在")
	}
	resolved := template.Visual
	fields := []struct {
		value   string
		dest    *string
		allowed []string
	}{
		{visual.SubtitleStyle, &resolved.SubtitleStyle, []string{"outline", "solid", "panel", "highlight", "serif", "bubble"}},
		{visual.Animation, &resolved.Animation, []string{"none", "fade", "rise", "pop"}},
		{visual.Filter, &resolved.Filter, []string{"original", "warm", "cool", "soft", "crisp", "mono"}},
		{visual.Transition, &resolved.Transition, []string{"cut", "dissolve", "slide"}},
		{visual.Widget, &resolved.Widget, []string{"none", "label", "underline", "corner", "progress"}},
		{visual.Layout, &resolved.Layout, []string{"full", "pip"}},
	}
	for _, field := range fields {
		if field.value == "" {
			continue
		}
		valid := false
		for _, allowed := range field.allowed {
			valid = valid || field.value == allowed
		}
		if !valid {
			return template, visual, fmt.Errorf("剪辑视觉参数无效，请重新选择样式")
		}
		*field.dest = field.value
	}
	return template, resolved, nil
}

func validateShopClipVisual(templateID string, visual ShopClipVisual, mode string) error {
	template, resolved, err := resolveShopClipVisual(templateID, visual)
	if err != nil {
		return err
	}
	if mode == "behind" {
		if (template.ID != "clean" && template.ID != "bold" && template.ID != "pop") || visual != (ShopClipVisual{}) {
			return fmt.Errorf("字在人后暂不支持附加视觉样式")
		}
		return nil
	}
	allowed := false
	for _, candidate := range template.Modes {
		allowed = allowed || candidate == mode
	}
	if !allowed || (mode != "mix" && (resolved.Transition != "cut" || resolved.Layout != "full")) {
		return fmt.Errorf("叠化、滑入和画中画需在智能混剪中使用")
	}
	return nil
}
