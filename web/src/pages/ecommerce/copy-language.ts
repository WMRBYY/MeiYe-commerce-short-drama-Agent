import type { EcommerceDraft } from "@/services/api/ecommerce";

import { labelOf, languages, platforms } from "./catalog";

/** 文案语言的英文名，给生图模型看的那一半（中文标签 + 英文名同时写，模型更不容易混用）。 */
const ENGLISH_NAMES: Record<string, string> = {
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    ru: "Russian",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    ar: "Arabic",
};

function languageName(language: string) {
    const label = labelOf(languages, language);
    const english = ENGLISH_NAMES[language];
    return english ? `${label}（${english}）` : label;
}

/**
 * 策划阶段的文案语言硬性要求：用户在「平台与语言」里选的语言必须落到每一张的 copy 上。
 * 规划提示词里的字数规则是按中文写的，非中文时这里给出等效长度，避免模型把它理解成「要写中文」。
 */
export function commercePlannerLanguageRule(draft: Pick<EcommerceDraft, "language" | "platform" | "region">) {
    const platform = labelOf(platforms, draft.platform);
    if (!draft.language || draft.language === "auto") {
        return `文案语言（硬性）：用户选择「自动识别目标市场」，按 ${platform}${draft.region ? ` / ${draft.region}` : ""} 目标市场消费者的主要语言撰写全部 copy；国内平台用简体中文，跨境平台用当地语言（不确定时用英文），整套统一一种语言，不中外混排。`;
    }
    if (draft.language === "zh-CN") return "文案语言（硬性）：全部 copy 使用简体中文。";
    const name = languageName(draft.language);
    return `文案语言（硬性，优先于其他文案示例）：用户为 ${platform} 选择了 ${name}，每一张的 copy 必须全部用 ${name} 撰写，不得出现中文或其他语言（商品本身印刷的品牌名、型号原文除外）。上面「中文主标题4–10字」等字数规则按等效长度换算：主标题 2–6 个词，副标题不超过 10 个词，说明不超过 16 个词，短标签 1–3 个词；用目标市场消费者的自然表达，不要逐字直译中文。productSummary、visualStrategy、prompt 等内部字段仍可用中文。`;
}

/** 出图阶段：画面上新增文字的语言。和策划阶段一致，防止生图模型把已写好的外文文案再翻成中文或混入中文装饰字。 */
export function commerceImageLanguageRule(draft: Pick<EcommerceDraft, "language">) {
    if (!draft.language || draft.language === "auto" || draft.language === "zh-CN") return "";
    const name = languageName(draft.language);
    return `【文字语言·硬性】画面上所有新增文字一律使用 ${name}，按上面文案原样排版；不得出现任何中文字符或其他语言的装饰字（商品本身印刷的原文保持原样）。All added on-image text must be in ${ENGLISH_NAMES[draft.language] || name} only — no Chinese characters.`;
}
