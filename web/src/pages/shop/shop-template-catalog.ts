export const SHOP_TEMPLATE_FORMATS = {
    talking: "口播",
    unboxing: "开箱",
    demo: "使用演示",
    detail: "商品特写",
    display: "商品陈列",
    lifestyle: "生活方式",
    lookbook: "穿搭展示",
    story: "剧情短片",
    effects: "创意特效",
    campaign: "节日广告",
} as const;

export type ShopTemplateFormat = keyof typeof SHOP_TEMPLATE_FORMATS;
export type ShopTemplateDuration = "long" | "short" | "all";

export const SHOP_TEMPLATE_MIN_SECONDS = 15;

export function matchesShopTemplateDuration(seconds: number, duration: ShopTemplateDuration) {
    const meetsMinimum = seconds >= SHOP_TEMPLATE_MIN_SECONDS;
    return duration === "all" || meetsMinimum === (duration === "long");
}

export type ShopVideoTemplate = {
    id: string;
    title: string;
    description: string;
    category: string;
    format: ShopTemplateFormat;
    tags: string[];
    videoUrl: string;
    originalVideoUrl: string;
    posterUrl: string;
    durationSeconds: number;
    sourceUrl: string;
    license: { label: string; url: string; author: string };
    publishedAt: string;
    aiGenerated: boolean;
    sourceClips?: string[];
    sourceTitle?: string;
    sourceModification?: string;
    retainsAudio?: boolean;
};

// Deployments may add their own licensed video catalog. No private media is bundled.
export const SHOP_VIDEO_TEMPLATES: ShopVideoTemplate[] = [];
