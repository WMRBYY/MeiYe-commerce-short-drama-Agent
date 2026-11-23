import type { EcommerceDraft } from "@/services/api/ecommerce";

/**
 * 电商模式「详情图」页把整份规格交给电商 Agent：写进 sessionStorage（按新工作区 ID），Agent 页新建工作区时合并一次并自动发起创作确认。
 * 只放草稿字段，不放密钥；读取后立即删除，刷新不会重复提交。
 */
export type ShopDetailHandoff = { draft: Partial<EcommerceDraft>; autoStart: boolean };

const KEY = (id: string) => `meiye.shop.detail.handoff:${id}`;
const FIELDS: Array<keyof EcommerceDraft> = [
    "productName",
    "category",
    "claims",
    "platform",
    "region",
    "language",
    "imageType",
    "count",
    "noText",
    "imageModel",
    "ratio",
    "resolution",
    "style",
    "instruction",
    "modelEnabled",
    "references",
    "layoutReferences",
    "typeOptions",
    "creativeOptions",
    "referenceMode",
];

export function writeShopDetailHandoff(id: string, handoff: ShopDetailHandoff) {
    const draft = Object.fromEntries(FIELDS.filter((key) => handoff.draft[key] !== undefined).map((key) => [key, handoff.draft[key]]));
    sessionStorage.setItem(KEY(id), JSON.stringify({ draft, autoStart: handoff.autoStart }));
}

export function takeShopDetailHandoff(id: string | null): ShopDetailHandoff | null {
    if (!id) return null;
    try {
        const raw = sessionStorage.getItem(KEY(id));
        if (!raw) return null;
        sessionStorage.removeItem(KEY(id));
        const parsed = JSON.parse(raw) as { draft?: Record<string, unknown>; autoStart?: unknown };
        if (!parsed.draft || typeof parsed.draft !== "object") return null;
        const draft = Object.fromEntries(Object.entries(parsed.draft).filter(([key]) => (FIELDS as string[]).includes(key))) as Partial<EcommerceDraft>;
        return { draft, autoStart: parsed.autoStart === true };
    } catch {
        return null;
    }
}
