import { useCallback, useMemo, useSyncExternalStore } from "react";

import { isTryOnFunction, TRYON_FUNCTIONS, type TryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import type { TryOnMarket } from "@/pages/ecommerce/tryon/tryon-runtime";
import { getActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";

/** 电商模式的生图功能：批量换装的各个功能，加上「对话生图」（一句话 + 可选参考图直接出图）。 */
export type ShopFn = TryOnFunction | "chat";

const FN_STORAGE = "ecs-tryon-function";
const LAST_TRYON = "ecs-tryon-last";
const listeners = new Set<() => void>();

function readStored(key: string) {
    try {
        return window.sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStored(key: string, value: string) {
    try {
        window.sessionStorage.setItem(key, value);
    } catch {
        // 存储不可用时只在内存里记住。
    }
}

let current: ShopFn = (() => {
    const saved = readStored(FN_STORAGE);
    return saved === "chat" || isTryOnFunction(saved) ? saved : "chat";
})();
/** 切到对话生图时，换装草稿仍停在上一次的换装功能上。 */
let lastTryOn: TryOnFunction = (() => {
    const saved = readStored(LAST_TRYON);
    return isTryOnFunction(saved) ? saved : isTryOnFunction(current) ? current : "outfit";
})();

export function setShopFunction(fn: ShopFn) {
    if (current === fn) return;
    current = fn;
    writeStored(FN_STORAGE, fn);
    if (fn !== "chat") {
        lastTryOn = fn;
        writeStored(LAST_TRYON, fn);
    }
    listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const SHOP_MARKET: TryOnMarket = { platform: "taobao", platformLabel: "淘宝", region: "", language: "zh-CN", languageLabel: "简体中文" };

export function useShopScope() {
    return useUserStore((state) => state.user?.id) || getActiveUserScope();
}

export function useAllowedTryOn() {
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const switches = useUserStore((state) => state.features.ecommerceTryOnFunctions);
    return useMemo(() => TRYON_FUNCTIONS.map((item) => item.id).filter((id) => isAdmin || switches?.[id] !== false), [isAdmin, switches]);
}

/**
 * 当前选中的生图功能。mode 是界面上选中的功能（可能是对话生图）；
 * fn 始终是一个换装功能，给批量换装草稿使用。后台关掉的功能自动退回第一个可用功能。
 */
export function useShopFunction() {
    const allowed = useAllowedTryOn();
    const picked = useSyncExternalStore(subscribe, () => current);
    const last = useSyncExternalStore(subscribe, () => lastTryOn);
    const fn: TryOnFunction = allowed.includes(last) ? last : allowed[0] || "outfit";
    const mode: ShopFn = picked === "chat" || !allowed.length ? "chat" : allowed.includes(picked) ? picked : fn;
    const pick = useCallback((next: ShopFn) => (next === "chat" || allowed.includes(next)) && setShopFunction(next), [allowed]);
    return { fn, mode, chat: mode === "chat", allowed, pick };
}
