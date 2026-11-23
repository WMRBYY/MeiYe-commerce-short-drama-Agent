import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { useLocaleStore } from "@/stores/use-locale-store";
import type { AREA_CATALOGS } from "./areas";
import { DEFAULT_LOCALE, type AppLocale } from "./locales";
import { runLocaleTransition } from "./locale-transition";
import { bundle as zhCNBundle } from "./messages/bundles/zh-CN";

type AreaName = keyof typeof AREA_CATALOGS;
type Bundle = Record<string, unknown>;
type LazyLocale = Exclude<AppLocale, "zh-CN">;

// 简体中文是默认语言和回退语言，随首屏同步打包；其余五种语言（合计约 1MB）切换时才下载。
const LAZY_BUNDLES: Record<LazyLocale, () => Promise<{ bundle: Bundle }>> = {
    "en-US": () => import("./messages/bundles/en-US"),
    "fr-FR": () => import("./messages/bundles/fr-FR"),
    "de-DE": () => import("./messages/bundles/de-DE"),
    "ja-JP": () => import("./messages/bundles/ja-JP"),
    "ko-KR": () => import("./messages/bundles/ko-KR"),
};

const zhBundle: Bundle = zhCNBundle;

/** 简体中文区域目录（中文原文索引用）。 */
export function sourceAreaCatalog(area: AreaName): unknown {
    return zhBundle[area];
}

const loading = new Map<AppLocale, Promise<void>>();

/** 确保某种语言的文案已加载进 i18next；简体中文始终已加载。 */
export function ensureLocaleLoaded(locale: AppLocale): Promise<void> {
    if (locale === DEFAULT_LOCALE || i18n.hasResourceBundle(locale, "translation")) return Promise.resolve();
    let pending = loading.get(locale);
    if (!pending) {
        pending = LAZY_BUNDLES[locale as LazyLocale]()
            .then(({ bundle }) => {
                i18n.addResourceBundle(locale, "translation", bundle, true, true);
            })
            .catch((error: unknown) => {
                loading.delete(locale);
                throw error;
            });
        loading.set(locale, pending);
    }
    return pending;
}

/**
 * 应用唯一的 i18next 实例。语言来自 useLocaleStore（本设备偏好，首次按浏览器语言），
 * 缺失的键回退到简体中文，保证未翻译的页面仍可用。中文随包内联、初始化同步完成；其他语言加载完成后再切换。
 */
export const i18n = i18next.createInstance();

const initialLocale = useLocaleStore.getState().locale;

void i18n.use(initReactI18next).init({
    resources: { [DEFAULT_LOCALE]: { translation: zhBundle } },
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
});

function applyLocale(locale: AppLocale) {
    ensureLocaleLoaded(locale).then(
        () => {
            // 加载期间用户可能又切换了语言，只应用最新的选择。
            if (useLocaleStore.getState().locale === locale && i18n.language !== locale) void i18n.changeLanguage(locale);
        },
        (error: unknown) => console.warn("[i18n] 加载语言包失败，继续使用简体中文", locale, error),
    );
}

if (initialLocale !== DEFAULT_LOCALE) applyLocale(initialLocale);

useLocaleStore.subscribe((state, previous) => {
    if (state.locale === previous.locale) return;
    if (state.locale === DEFAULT_LOCALE || i18n.hasResourceBundle(state.locale, "translation")) void i18n.changeLanguage(state.locale);
    else applyLocale(state.locale);
});

/** 当前界面语言；用于 Intl 日期与数字格式化。 */
export function currentLocale(): AppLocale {
    return useLocaleStore.getState().locale;
}

/** 非组件代码（服务层、工具函数）使用的翻译函数。 */
export function translate(key: string, options?: Record<string, unknown>): string {
    return i18n.t(key, options) as string;
}

/**
 * 用户切换界面语言：先加载目标语言文案，再保存偏好并原地更新文案，不刷新页面（输入内容、滚动位置和打开的面板都保留），
 * 配合过渡动画完成切换。组件经 useTranslation 订阅语言变化；模块里的显示文案写成 getter / 函数，读取时取当前语言。
 */
export function switchLocale(next: AppLocale) {
    if (next === currentLocale()) return;
    ensureLocaleLoaded(next).then(
        () => runLocaleTransition(() => useLocaleStore.getState().setLocale(next)),
        (error: unknown) => console.warn("[i18n] 加载语言包失败", next, error),
    );
}
