import { localForageStorageForScope } from "@/lib/localforage-storage";
import { canvasNodeMentionToken } from "@/lib/canvas/canvas-resource-references";
import { reconcileCommerceLinks, type CommerceGraphNode } from "./shop-canvas-graph";
import type { WorkbenchVideoNodeDraft } from "@/pages/workbench/workbench-video-node";

export type ShopCanvasVideoSubmission = { id: string; draft: WorkbenchVideoNodeDraft; taskId?: string };

export function shopCanvasVideoSubmissionKey(storageKey: string, nodeId: string) {
    return `shop-canvas-video:${storageKey}:${nodeId}`;
}

export async function shopCanvasVideoSubmissionId(key: string, priorTaskId = "") {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([key, priorTaskId])));
    return `canvas-video-${Array.from(new Uint8Array(digest).slice(0, 16), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function readShopCanvasVideoSubmission(scope: string, key: string) {
    const raw = await localForageStorageForScope(scope).getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as ShopCanvasVideoSubmission;
    if (!value || typeof value.id !== "string" || !value.draft || !Array.isArray(value.draft.references)) throw new Error("视频提交记录读取失败，请刷新后重试");
    return value;
}

export async function saveShopCanvasVideoSubmission(scope: string, key: string, state: ShopCanvasVideoSubmission | null) {
    const storage = localForageStorageForScope(scope);
    if (state) await storage.setItem(key, JSON.stringify(state));
    else await storage.removeItem(key);
}

export function reconcileShopCanvasVideoInput(draft: WorkbenchVideoNodeDraft, previous: string | undefined, linked: CommerceGraphNode[]) {
    let explicitText = new Set<string>();
    try {
        const rows: unknown = JSON.parse(previous || "[]");
        if (Array.isArray(rows)) explicitText = new Set(rows.filter((row) => Array.isArray(row) && typeof row[0] === "string" && row[3] === "mention").map((row) => row[0]));
    } catch {
        // A saved draft can still be edited if its prior link snapshot is malformed.
    }
    for (const node of linked) {
        if (node.type === "text" && draft.prompt.includes(canvasNodeMentionToken(node.id))) explicitText.add(node.id);
    }
    const implicitLinks = linked.filter((node) => !explicitText.has(node.id));
    const signature = JSON.stringify(linked.map((node) => [node.id, node.resourceId, node.type === "text" && !explicitText.has(node.id) ? node.text : null, ...(explicitText.has(node.id) ? ["mention"] : [])]));
    if (signature === previous) return { draft, signature };
    const links = reconcileCommerceLinks(previous, implicitLinks, draft.prompt);
    const references = draft.references.filter(
        (reference) => !reference.id.startsWith("canvas-ref:") || !links.previousResourceIds.has(reference.resourceId) || linked.some((node) => reference.id === `canvas-ref:${node.id}` && node.resourceId === reference.resourceId),
    );
    const seen = new Set(references.map((reference) => reference.resourceId));
    for (const node of linked) {
        if (!node.resourceId || seen.has(node.resourceId) || node.type === "text") continue;
        const kind = node.type === "video" || node.type === "audio" ? node.type : "image";
        references.push({
            id: `canvas-ref:${node.id}`,
            name: node.text || (kind === "video" ? "画布参考视频" : kind === "audio" ? "画布参考音频" : "画布参考图"),
            kind,
            role: "reference",
            resourceId: node.resourceId,
        });
        seen.add(node.resourceId);
    }
    return { draft: { ...draft, prompt: links.text, references }, signature };
}
