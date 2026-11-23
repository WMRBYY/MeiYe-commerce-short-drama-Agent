import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { getResourceBlob, resourceIdFromStorageKey, uploadResourceFile, resourceStorageKey, resourceFileUrl } from "@/services/api/resources";
import { getImageBlob, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { decodeChannelModel, encodeChannelModel, hasSystemModelPrice, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { quoteModel } from "@/services/api/logical-models";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceVideo } from "@/types/media";
import type { MediaConversionOperation } from "./contracts";
import { inspectLayerAlpha, validateLayerRasters } from "@/lib/canvas/canvas-image-layers";

const PROTOCOLS: Partial<Record<MediaConversionOperation, string>> = {
    "image-remove-background": "bria-v2-image-edit-remove-background",
    "image-upscale": "bria-v2-image-edit-increase-resolution",
    "image-expand": "bria-v2-image-edit-expand",
    "video-replace-background": "bria-v2-video-edit-replace-background",
    "video-upscale": "bria-v2-video-edit-increase-resolution",
};

export async function quoteManagedMediaNode(config: AiConfig, operation: MediaConversionOperation, durationMs = 0, signal?: AbortSignal): Promise<number> {
    const protocols = operation === "psd-layers"
        ? ["bria-v2-image-edit-erase-foreground", "bria-v2-image-edit-remove-background"]
        : [PROTOCOLS[operation]];
    if (protocols.some((protocol) => !protocol)) throw new Error("未知的媒体处理节点");
    const video = operation.startsWith("video-");
    const videoSeconds = video ? Math.ceil(durationMs / 1000) : 0;
    if (video && (videoSeconds < 1 || videoSeconds > 60)) throw new Error("请使用 60 秒以内、可读取时长的视频");
    const quotes = await Promise.all(protocols.map(async (protocol) => {
        const selected = managedMediaModelOption(config, protocol!);
        const model = selected ? decodeChannelModel(selected) : null;
        if (!model) throw new Error(`后台尚未配置 ${protocol} 模型及渠道`);
        const result = await quoteModel({
            channelId: model.channelId,
            modelKey: model.model,
            intent: {
                capability: video ? "video" : "image",
                ...(video ? { operation: "video_to_video" } : {}),
                inputs: video ? { video: 1, image: operation === "video-replace-background" ? 1 : 0 } : { image: 1 },
                options: video ? { count: 1, videoSeconds, vquality: "auto", videoGenerateAudio: false, videoWatermark: false } : { count: 1 },
            },
        }, signal);
        return result.quote.amountMicrocredits;
    }));
    return quotes.reduce((sum, amount) => sum + amount, 0);
}

export type ManagedMediaResult = {
    storageKey: string;
    url: string;
    mimeType: string;
    bytes?: number;
    width?: number;
    height?: number;
    outputKind: "image" | "video" | "file";
    layerCount?: number;
};

export async function executeManagedMediaNode(options: {
    projectId: string;
    nodeId: string;
    operation: MediaConversionOperation;
    inputs: CanvasNodeData[];
    config: AiConfig;
    scale?: 2 | 4;
    aspectRatio?: string;
    prompt?: string;
    signal?: AbortSignal;
}): Promise<ManagedMediaResult> {
    const { operation, inputs, signal } = options;
    if (operation === "psd-layers") return executeBriaSubjectPsd(options);
    const protocol = PROTOCOLS[operation];
    if (!protocol) throw new Error("未知的媒体处理节点");
    const model = managedMediaModelOption(options.config, protocol);
    if (!model) throw new Error(`后台尚未配置 ${protocol} 模型及渠道`);
    const imageInputs = inputs.filter((item) => item.type === CanvasNodeType.Image || (item.type === CanvasNodeType.MediaConversion && item.metadata?.mediaConversion?.outputKind === "image"));
    const videoInputs = inputs.filter((item) => item.type === CanvasNodeType.Video || (item.type === CanvasNodeType.MediaConversion && item.metadata?.mediaConversion?.outputKind === "video"));
    if (operation === "video-replace-background") {
        if (videoInputs.length !== 1 || imageInputs.length !== 1 || inputs.length !== 2) throw new Error("请连接一个原视频和一张背景图片");
    } else if (operation.startsWith("video-")) {
        if (videoInputs.length !== 1 || inputs.length !== 1) throw new Error("请连接一个视频");
    } else if (imageInputs.length !== 1 || inputs.length !== 1) {
        throw new Error("请连接一张图片");
    }
    const images: ReferenceImage[] = await Promise.all(imageInputs.map((input) => managedImageReference(input, signal)));
    const videos: ReferenceVideo[] = await Promise.all(videoInputs.map((input) => managedVideoReference(input, signal)));
    const videoSeconds = operation.startsWith("video-") ? Math.ceil((videos[0]?.durationMs || 0) / 1000) : 0;
    if (operation.startsWith("video-") && videoSeconds <= 0) throw new Error("无法识别输入视频时长，请重新上传带时长信息的视频");
    if (operation.startsWith("video-") && videoSeconds > 60) throw new Error("Bria 视频编辑最多支持 60 秒输入视频");
    const config: AiConfig = {
        ...options.config, model, imageModel: model, videoModel: model, count: "1", taskWorkflowProvider: "model",
        ...(operation.startsWith("video-") ? { videoSeconds: String(videoSeconds), size: "", vquality: "auto", videoGenerateAudio: "false", videoWatermark: "false" } : {}),
    };
    const providerBody = {
        ...(operation.startsWith("image-") ? { sync: true } : {}),
        ...(operation === "image-upscale" || operation === "video-upscale" ? { desired_increase: options.scale || 2 } : {}),
        ...(operation === "image-expand" ? { aspect_ratio: options.aspectRatio || "16:9" } : {}),
    };
    const providerOptions = Object.keys(providerBody).length ? { [protocol]: { body: providerBody } } : {};
    const result = await runBackendCanvasGenerationTask({
        projectId: options.projectId,
        nodeId: options.nodeId,
        mode: operation.startsWith("video-") ? "video" : "image",
        prompt: operation === "image-expand" ? options.prompt?.trim() || "Expand the image naturally." : "Process the supplied media.",
        config,
        referenceImages: images,
        referenceVideos: videos,
        signal,
        metadata: { canvasNodeId: operation, sourceNodeIds: inputs.map((input) => input.id), providerOptions, ...(operation.startsWith("video-") ? { videoEditOperation: "video_to_video" } : {}) },
    });
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    if (operation.startsWith("video-")) {
        const video = result.video;
        if (!video?.storageKey && !video?.dataUrl) throw new Error("上游未返回视频结果");
        if (video.storageKey) return { storageKey: video.storageKey, url: video.dataUrl, mimeType: video.mimeType || "video/mp4", width: video.width, height: video.height, bytes: video.bytes, outputKind: "video" };
        const uploaded = await uploadMediaFile(await (await fetch(video.dataUrl)).blob(), "video");
        return { ...uploaded, outputKind: "video" };
    }
    const image = result.images?.[0];
    if (!image?.storageKey && !image?.dataUrl) throw new Error("上游未返回图片结果");
    if (image.storageKey) return { storageKey: image.storageKey, url: image.dataUrl, mimeType: image.mimeType || "image/png", width: image.width, height: image.height, bytes: image.bytes, outputKind: "image" };
    const uploaded = await uploadImage(image.dataUrl);
    return { ...uploaded, outputKind: "image" };
}

async function executeBriaSubjectPsd(options: Parameters<typeof executeManagedMediaNode>[0]): Promise<ManagedMediaResult> {
    const { inputs, config, signal } = options;
    const image = inputs[0];
    if (inputs.length !== 1 || !image || (image.type !== CanvasNodeType.Image && !(image.type === CanvasNodeType.MediaConversion && image.metadata?.mediaConversion?.outputKind === "image"))) {
        throw new Error("请连接一张图片");
    }
    const operations = [
        { protocol: "bria-v2-image-edit-erase-foreground", prompt: "Remove the foreground subject and reconstruct the background." },
        { protocol: "bria-v2-image-edit-remove-background", prompt: "Keep the foreground subject with a transparent background." },
    ];
    const source = await managedImageReference(image, signal);
    const images: NonNullable<Awaited<ReturnType<typeof runBackendCanvasGenerationTask>>["images"]> = [];
    for (const { protocol, prompt } of operations) {
        const model = managedMediaModelOption(config, protocol);
        if (!model) throw new Error(`后台尚未配置 ${protocol} 模型及渠道`);
        const result = await runBackendCanvasGenerationTask({
            projectId: options.projectId, nodeId: options.nodeId, mode: "image", prompt,
            config: { ...config, model, imageModel: model, count: "1", taskWorkflowProvider: "model" },
            referenceImages: [source], signal,
            metadata: { canvasNodeId: "psd-layers", sourceNodeIds: [image.id], providerOptions: { [protocol]: { body: { sync: true } } } },
        });
        if (!result.images?.[0]) throw new Error("Bria 未返回可用图层图片");
        images.push(result.images[0]);
    }
    return exportPsdLayers(images, signal);
}

async function managedImageReference(input: CanvasNodeData, signal?: AbortSignal): Promise<ReferenceImage> {
    const content = input.metadata?.content || input.metadata?.previewContent || "";
    let storageKey = input.metadata?.storageKey;
    let dataUrl = content;
    if (!storageKey && content.startsWith("/toolbox/")) {
        const response = await fetch(content, { signal });
        if (!response.ok) throw new Error("工具箱示例图片无法读取，请上传自己的图片");
        const uploaded = await uploadImage(await response.blob());
        if (uploaded.pendingRemoteUpload) throw new Error(uploaded.remoteUploadError || "示例图片尚未上传到服务器");
        storageKey = uploaded.storageKey;
        dataUrl = uploaded.url;
    }
    return { id: input.id, name: `${input.title || "image"}.png`, type: input.metadata?.mimeType || "image/png", dataUrl, storageKey };
}

async function managedVideoReference(input: CanvasNodeData, signal?: AbortSignal): Promise<ReferenceVideo> {
    const content = input.metadata?.content || "";
    let storageKey = input.metadata?.storageKey;
    let url = content;
    if (!storageKey && content.startsWith("/toolbox/")) {
        const response = await fetch(content, { signal });
        if (!response.ok) throw new Error("工具箱示例视频无法读取，请上传自己的视频");
        const uploaded = await uploadMediaFile(await response.blob(), "video");
        if (uploaded.pendingRemoteUpload) throw new Error(uploaded.remoteUploadError || "示例视频尚未上传到服务器");
        storageKey = uploaded.storageKey;
        url = uploaded.url;
    }
    return { id: input.id, name: `${input.title || "video"}.webm`, type: input.metadata?.mimeType || "video/webm", url, storageKey, durationMs: input.metadata?.durationMs };
}

export function managedMediaModelOption(config: AiConfig, protocol: string) {
    return config.channels.filter((channel) => !protocol.startsWith("bria-") || channel.scope === "system")
        .flatMap((channel) => channel.models
        .filter((name) => channel.scope !== "system" || hasSystemModelPrice(channel, name))
        .map((name) => encodeChannelModel(channel.id, name)))
        .find((candidate) => resolveModelRequestConfig(config, candidate).interfaceType === protocol);
}

async function exportPsdLayers(images: NonNullable<Awaited<ReturnType<typeof runBackendCanvasGenerationTask>>["images"]>, signal?: AbortSignal): Promise<ManagedMediaResult> {
    if (images.length < 2 || images.length > 32) throw new Error("拆层结果需要 2–32 张独立图片");
    const { writePsd } = await import("ag-psd");
    const layers = await Promise.all(images.map(async (image, index) => {
        if (signal?.aborted) throw new DOMException("已取消", "AbortError");
        // 任务返回的 dataUrl 是资源展示路由，直接 fetch 不带授权且可能跨域跳转。
        // 处理用途必须按资源访问合同取原图字节。
        const blob = image.storageKey
            ? resourceIdFromStorageKey(image.storageKey) ? await getResourceBlob(image.storageKey, "psd-layer") : await getImageBlob(image.storageKey)
            : image.dataUrl ? await (await fetch(image.dataUrl)).blob() : null;
        if (!blob) throw new Error(`第 ${index + 1} 层缺少图片`);
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();
        return { name: `图层 ${index + 1}`, canvas };
    }));
    const targetWidth = layers[0].canvas.width;
    const targetHeight = layers[0].canvas.height;
    for (let index = 1; index < layers.length; index++) {
        const source = layers[index].canvas;
        if (source.width === targetWidth && source.height === targetHeight) continue;
        if (Math.abs(source.width / source.height - targetWidth / targetHeight) > 0.01) {
            throw new Error("拆层结果画幅比例不一致，无法对齐主体与背景");
        }
        const aligned = document.createElement("canvas");
        aligned.width = targetWidth;
        aligned.height = targetHeight;
        aligned.getContext("2d")?.drawImage(source, 0, 0, targetWidth, targetHeight);
        layers[index].canvas = aligned;
    }
    const contexts = layers.map((layer) => layer.canvas.getContext("2d"));
    if (contexts.some((context) => !context)) throw new Error("浏览器无法读取拆层图片");
    const order = validateLayerRasters(layers.map((layer, index) => {
        const rgba = contexts[index]!.getImageData(0, 0, layer.canvas.width, layer.canvas.height).data;
        return inspectLayerAlpha(layer.canvas.width, layer.canvas.height, rgba);
    }));
    const width = layers[0].canvas.width;
    const height = layers[0].canvas.height;
    const composite = document.createElement("canvas");
    composite.width = width;
    composite.height = height;
    const context = composite.getContext("2d");
    if (!context) throw new Error("浏览器无法合成 PSD 预览");
    order.forEach((index) => context.drawImage(layers[index].canvas, 0, 0));
    const psd = writePsd({ width, height, canvas: composite, children: order.map((index) => layers[index]).reverse() });
    const blob = new Blob([psd], { type: "application/vnd.adobe.photoshop" });
    const uploaded = await uploadResourceFile(blob, "file", { fileName: "layers.psd" });
    return { storageKey: resourceStorageKey(uploaded.id), url: uploaded.publicUrl || resourceFileUrl(uploaded.id), mimeType: blob.type, bytes: blob.size, width, height, outputKind: "file", layerCount: layers.length };
}
