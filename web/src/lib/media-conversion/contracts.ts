import type { CanvasNodeData } from "@/types/canvas";

export const MEDIA_CONVERSION_SCHEMA_VERSION = 1 as const;

export const MEDIA_CONVERSION_NODE_TYPE = "media-conversion" as const;

export type MediaConversionOperation = "grayscale" | "edge-canny" | "lineart" | "depth" | "pose" | "cutout" | "image-remove-background" | "image-upscale" | "psd-layers" | "video-replace-background" | "video-upscale" | "image-expand";
export type MediaConversionStatus = "idle" | "processing" | "completed" | "stale" | "skipped" | "unavailable" | "error";
export type MediaConversionOutputKind = "image" | "video" | "file";

export type MediaConversionNodeState = {
    schemaVersion: typeof MEDIA_CONVERSION_SCHEMA_VERSION;
    operation: MediaConversionOperation;
    status: MediaConversionStatus;
    sourceNodeId?: string;
    sourceFingerprint?: string;
    outputKind?: MediaConversionOutputKind;
    resultStorageKey?: string;
    resultWidth?: number;
    resultHeight?: number;
    detectedPeople?: number;
    scale?: 2 | 4;
    aspectRatio?: string;
    expansionPrompt?: string;
    layerCount?: number;
    errorCode?: string;
    errorMessage?: string;
    startedAt?: string;
    updatedAt?: string;
};

export const MEDIA_CONVERSION_OPERATION_LABELS: Record<MediaConversionOperation, string> = {
    grayscale: "灰度图",
    "edge-canny": "Canny 边缘",
    lineart: "AI 线稿",
    depth: "深度图",
    pose: "姿态骨架",
    cutout: "透明抠图",
    "image-remove-background": "图片移除背景",
    "image-upscale": "图片分辨率提高",
    "psd-layers": "PSD 分层",
    "video-replace-background": "视频替换背景",
    "video-upscale": "视频分辨率提升",
    "image-expand": "图像扩张",
};

export const MEDIA_CONVERSION_OPERATION_DESCRIPTIONS: Record<MediaConversionOperation, string> = {
    grayscale: "普通图像算法，适合先检查明暗层次",
    "edge-canny": "普通图像算法，提取清晰轮廓",
    lineart: "本机 ControlNet Aux 线稿预处理，需要另行部署本机模型服务",
    depth: "本机 Depth Anything V2 Small，需要另行部署本机模型服务",
    pose: "本机 OpenPose 人体骨架预处理，需要另行部署本机模型服务",
    cutout: "需要安装并验证本地抠图模型",
    "image-remove-background": "使用 Bria 去除背景，输出透明 PNG",
    "image-upscale": "使用 Bria 提高图片分辨率",
    "psd-layers": "拆分为独立图层并导出 PSD",
    "video-replace-background": "使用 Bria 替换视频背景",
    "video-upscale": "使用 Bria 提高视频分辨率",
    "image-expand": "使用 Bria 生成画面外的新区域",
};

export function createDefaultMediaConversionState(): MediaConversionNodeState {
    return {
        schemaVersion: MEDIA_CONVERSION_SCHEMA_VERSION,
        operation: "edge-canny",
        status: "idle",
    };
}

export function mediaConversionSourceFingerprint(node: CanvasNodeData) {
    const metadata = node.metadata;
    const source = [
        node.id,
        metadata?.storageKey || "",
        compactSource(metadata?.content || metadata?.previewContent || ""),
        metadata?.mimeType || "",
        metadata?.bytes || "",
        metadata?.naturalWidth || "",
        metadata?.naturalHeight || "",
        metadata?.durationMs || "",
    ].join("|");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function mediaConversionOperationLabel(operation: MediaConversionOperation) {
    return MEDIA_CONVERSION_OPERATION_LABELS[operation];
}

export function mediaConversionOperationDescription(operation: MediaConversionOperation) {
    return MEDIA_CONVERSION_OPERATION_DESCRIPTIONS[operation];
}

export function isLocalImageOperation(operation: MediaConversionOperation) {
    return operation === "grayscale" || operation === "edge-canny";
}

function compactSource(value: string) {
    if (value.length <= 2048) return value;
    return `${value.slice(0, 1024)}|${value.slice(-1024)}|${value.length}`;
}
