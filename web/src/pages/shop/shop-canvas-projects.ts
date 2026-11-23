import { localForageStorageForScope } from "@/lib/localforage-storage";
import { shopCanvasGeneratedCoverCandidates } from "./shop-canvas-project-cover";

export type ShopCanvasProject = { id: string; name: string; updatedAt: string; coverKey?: string };

export const SHOP_CANVAS_SNAPSHOT_SAVED = "shop-canvas-snapshot-saved";

export function shopCanvasProjectLayerKey(userId: string, projectId: string) {
    return `ecommerce-canvas:shop-canvas:${userId}:${projectId}`;
}

export function shopCanvasCoverCandidates(value: unknown) {
    return shopCanvasGeneratedCoverCandidates(value).map((cover) => cover.resourceId);
}

export async function readShopCanvasCoverCandidates(scope: string, storageKey: string) {
    const raw = (await localForageStorageForScope(scope).getItem(storageKey)) ?? localStorage.getItem(storageKey);
    return shopCanvasCoverCandidates(raw ? JSON.parse(raw) : []);
}

const key = (userId: string) => `shop-canvas-projects:${userId}`;

export function readShopCanvasProjects(userId: string): ShopCanvasProject[] {
    try {
        const saved = localStorage.getItem(key(userId));
        if (!saved) {
            const legacyLayers = localStorage.getItem(`ecommerce-canvas:shop-canvas:${userId}`);
            if (legacyLayers) {
                const legacyProject: ShopCanvasProject = { id: crypto.randomUUID(), name: localStorage.getItem(`shop-canvas-title:${userId}`) || "未命名画布", updatedAt: new Date().toISOString() };
                localStorage.setItem(`ecommerce-canvas:shop-canvas:${userId}:${legacyProject.id}`, legacyLayers);
                saveShopCanvasProjects(userId, [legacyProject]);
                return [legacyProject];
            }
        }
        const value: unknown = JSON.parse(saved || "[]");
        return Array.isArray(value) ? value.filter((item): item is ShopCanvasProject => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && typeof item.updatedAt === "string")) : [];
    } catch {
        return [];
    }
}

export function saveShopCanvasProjects(userId: string, projects: ShopCanvasProject[]) {
    localStorage.setItem(key(userId), JSON.stringify(projects));
}
