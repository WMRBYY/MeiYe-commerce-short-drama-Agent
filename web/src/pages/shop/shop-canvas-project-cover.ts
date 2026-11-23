import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";

export type ShopCanvasGeneratedCover = { kind: "image" | "video"; resourceId: string };

/** Saved node order is the fallback order for existing projects; uploaded references are not results. */
export function shopCanvasGeneratedCoverCandidates(nodes: unknown): ShopCanvasGeneratedCover[] {
    if (!Array.isArray(nodes)) return [];
    const covers: ShopCanvasGeneratedCover[] = [];
    const seen = new Set<string>();
    for (const candidate of nodes) {
        if (!candidate || typeof candidate !== "object") continue;
        const node = candidate as Partial<CanvasLayer>;
        if (typeof node.resourceId !== "string" || !node.resourceId.trim() || seen.has(node.resourceId) || node.videoFailed) continue;
        const kind = node.type === "video" && (node.videoProjectId || node.videoTaskId) ? "video" : node.type === "generation" || (node.type === "image" && node.generationKey) ? "image" : null;
        if (!kind) continue;
        covers.push({ kind, resourceId: node.resourceId });
        seen.add(node.resourceId);
    }
    return covers;
}

export function selectShopCanvasGeneratedCover(nodes: unknown): ShopCanvasGeneratedCover | null {
    return shopCanvasGeneratedCoverCandidates(nodes)[0] || null;
}

export type ShopCanvasProjectCover = ShopCanvasGeneratedCover | { kind: "custom"; src: string };
