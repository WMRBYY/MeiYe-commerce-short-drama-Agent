import { videoResolutionRequest, modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getResourceInputURL } from "@/services/api/resources";
import { modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import type { ApiEnvelope, ApiVideoResponse, RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

async function lecReferenceUrl(url: string | undefined, storageKey?: string): Promise<string> {
    const resolved = storageKey?.startsWith("resource:") ? await getResourceInputURL(storageKey) : url || "";
    if (!/^https:\/\//i.test(resolved)) throw new Error("Lec API 参考素材需要公网 HTTPS URL；请先把素材保存到对象存储");
    return resolved;
}

export async function createLecVideoTask(deps: VideoProviderDeps, config: ResolvedAiConfig, model: string, prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const profile = modelCapabilityConfigFor(config, model).video!;
    const duration = Number(config.videoSeconds);
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error("Lec API 视频时长必须是 4–30 秒整数");
    const [imageUrls, videoUrls, audioUrls] = await Promise.all([
        Promise.all(images.map((item) => lecReferenceUrl(item.url || item.dataUrl, item.storageKey))),
        Promise.all(videos.map((item) => lecReferenceUrl(item.url, item.storageKey))),
        Promise.all(audios.map((item) => lecReferenceUrl(item.url, item.storageKey))),
    ]);
    const payload = {
        model: modelOptionName(model),
        prompt: prompt.trim(),
        duration,
        aspect_ratio: profile.ratios.includes(config.size) ? config.size : profile.defaultRatio,
        resolution: videoResolutionRequest(profile, config.vquality) || profile.defaultResolution,
        ...(imageUrls.length ? { images: imageUrls } : {}),
        ...(videoUrls.length ? { videos: videoUrls } : {}),
        ...(audioUrls.length ? { audios: audioUrls } : {}),
    };
    try {
        const created = deps.response.unwrapVideoResponse(await deps.transport.post<ApiVideoResponse>(deps.transport.apiUrl("/videos"), payload, options));
        const id = deps.response.videoTaskId(created);
        if (!id) throw new Error("Lec API 没有返回视频任务 ID");
        return { id, provider: "lec-video", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Lec API 视频任务创建失败"));
    }
}

export async function pollLecVideoTask(deps: VideoProviderDeps, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const raw = await deps.transport.get<ApiEnvelope<Record<string, unknown>>>(deps.transport.apiUrl(`/videos/${encodeURIComponent(task.id)}`), options);
        const state = deps.response.unwrapEnvelopeRecord(raw);
        const status = String(state.status || state.state || "").toLowerCase();
        if (["completed", "succeeded", "success", "done"].includes(status)) {
            const nested = state.output && typeof state.output === "object" ? state.output as Record<string, unknown> : {};
            const url = String(state.video_url || state.result_url || state.url || nested.video_url || nested.url || "");
            if (!url) return { status: "failed", error: "Lec API 任务已完成但未返回视频地址" };
            return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
        }
        if (["failed", "failure", "cancelled", "canceled", "expired"].includes(status)) {
            const error = state.error && typeof state.error === "object" ? state.error as Record<string, unknown> : {};
            return { status: "failed", error: String(error.message || state.fail_reason || state.message || "视频生成失败") };
        }
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Lec API 视频任务查询失败"));
    }
}
