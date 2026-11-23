import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 工作台模式：创作（默认首页）、电商、短剧。左上角品牌区下拉切换，各模式有自己的侧栏与首页。 */
export type WorkspaceMode = "create" | "ecommerce" | "drama";

export const WORKSPACE_MODE_HOME: Record<WorkspaceMode, string> = { create: "/", ecommerce: "/shop", drama: "/drama" };

const VALID: WorkspaceMode[] = ["create", "ecommerce", "drama"];

type Store = { mode: WorkspaceMode; setMode: (mode: WorkspaceMode) => void };

export const useWorkspaceModeStore = create<Store>()(
    persist(
        (set) => ({
            mode: "create",
            setMode: (mode) => set((state) => (VALID.includes(mode) && state.mode !== mode ? { mode } : state)),
        }),
        {
            name: "meiye:workspace_mode",
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<Store>;
                return { ...current, mode: VALID.includes(stored.mode as WorkspaceMode) ? (stored.mode as WorkspaceMode) : "create" };
            },
        },
    ),
);

/** 地址明确属于某个模式时返回该模式；共用页面（画布、资产等）返回 null，沿用当前模式。 */
export function modeFromPath(pathname: string): WorkspaceMode | null {
    if (pathname === "/" || pathname === "/create") return "create";
    if (pathname === "/shop" || pathname.startsWith("/shop/")) return "ecommerce";
    if (pathname === "/drama" || pathname.startsWith("/drama/")) return "drama";
    return null;
}
