import type { ToolIconName } from "@/components/mode/mode-icons";
import type { TryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import type { ShopFn } from "./shop-context";

/** 「生图」悬浮面板列出的图片功能。fn 有值的直接切到该功能；board 表示在对照台里对已有图片加工；其余先占位（即将上线）。 */
export type ShopImageFunction = { key: string; label: string; icon: ToolIconName; fn?: ShopFn; board?: boolean };

export const SHOP_IMAGE_FUNCTIONS: ShopImageFunction[] = [
    { key: "outfit", label: "换装", icon: "outfit", fn: "outfit" },
    { key: "model-views", label: "模特三视图", icon: "views", fn: "model-views" },
    { key: "pose", label: "姿势参考", icon: "pose", fn: "pose" },
    { key: "multi-model", label: "多模特同款", icon: "multi", fn: "multi-model" },
    { key: "multi-outfit", label: "一模多衣", icon: "multiOutfit", fn: "multi-outfit" },
    { key: "face-swap", label: "模特换脸", icon: "face", fn: "face-swap" },
    { key: "smart-head", label: "智能换头", icon: "head", fn: "smart-head" },
    { key: "smart-face", label: "智能换脸", icon: "smartface", fn: "smart-face" },
    { key: "print", label: "印花提取", icon: "print", fn: "print" },
    { key: "chat", label: "对话生图", icon: "chat", fn: "chat" },
    { key: "upscale", label: "高清放大", icon: "upscale", board: true },
    { key: "cutout", label: "图片抠图", icon: "cutout", board: true },
    { key: "background", label: "换背景", icon: "background", fn: "background" },
    { key: "scene", label: "场景提取", icon: "scene", fn: "scene" },
    { key: "repaint", label: "智能重绘", icon: "repaint", board: true },
    { key: "inpaint", label: "局部重绘", icon: "inpaint", board: true },
    { key: "enhance", label: "脸部增强", icon: "enhance", fn: "enhance" },
    { key: "noise", label: "加噪点", icon: "noise", board: true },
    { key: "color", label: "图片调色", icon: "color" },
];

export const TRYON_ICON: Record<TryOnFunction, ToolIconName> = {
    outfit: "outfit",
    "fine-outfit": "outfit",
    "model-views": "views",
    "multi-model": "multi",
    "multi-outfit": "multiOutfit",
    pose: "pose",
    "face-swap": "face",
    "smart-face": "smartface",
    "smart-head": "head",
    background: "background",
    scene: "scene",
    enhance: "enhance",
    print: "print",
};
