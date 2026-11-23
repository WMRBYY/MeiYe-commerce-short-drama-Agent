import type { ClipMode, ClipPlan, ClipProject } from "@/services/api/video-edit";

export const CLIP_TOOLS: Array<{ id: ClipMode; title: string; description: string }> = [
    { id: "koubo", title: "网感剪辑", description: "识别口播重点，编排字幕与视觉节奏" },
    { id: "mix", title: "智能混剪", description: "按口播内容匹配空镜与商品素材" },
    { id: "subtitle", title: "智能加字幕", description: "识别台词，为表达配上清晰字幕" },
    { id: "behind", title: "字在人后", description: "框选人物，让大字出现在人物身后" },
];
export const clipRunning = (project?: ClipProject | null) => project?.status === "analyzing" || project?.status === "rendering";
export const clipStatusLabel = (project: ClipProject) => ({ analyzing: "分析中", ready: "待校对", rendering: "生成中", succeeded: "已完成", failed: "未完成", cancelled: "已取消" })[project.status];
export const clipClock = (ms: number) =>
    `${Math.floor(ms / 60000)
        .toString()
        .padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;

export function clipTitleError(title: string): string {
    if (!title.trim()) return "为这条成片写一个标题，再开始创作。";
    if ([...title.trim()].length > 100) return "成片标题最多 100 个字。";
    return "";
}

export function clipTrimError(startMs: number, endMs: number, durationMs: number): string {
    const end = endMs || durationMs;
    if (![startMs, end, durationMs].every(Number.isFinite) || startMs < 0 || end > durationMs || end - startMs < 500) return "片段至少保留 0.5 秒，且不能超出原视频。";
    return "";
}

export function validSubjectBox(box?: number[]) {
    return Boolean(box?.length === 4 && box.every(Number.isFinite) && box[0] >= 0 && box[1] >= 0 && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= 1.000001 && box[1] + box[3] <= 1.000001);
}

/** 时间和素材引用先在本地拦住；服务端还会验证文件、归属与实际时长。 */
export function clipPlanError(plan: ClipPlan, mode: ClipMode): string {
    if (!plan.sourceResourceId || !Number.isFinite(plan.durationMs) || plan.durationMs <= 0) return "原视频信息不完整，请重新分析素材。";
    const titleError = clipTitleError(plan.title);
    if (titleError) return titleError;
    if (plan.musicResourceId && (!Number.isFinite(plan.musicVolume) || (plan.musicVolume ?? -1) < 0 || (plan.musicVolume ?? 1) > 0.5)) return "背景音乐音量应在 0% 到 50% 之间。";
    if (mode === "behind") {
        if (!plan.behindText.trim()) return "先填写人物身后的文字。";
        if ([...plan.behindText].length > 20) return "人物身后的文字最多 20 个字。";
        if (!validSubjectBox(plan.subjectBox)) return "先在首帧框选需要保留的人物。";
    } else if (!plan.transcript.length) return "没有可用的字幕，请添加字幕或撤销删除。";
    let previousEnd = 0;
    for (const line of plan.transcript) {
        if (!line.text.trim()) return "字幕不能为空，请补充文字或移除该行。";
        if ([...line.text].length > 80) return "单句字幕最多 80 个字，请拆分长句。";
        if (![line.startMs, line.endMs].every(Number.isFinite) || line.startMs < previousEnd || line.endMs <= line.startMs || line.endMs > plan.durationMs) return "字幕时间需要按顺序排列，且不能重叠或超过原视频。";
        previousEnd = line.endMs;
    }
    previousEnd = 0;
    for (const clip of plan.placements) {
        if (!plan.materials.includes(clip.resourceId)) return "混剪画面引用了未上传的素材，请重新选择。";
        if (![clip.startMs, clip.endMs, clip.sourceStartMs].every(Number.isFinite) || clip.startMs < previousEnd || clip.sourceStartMs < 0 || clip.endMs <= clip.startMs || clip.endMs > plan.durationMs) return "混剪画面时间不能重叠或超过原视频。";
        previousEnd = clip.endMs;
    }
    if (mode === "mix" && !plan.placements.length) return "先安排至少一段空镜画面。";
    return "";
}

export function inspectClipVideo(file: File, signal: AbortSignal): Promise<{ durationMs: number; width: number; height: number }> {
    if (file.type && !file.type.startsWith("video/")) return Promise.reject(new Error("请选择视频文件。"));
    if (!file.size) return Promise.reject(new Error("视频文件为空，请重新选择。"));
    if (file.size > 512 * 1024 * 1024) return Promise.reject(new Error("单个视频不能超过 512 MB。"));
    const url = URL.createObjectURL(file);
    return inspectClipVideoUrl(url, signal).finally(() => URL.revokeObjectURL(url));
}

export function inspectClipVideoUrl(url: string, signal: AbortSignal): Promise<{ durationMs: number; width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        let finished = false;
        const done = (error?: Error) => {
            if (finished) return;
            finished = true;
            window.clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            const meta = { durationMs: Math.round(video.duration * 1000), width: video.videoWidth, height: video.videoHeight };
            video.removeAttribute("src");
            video.load();
            if (error) reject(error);
            else if (!Number.isFinite(meta.durationMs) || meta.durationMs <= 0 || !meta.width || !meta.height) reject(new Error("无法读取视频时长或画面，请换一个可播放的视频。"));
            else resolve(meta);
        };
        const abort = () => done(new DOMException("上传已取消", "AbortError"));
        const timer = window.setTimeout(() => done(new Error("读取视频超时，请换一个可播放的视频。")), 15000);
        video.onloadedmetadata = () => done();
        video.onerror = () => done(new Error("浏览器无法读取这个视频，请使用 MP4 视频。"));
        video.preload = "metadata";
        video.muted = true;
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        else video.src = url;
    });
}
