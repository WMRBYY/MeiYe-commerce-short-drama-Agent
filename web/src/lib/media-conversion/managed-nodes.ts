export const MANAGED_MEDIA_NODES = [
    { id: "image-remove-background", label: "图片移除背景", description: "去除图片背景并保留透明主体", inputKind: "image" },
    { id: "image-upscale", label: "图片分辨率提高", description: "使用上游超分模型提高图片分辨率", inputKind: "image" },
    { id: "psd-layers", label: "PSD 分层", description: "主体抠图和背景修补分别计费，导出两层可编辑 PSD", inputKind: "image" },
    { id: "video-replace-background", label: "视频替换背景", description: "用一张背景图片替换视频背景", inputKind: "video" },
    { id: "video-upscale", label: "视频分辨率提升", description: "使用上游超分模型提高视频分辨率", inputKind: "video" },
    { id: "image-expand", label: "图像扩张", description: "向画面外扩展并生成新区域", inputKind: "image" },
] as const;

export type ManagedMediaNodeId = typeof MANAGED_MEDIA_NODES[number]["id"];
export const MANAGED_MEDIA_NODE_PREFIX = "managed-media:";

export function managedMediaNode(id: string) {
    return MANAGED_MEDIA_NODES.find((item) => item.id === id);
}

export function managedMediaNodeEnabled(id: string, enabled: Record<string, boolean> | undefined) {
    return enabled?.[id] !== false;
}
