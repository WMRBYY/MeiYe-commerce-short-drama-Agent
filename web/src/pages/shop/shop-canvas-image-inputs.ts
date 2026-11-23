import { canvasNodeMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { isTryOnFunction, tryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { tryOnPromptReferences, type TryOnDraft } from "@/pages/ecommerce/tryon/tryon-plan";
import { resourceStorageKey, resourceVariantUrl } from "@/services/api/resources";
import { SHOP_CANVAS_IMAGE_PROMPTS } from "./shop-canvas-catalog";
import type { CommerceGraphNode, ShopCanvasReferenceInput } from "./shop-canvas-graph";
import type { ChatDraft } from "./shop-edits";

export type ShopCanvasImageReference = { resourceId: string; name: string; label: string };

export function persistableCanvasChat(draft: ChatDraft): ChatDraft {
    return { ...draft, refs: draft.refs.filter((ref) => ref.resourceId && !ref.error).map((ref) => ({ ...ref, previewUrl: resourceVariantUrl(ref.resourceId, "thumbnail") })) };
}

export function shopCanvasImageReferences(mode: string, image: TryOnDraft, chat: ChatDraft): ShopCanvasImageReference[] {
    return mode === "chat" ? chat.refs.filter((ref) => ref.resourceId && !ref.error).map((ref, index) => ({ resourceId: ref.resourceId, name: ref.name, label: `图${index + 1}` })) : tryOnPromptReferences(image);
}

export function shopCanvasDefaultImagePrompt(kind: string, refs: ShopCanvasImageReference[]) {
    if (isTryOnFunction(kind)) {
        const { sentence, slots } = tryOnFunction(kind);
        return sentence
            .map((part) => {
                if (typeof part === "string") return part;
                const slot = slots.find((candidate) => candidate.key === part.slot);
                if (!slot) return "";
                const matches = refs.filter((ref) => ref.label.startsWith(slot.label) && /^\d+$/.test(ref.label.slice(slot.label.length)));
                return matches.length ? matches.map((ref) => `@${ref.label}`).join("、") : `参考${slot.label}`;
            })
            .join("");
    }
    const first = refs[0] ? `@${refs[0].label}` : "参考图";
    const second = refs[1] ? `@${refs[1].label}` : "第二张参考图";
    if (kind === "color") return `参考 ${second} 的色彩氛围调整 ${first}，保留商品固有颜色和细节。`;
    const template = SHOP_CANVAS_IMAGE_PROMPTS[kind];
    if (template) return refs.length ? `${first} ${template}` : template;
    return refs.length ? `以 ${refs.map((ref) => `@${ref.label}`).join("、")} 为参考，生成适合电商展示的图片。` : "";
}

export function rebindShopCanvasImageMentions(prompt: string, before: ShopCanvasImageReference[], after: ShopCanvasImageReference[]) {
    const deleted = "\u0000";
    const rebound = prompt.replace(/@([^@\s、，。！？；：,.!?;:]+?\d+)(?!\d)/g, (token, label: string) => {
        const previous = before.find((ref) => ref.label === label);
        if (!previous) return token;
        const current = after.find((ref) => ref.label === label && ref.resourceId === previous.resourceId) || after.find((ref) => ref.resourceId === previous.resourceId);
        return current ? `@${current.label}` : deleted;
    });
    return rebound.replace(/\u0000、|、\u0000/g, "").replaceAll(deleted, "");
}

export function shopCanvasMentionReferences(nodes: CommerceGraphNode[], targetId?: string): CanvasResourceReference[] {
    if (!targetId) return [];
    const blocked = new Set([targetId]);
    const downstream = new Map<string, string[]>();
    for (const node of nodes) {
        for (const source of node.inputs || []) {
            const targets = downstream.get(source) || [];
            targets.push(node.id);
            downstream.set(source, targets);
        }
    }
    // Iterating the set also visits the descendants added inside this loop.
    for (const id of blocked) for (const target of downstream.get(id) || []) blocked.add(target);
    return nodes.flatMap((node): CanvasResourceReference[] => {
        if (blocked.has(node.id)) return [];
        if (node.type === "text" && node.text?.trim()) {
            return [{ id: node.id, nodeId: node.id, kind: "text", label: node.text, title: node.text, text: node.text, active: false, mentionToken: canvasNodeMentionToken(node.id) }];
        }
        if (!node.resourceId) return [];
        const kind = node.type === "video" || node.type === "audio" ? node.type : "image";
        const label = node.text || (kind === "image" ? "画布图片" : kind === "video" ? "画布视频" : "画布音频");
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                title: label,
                label,
                active: false,
                mentionToken: canvasNodeMentionToken(node.id),
                materialCategory: node.materialCategory,
                storageKey: resourceStorageKey(node.resourceId),
                previewUrl: kind === "image" ? resourceVariantUrl(node.resourceId, "thumbnail") : undefined,
                mediaUrl: kind !== "image" ? resourceVariantUrl(node.resourceId, "original") : undefined,
            },
        ];
    });
}

export function shopCanvasTextInputs(prompt: string, nodes: CommerceGraphNode[]): ShopCanvasReferenceInput[] {
    return nodes.flatMap((node) => (node.type === "text" && prompt.includes(canvasNodeMentionToken(node.id)) ? [{ kind: "text", nodeId: node.id }] : []));
}

export function resolveShopCanvasTextMentions(prompt: string, nodes: CommerceGraphNode[]) {
    const byId = new Map(nodes.filter((node) => node.type === "text").map((node) => [node.id, node.text?.trim() || ""]));
    return prompt.replace(/@\[node:([^\]]+)\]/g, (_, id: string) => byId.get(id) ?? "");
}
