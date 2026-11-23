import { translateSourceText } from "@/i18n/source-text";

/**
 * 电商配置数据（类型、版位、营销素材、平台风格、场景、创作选项等）的显示名。
 * 这些中文同时进入策划提示词和草稿参数，数据保持中文；界面显示时经这里换成当前语言。
 */
export function ecommerceText(text: string): string {
    return translateSourceText("ecommerceData", text);
}
