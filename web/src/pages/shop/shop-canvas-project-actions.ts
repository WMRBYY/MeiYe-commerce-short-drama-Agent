import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import { readShopCanvasProjects, saveShopCanvasProjects, shopCanvasProjectLayerKey, type ShopCanvasProject } from "./shop-canvas-projects";
import { cloneWorkflowNodes } from "./shop-canvas-workflows";
import { shopCanvasGeneratedCoverCandidates, type ShopCanvasProjectCover } from "./shop-canvas-project-cover";

export async function readCanvasProjectCovers(scope: string, userId: string, project: ShopCanvasProject): Promise<ShopCanvasProjectCover[]> {
    const storage = localForageStorageForScope(scope);
    const key = shopCanvasProjectLayerKey(userId, project.id);
    const [manual, generated] = await Promise.all([
        project.coverKey ? Promise.resolve(storage.getItem(project.coverKey)).catch(() => null) : null,
        Promise.resolve(storage.getItem(key))
            .then((raw) => shopCanvasGeneratedCoverCandidates(JSON.parse(raw ?? localStorage.getItem(key) ?? "[]")))
            .catch(() => []),
    ]);
    return [...(manual ? [{ kind: "custom" as const, src: manual }] : []), ...generated];
}

export async function duplicateCanvasProject(scope: string, userId: string, source: ShopCanvasProject) {
    const storage = localForageStorageForScope(scope);
    const raw = await storage.getItem(`ecommerce-canvas:shop-canvas:${userId}:${source.id}`);
    const nodes: CanvasLayer[] = JSON.parse(raw || localStorage.getItem(`ecommerce-canvas:shop-canvas:${userId}:${source.id}`) || "[]");
    const saved = await storage.getItem(`shop-canvas-drafts:${source.id}`);
    const drafts = new Map<string, unknown>(JSON.parse(saved || "[]"));
    const snapshot = nodes.map((node) => ({ ...node, config: drafts.get(node.id) || node.config }));
    const project = { ...source, id: crypto.randomUUID(), name: `${source.name} 副本`, updatedAt: new Date().toISOString() };
    await storage.setItem(`ecommerce-canvas:shop-canvas:${userId}:${project.id}`, JSON.stringify(cloneWorkflowNodes(snapshot)));
    saveShopCanvasProjects(userId, [project, ...readShopCanvasProjects(userId)]);
    return project;
}

/** Store a bounded thumbnail in IndexedDB; metadata in localStorage never contains image bytes. */
export async function saveCanvasCover(scope: string, file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPG 或 WebP 图片");
    if (file.size > 10 * 1024 * 1024) throw new Error("封面图片不能超过 10 MB");
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法读取图片，请换一张图片重试");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const coverKey = `shop-canvas-cover:${crypto.randomUUID()}`;
        await localForageStorageForScope(scope).setItem(coverKey, canvas.toDataURL("image/webp", 0.86));
        return coverKey;
    } finally {
        bitmap.close();
    }
}
