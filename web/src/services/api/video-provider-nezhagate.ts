import { getResourceInputURL } from "@/services/api/resources";
import { getMediaBlob } from "@/services/file-storage";
import { modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import type { RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

type NezhaVideoJob = { id?: string; status?: string; data?: Array<{ url?: string }>; error?: { code?: string; message?: string } };

export async function createNezhaSeedance25Task(deps: VideoProviderDeps, config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (modelOptionName(model) !== "seedance-2.5") throw new Error("NezhaGate Seedance 2.5 协议仅支持 seedance-2.5");
    if (!prompt.trim() || [...prompt].length > 11000) throw new Error("提示词必填，且不得超过 11000 个字符");
    const duration = Number(config.videoSeconds);
    const resolution = config.vquality ? `${config.vquality.toUpperCase().replace(/P$/, "")}P` : "720P";
    const ratio = config.size || "16:9";
    if (!Number.isInteger(duration) || duration < 4 || duration > 30 || !["480P", "720P", "1080P"].includes(resolution) || !["16:9", "9:16", "1:1", "4:3", "3:4"].includes(ratio)) throw new Error("该型号仅支持 4–30 秒、480P/720P/1080P 和指定的五种画面比例");
    if (references.length > 30 || videoReferences.length > 10 || audioReferences.length > 10) throw new Error("参考素材数量超过 NezhaGate Seedance 2.5 限制");
    if (audioReferences.length && !references.length && !videoReferences.length) throw new Error("参考音频必须同时提供参考图或参考视频");
    if (videoReferences.reduce((total, item) => total + (item.bytes || 0), 0) > 100 * 1024 * 1024) throw new Error("参考视频总大小不能超过 100 MB");
    if (videoReferences.reduce((total, item) => total + (item.durationMs || 0), 0) > 30000) throw new Error("参考视频总时长不能超过 30 秒");
    const images = await Promise.all(references.map(async (item) => {
        if (item.storageKey?.startsWith("resource:")) return getResourceInputURL(item.storageKey);
        const url = item.url || item.dataUrl || "";
        if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
        throw new Error("参考图需要可访问的图片 URL 或已上传的资源");
    }));
    const videos = await Promise.all(videoReferences.map(async (item) => {
        if (item.storageKey?.startsWith("resource:")) return getResourceInputURL(item.storageKey);
        if (/^https?:\/\//i.test(item.url) || /^data:video\//i.test(item.url)) return item.url;
        const blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
        if (blob) return deps.response.blobToDataUrl(blob);
        throw new Error("参考视频需要公网链接或已上传的素材");
    }));
    const audios = await Promise.all(audioReferences.map(async (item) => {
        const url = item.storageKey?.startsWith("resource:") ? await getResourceInputURL(item.storageKey) : item.url;
        if (!/^https?:\/\//i.test(url || "")) throw new Error("NezhaGate 参考音频必须使用公网 HTTP(S) 直链");
        return url;
    }));
    try {
        const job = await deps.transport.post<NezhaVideoJob>(deps.transport.apiUrl("/videos/generations"), {
            model: "seedance-2.5", prompt, duration, resolution, size: ratio,
            ...(images.length ? { images } : {}),
            ...(videos.length ? { video_references: videos } : {}),
            ...(audios.length ? { audio_reference: audios } : {}),
        }, options);
        if (!job.id) throw new Error("NezhaGate 没有返回视频任务 ID");
        return { id: job.id, provider: "nezhagate-seedance-25", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "NezhaGate 视频任务创建失败"));
    }
}

export async function createNezhaSeedance30sTask(deps: VideoProviderDeps, config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (modelOptionName(model) !== "seedance-2.5-30s") throw new Error("NezhaGate 30 秒协议仅支持 seedance-2.5-30s");
    if (!prompt.trim() || new TextEncoder().encode(prompt).length > 5000) throw new Error("提示词必填，且不得超过 5000 UTF-8 字节");
    if (videoReferences.length || audioReferences.length) throw new Error("NezhaGate 30 秒型号不支持参考视频或参考音频");
    if (references.length > 9) throw new Error("NezhaGate 30 秒型号最多支持 9 张参考图");
    const ratio = config.size || "16:9";
    if (Number(config.videoSeconds) !== 30 || !["", "720", "720p", "720P"].includes(config.vquality) || !["16:9", "9:16", "1:1", "4:3", "3:4"].includes(ratio)) throw new Error("该型号仅支持 30 秒、720P 和指定的五种画面比例");
    const images = await Promise.all(references.map(async (item) => {
        if (item.storageKey?.startsWith("resource:")) return getResourceInputURL(item.storageKey);
        const url = item.url || item.dataUrl || "";
        if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
        throw new Error("参考图需要可访问的图片 URL 或已上传的资源");
    }));
    try {
        const job = await deps.transport.post<NezhaVideoJob>(deps.transport.apiUrl("/videos/generations"), {
            model: "seedance-2.5-30s",
            prompt,
            duration: 30,
            resolution: "720P",
            size: ratio,
            ...(images.length ? { images } : {}),
        }, options);
        if (!job.id) throw new Error("NezhaGate 没有返回视频任务 ID");
        return { id: job.id, provider: "nezhagate-seedance-25-30s", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "NezhaGate 视频任务创建失败"));
    }
}

export async function pollNezhaSeedance30sTask(deps: VideoProviderDeps, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const job = await deps.transport.get<NezhaVideoJob>(deps.transport.apiUrl(`/videos/jobs/${encodeURIComponent(task.id)}`), options);
        if (job.status === "succeeded") {
            const url = job.data?.[0]?.url;
            if (!url) return { status: "failed", error: "NezhaGate 已完成任务，但未返回视频地址" };
            return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
        }
        if (job.status === "failed") return { status: "failed", error: job.error?.message || job.error?.code || "NezhaGate 视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "NezhaGate 视频任务查询失败"));
    }
}
