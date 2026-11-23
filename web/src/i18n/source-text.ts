import type { AREA_CATALOGS } from "./areas";
import { currentLocale, sourceAreaCatalog, translate } from "./index";
import { DEFAULT_LOCALE } from "./locales";

type AreaName = keyof typeof AREA_CATALOGS;

const indexes = new Map<AreaName, Map<string, string>>();

/** 把区域源语言目录展开成「中文原文 → 完整键」；同一原文出现多次时取第一个键。 */
function buildIndex(area: AreaName): Map<string, string> {
    const index = new Map<string, string>();
    const visit = (value: unknown, path: string) => {
        if (typeof value === "string") {
            if (!index.has(value)) index.set(value, path);
            return;
        }
        if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    };
    visit(sourceAreaCatalog(area), area);
    return index;
}

/**
 * 按中文原文取当前语言的显示文案。
 * 配置数据里的中文同时用于提示词、接口参数或业务判断时，数据本身保持中文，只在显示处调用本函数；
 * 对应译文登记在该区域目录里（值与原文完全一致）。当前为简体中文或目录里没有该原文时原样返回。
 */
export function translateSourceText(area: AreaName, text: string): string {
    if (!text || currentLocale() === DEFAULT_LOCALE) return text;
    let index = indexes.get(area);
    if (!index) {
        index = buildIndex(area);
        indexes.set(area, index);
    }
    const key = index.get(text);
    return key ? translate(key) : text;
}
