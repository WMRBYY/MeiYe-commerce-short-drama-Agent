import { scopedLocalStorage } from "@/lib/user-scope";

import type { ToolbarId, ToolbarPrefs } from "./tool-definition";

const storageKey = (toolbar: ToolbarId, version = toolbar === "selection" ? "v2" : "v1") => `canvas-toolbar-prefs-${toolbar}-${version}`;

export const CANVAS_MODE_TOOL_ID = "tool-canvas-mode";
export const LEGACY_CANVAS_MODE_TOOL_IDS = ["tool-move", "tool-box-select"] as const;

/**
 * 读取工具栏偏好。缺失或解析失败时返回 null（由调用方决定是否用默认值）
 */
export function readToolbarPrefs(toolbar: ToolbarId): ToolbarPrefs | null {
    try {
        const stored = scopedLocalStorage.getItem(storageKey(toolbar));
        const legacySelectionPrefs = toolbar === "selection" && !stored ? scopedLocalStorage.getItem(storageKey(toolbar, "v1")) : null;
        const raw = stored ?? legacySelectionPrefs;
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!isPrefsShape(parsed)) return null;
        const prefs: ToolbarPrefs = { order: Array.isArray(parsed.order) ? parsed.order.filter((id) => typeof id === "string") : [], hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((id) => typeof id === "string") : [] };
        if (legacySelectionPrefs) {
            // V1 defaults hid the grid tool. Show it once for existing users; V2 keeps later visibility choices.
            prefs.hidden = prefs.hidden.filter((id) => id !== "selection-arrange-grid");
            persistToolbarPrefs(toolbar, prefs);
        }
        return migrateToolbarPrefs(toolbar, prefs);
    } catch {
        return null;
    }
}

export function persistToolbarPrefs(toolbar: ToolbarId, prefs: ToolbarPrefs) {
    try {
        scopedLocalStorage.setItem(storageKey(toolbar), JSON.stringify(prefs));
    } catch {
        // 浏览器禁用本地存储时保留当前会话内的选择
    }
}

export function clearToolbarPrefs(toolbar: ToolbarId) {
    try {
        scopedLocalStorage.removeItem(storageKey(toolbar));
        if (toolbar === "selection") scopedLocalStorage.removeItem(storageKey(toolbar, "v1"));
    } catch {
        // 忽略
    }
}

function isPrefsShape(value: unknown): value is Partial<ToolbarPrefs> {
    return typeof value === "object" && value !== null;
}

/** 把旧的抓手/框选两个独立按钮偏好合并成一个开关项 */
export function migrateToolbarPrefs(toolbar: ToolbarId, prefs: ToolbarPrefs): ToolbarPrefs {
    if (toolbar !== "main") return prefs;
    const legacyIds = new Set<string>(LEGACY_CANVAS_MODE_TOOL_IDS);
    const hasLegacy = prefs.order.some((id) => legacyIds.has(id)) || prefs.hidden.some((id) => legacyIds.has(id));
    if (!hasLegacy) return prefs;

    const order = prefs.order.filter((id) => id !== CANVAS_MODE_TOOL_ID && !legacyIds.has(id));
    const firstLegacyIndex = prefs.order.findIndex((id) => legacyIds.has(id));
    const insertAt = firstLegacyIndex >= 0 ? Math.min(firstLegacyIndex, order.length) : 0;
    order.splice(insertAt, 0, CANVAS_MODE_TOOL_ID);

    const hiddenLegacy = LEGACY_CANVAS_MODE_TOOL_IDS.filter((id) => prefs.hidden.includes(id));
    const hidden = prefs.hidden.filter((id) => id !== CANVAS_MODE_TOOL_ID && !legacyIds.has(id));
    if (hiddenLegacy.length === LEGACY_CANVAS_MODE_TOOL_IDS.length) hidden.push(CANVAS_MODE_TOOL_ID);

    return { order, hidden };
}
