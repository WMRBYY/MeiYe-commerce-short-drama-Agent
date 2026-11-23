import { useCallback, useEffect, useRef, useState, type DragEvent, type MutableRefObject } from "react";
import { App, Button, Input, Modal, Select, Switch } from "antd";
import { Camera, CheckCircle2, CircleAlert, CloudUpload, Film, ImagePlus, LoaderCircle, RefreshCw, Trash2, Workflow } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { uploadResourceFile } from "@/services/api/resources";
import {
    CANVAS_TEMPLATE_CATEGORIES,
    formatTemplateBytes,
    formatTemplateDuration,
    listMyCanvasTemplates,
    submitCanvasTemplate,
    type CanvasTemplate,
    type CanvasTemplateCategory,
} from "@/services/api/canvas-templates";

// 与后端模版成片上限一致（单文件必须小于 2048MB）。
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024 - 1;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov";
const COVER_ACCEPT = "image/jpeg,image/png,image/webp";

type UploadTemplateDialogProps = {
    open: boolean;
    projectId: string;
    defaultTitle: string;
    nodeCount: number;
    connectionCount: number;
    onClose: () => void;
    /** 提交前把画布保存到云端；返回 false 表示保存失败。 */
    beforeSubmit: () => Promise<boolean>;
};

type VideoState = {
    file: File;
    url: string;
    durationMs: number;
    width: number;
    height: number;
    progress: number;
    status: "reading" | "uploading" | "done" | "error";
    resourceId?: string;
    error?: string;
};

type CoverState = { url: string; status: "uploading" | "done" | "error"; source: "frame" | "file"; resourceId?: string; error?: string };

export function UploadTemplateDialog(props: UploadTemplateDialogProps) {
    const { modal } = App.useApp();
    const busyRef = useRef(false);
    const [session, setSession] = useState(0);
    const { open, onClose } = props;

    useEffect(() => {
        if (open) setSession((value) => value + 1);
    }, [open]);

    const requestClose = useCallback(() => {
        if (!busyRef.current) {
            onClose();
            return;
        }
        modal.confirm({
            title: "关闭后上传会中断",
            content: "成片或封面还在上传，关闭后需要重新上传。确定关闭吗？",
            okText: "关闭",
            cancelText: "继续上传",
            okButtonProps: { danger: true },
            onOk: onClose,
        });
    }, [modal, onClose]);

    return (
        <Modal
            title={
                <span className="inline-flex items-center gap-2">
                    <CloudUpload className="size-4" />
                    上传模版
                </span>
            }
            open={open}
            onCancel={requestClose}
            footer={null}
            centered
            width={880}
            mask={{ closable: false }}
            destroyOnHidden
        >
            <UploadTemplateForm key={session} {...props} busyRef={busyRef} onRequestClose={requestClose} />
        </Modal>
    );
}

function UploadTemplateForm({ projectId, defaultTitle, nodeCount, connectionCount, onClose, beforeSubmit, busyRef, onRequestClose }: UploadTemplateDialogProps & { busyRef: MutableRefObject<boolean>; onRequestClose: () => void }) {
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const [title, setTitle] = useState(() => (defaultTitle || "").trim().slice(0, 40));
    const [category, setCategory] = useState<CanvasTemplateCategory | "">("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [allowDownload, setAllowDownload] = useState(true);
    const [video, setVideo] = useState<VideoState | null>(null);
    const [cover, setCover] = useState<CoverState | null>(null);
    const [latest, setLatest] = useState<CanvasTemplate | null>(null);
    const [dragging, setDragging] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const videoAbortRef = useRef<AbortController | null>(null);
    const coverAbortRef = useRef<AbortController | null>(null);
    const autoCoverPendingRef = useRef(false);
    const objectUrlsRef = useRef<string[]>([]);

    busyRef.current = submitting || video?.status === "uploading" || cover?.status === "uploading";

    useEffect(() => {
        const controller = new AbortController();
        listMyCanvasTemplates(projectId, controller.signal)
            .then(({ items }) => setLatest(items[0] || null))
            .catch(() => undefined);
        return () => controller.abort();
    }, [projectId]);

    useEffect(() => {
        const urls = objectUrlsRef.current;
        return () => {
            videoAbortRef.current?.abort();
            coverAbortRef.current?.abort();
            urls.forEach((url) => URL.revokeObjectURL(url));
            busyRef.current = false;
        };
    }, [busyRef]);

    const trackObjectUrl = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);
        return url;
    };

    const uploadCover = useCallback(async (blob: Blob, width: number, height: number, source: CoverState["source"]) => {
        coverAbortRef.current?.abort();
        const controller = new AbortController();
        coverAbortRef.current = controller;
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);
        setCover({ url, status: "uploading", source });
        try {
            const resource = await uploadResourceFile(blob, "image", { width, height, fileName: "template-cover.jpg", signal: controller.signal });
            if (controller.signal.aborted) return;
            setCover({ url, status: "done", source, resourceId: resource.id });
        } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return;
            setCover({ url, status: "error", source, error: errorText(error, "封面上传失败，请重试") });
        }
    }, []);

    const captureCover = useCallback(async () => {
        const element = videoRef.current;
        if (!element || !element.videoWidth) return;
        const frame = await captureVideoFrame(element);
        if (frame) await uploadCover(frame.blob, frame.width, frame.height, "frame");
        else message.error("无法截取当前画面，请上传封面图片");
    }, [message, uploadCover]);

    const uploadVideo = useCallback(async (file: File, meta: { durationMs: number; width: number; height: number }) => {
        videoAbortRef.current?.abort();
        const controller = new AbortController();
        videoAbortRef.current = controller;
        let lastProgress = -1;
        setVideo((current) => (current && current.file === file ? { ...current, ...meta, progress: 0, status: "uploading", error: undefined } : current));
        try {
            const resource = await uploadResourceFile(file, "video", { ...meta, fileName: file.name, purpose: "template-video", signal: controller.signal }, (uploaded, total) => {
                const progress = total > 0 ? Math.min(99, Math.floor((uploaded / total) * 100)) : 0;
                if (progress === lastProgress) return;
                lastProgress = progress;
                setVideo((current) => (current && current.file === file ? { ...current, progress } : current));
            });
            if (controller.signal.aborted) return;
            setVideo((current) => (current && current.file === file ? { ...current, progress: 100, status: "done", resourceId: resource.id } : current));
        } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return;
            setVideo((current) => (current && current.file === file ? { ...current, status: "error", error: errorText(error, "成片上传失败，请重试") } : current));
        }
    }, []);

    const chooseVideo = (file?: File) => {
        if (!file) return;
        if (!isVideoFile(file)) {
            message.error("请选择 MP4、WebM 或 MOV 格式的视频");
            return;
        }
        if (file.size > MAX_VIDEO_BYTES) {
            message.error("成片视频不能超过 2GB");
            return;
        }
        videoAbortRef.current?.abort();
        // 用户自己上传过封面时保留它，否则用新视频的画面重新生成封面。
        autoCoverPendingRef.current = cover?.source !== "file";
        setVideo({ file, url: trackObjectUrl(file), durationMs: 0, width: 0, height: 0, progress: 0, status: "reading" });
    };

    const removeVideo = () => {
        videoAbortRef.current?.abort();
        autoCoverPendingRef.current = false;
        setVideo(null);
        if (cover?.source === "frame") {
            coverAbortRef.current?.abort();
            setCover(null);
        }
    };

    const onLoadedMetadata = () => {
        const element = videoRef.current;
        if (!element || !video || video.status !== "reading") return;
        const meta = { durationMs: Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : 0, width: element.videoWidth, height: element.videoHeight };
        if (!meta.width || !meta.height) {
            setVideo({ ...video, status: "error", error: "浏览器无法解码该视频画面，请转为 MP4（H.264）后上传" });
            return;
        }
        void uploadVideo(video.file, meta);
        if (autoCoverPendingRef.current) {
            const duration = Number.isFinite(element.duration) ? element.duration : 0;
            element.currentTime = Math.min(1, duration / 10);
        }
    };

    const onSeeked = () => {
        if (!autoCoverPendingRef.current) return;
        autoCoverPendingRef.current = false;
        void captureCover();
    };

    const onVideoError = () => {
        setVideo((current) => (current && current.status === "reading" ? { ...current, status: "error", error: "浏览器无法播放该视频，请转为 MP4（H.264）后上传" } : current));
    };

    const chooseCover = async (file?: File) => {
        if (!file) return;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
            message.error("封面请使用 JPG、PNG 或 WebP 图片");
            return;
        }
        if (file.size > MAX_COVER_BYTES) {
            message.error("封面图片不能超过 10MB");
            return;
        }
        try {
            const bitmap = await createImageBitmap(file);
            const size = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            autoCoverPendingRef.current = false;
            await uploadCover(file, size.width, size.height, "file");
        } catch {
            message.error("无法读取这张图片，请换一张试试");
        }
    };

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        chooseVideo(event.dataTransfer.files?.[0]);
    };

    const missing = [
        video?.status === "done" && video.resourceId ? "" : "成片视频",
        cover?.status === "done" && cover.resourceId ? "" : "封面",
        title.trim() ? "" : "模版名称",
        category ? "" : "作品分类",
    ].filter(Boolean);
    const canSubmit = missing.length === 0 && !submitting;

    const submit = async () => {
        if (!canSubmit || !video?.resourceId || !cover?.resourceId || !category) return;
        setSubmitting(true);
        try {
            const saved = await beforeSubmit();
            if (!saved) {
                message.error("画布还没有同步到云端，请检查网络后重试");
                return;
            }
            await submitCanvasTemplate({
                canvasId: projectId,
                title: title.trim(),
                description: description.trim(),
                category,
                tags,
                videoResourceId: video.resourceId,
                coverResourceId: cover.resourceId,
                allowDownload,
            });
            busyRef.current = false;
            message.success("已上传，待管理员审核");
            onClose();
        } catch (error) {
            message.error(errorText(error, "提交失败，请稍后重试"));
        } finally {
            setSubmitting(false);
        }
    };

    const panelStyle = { borderColor: theme.node.stroke, background: theme.node.panel };
    const labelClass = "mb-2 flex items-center gap-1 text-[13px] font-medium";

    return (
        <div className="border-t pt-5" style={{ borderColor: theme.node.stroke }}>
            <p className="mb-4 text-sm leading-6" style={{ color: theme.node.muted }}>
                上传成片视频并附带当前画布的完整工程，管理员审核通过后会展示在首页作品区，其他人可以观看成片并只读查看创作过程。
            </p>
            {latest ? <LatestSubmission template={latest} muted={theme.node.muted} /> : null}
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-4">
                    <div>
                        <div className={labelClass}>
                            成片视频<span className="text-[#ff6b6b]">*</span>
                        </div>
                        {video ? (
                            <div className="overflow-hidden rounded-xl border" style={panelStyle}>
                                <div className="relative aspect-video bg-black">
                                    <video
                                        ref={videoRef}
                                        src={video.url}
                                        className="size-full object-contain"
                                        controls
                                        muted
                                        playsInline
                                        preload="metadata"
                                        onLoadedMetadata={onLoadedMetadata}
                                        onSeeked={onSeeked}
                                        onError={onVideoError}
                                    />
                                    {video.status === "uploading" || video.status === "reading" ? (
                                        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-2 text-xs text-white">
                                            <LoaderCircle className="size-3.5 animate-spin" />
                                            {video.status === "reading" ? "正在读取视频…" : `上传中 ${video.progress}% · ${formatTemplateBytes((video.file.size * video.progress) / 100)} / ${formatTemplateBytes(video.file.size)}`}
                                        </div>
                                    ) : null}
                                </div>
                                {video.status === "uploading" ? (
                                    <div className="h-1 w-full" style={{ background: theme.node.stroke }}>
                                        <div className="h-full transition-[width] duration-300" style={{ width: `${video.progress}%`, background: theme.accent.primary }} />
                                    </div>
                                ) : null}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs" style={{ color: theme.node.muted }}>
                                    <span className="min-w-0 max-w-[160px] truncate" title={video.file.name}>
                                        {video.file.name}
                                    </span>
                                    {video.durationMs ? <span>{formatTemplateDuration(video.durationMs)}</span> : null}
                                    {video.width ? <span>{`${video.width}×${video.height}`}</span> : null}
                                    <span>{formatTemplateBytes(video.file.size)}</span>
                                    <span className="ml-auto flex items-center gap-1">
                                        {video.status === "done" ? (
                                            <span className="inline-flex items-center gap-1 text-[#3ecf8e]">
                                                <CheckCircle2 className="size-3.5" />
                                                已上传
                                            </span>
                                        ) : null}
                                        {video.status === "error" && video.width ? (
                                            <Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} onClick={() => void uploadVideo(video.file, { durationMs: video.durationMs, width: video.width, height: video.height })}>
                                                重试
                                            </Button>
                                        ) : null}
                                        <Button size="small" type="text" onClick={() => videoInputRef.current?.click()}>
                                            更换
                                        </Button>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={removeVideo} aria-label="移除视频" />
                                    </span>
                                </div>
                                {video.status === "error" ? (
                                    <div className="flex items-start gap-1.5 px-3 pb-2 text-xs text-[#ff6b6b]">
                                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                                        {video.error}
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div
                                role="button"
                                tabIndex={0}
                                className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 text-center transition-colors"
                                style={{ borderColor: dragging ? theme.accent.primary : theme.node.stroke, background: dragging ? theme.toolbar.activeBg : theme.node.panel }}
                                onClick={() => videoInputRef.current?.click()}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") videoInputRef.current?.click();
                                }}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setDragging(true);
                                }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={onDrop}
                            >
                                <span className="grid size-11 place-items-center rounded-full" style={{ background: theme.toolbar.activeBg }}>
                                    <Film className="size-5" />
                                </span>
                                <strong className="text-sm">点击或拖拽上传成片视频</strong>
                                <span className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                    支持 MP4 / WebM / MOV，可上传 10 分钟以上的长视频，单个文件不超过 2GB
                                </span>
                            </div>
                        )}
                        <input
                            ref={videoInputRef}
                            type="file"
                            accept={VIDEO_ACCEPT}
                            className="hidden"
                            onChange={(event) => {
                                chooseVideo(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                    </div>

                    <div>
                        <div className={labelClass}>
                            封面<span className="text-[#ff6b6b]">*</span>
                            <span className="ml-1 text-xs font-normal" style={{ color: theme.node.muted }}>
                                默认截取成片画面，也可以拖动进度条后截取或上传图片
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative grid aspect-video w-40 shrink-0 place-items-center overflow-hidden rounded-lg border" style={panelStyle}>
                                {cover ? <img src={cover.url} alt="封面预览" className="size-full object-cover" /> : <ImagePlus className="size-5" style={{ color: theme.node.muted }} />}
                                {cover?.status === "uploading" ? (
                                    <span className="absolute inset-0 grid place-items-center bg-black/50 text-white">
                                        <LoaderCircle className="size-4 animate-spin" />
                                    </span>
                                ) : null}
                            </div>
                            <div className="flex min-w-0 flex-col gap-2">
                                <Button size="small" icon={<Camera className="size-3.5" />} disabled={!video || !video.width} onClick={() => void captureCover()}>
                                    截取当前画面
                                </Button>
                                <Button size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    上传封面图片
                                </Button>
                                {cover?.status === "error" ? <span className="text-xs text-[#ff6b6b]">{cover.error}</span> : null}
                            </div>
                        </div>
                        <input
                            ref={coverInputRef}
                            type="file"
                            accept={COVER_ACCEPT}
                            className="hidden"
                            onChange={(event) => {
                                void chooseCover(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                    </div>
                </div>

                <div className="min-w-0 space-y-4">
                    <div>
                        <div className={labelClass}>
                            模版名称<span className="text-[#ff6b6b]">*</span>
                        </div>
                        <Input value={title} maxLength={40} showCount placeholder="例如：丧尸清道夫" onChange={(event) => setTitle(event.target.value)} />
                    </div>
                    <div>
                        <div className={labelClass}>
                            作品分类<span className="text-[#ff6b6b]">*</span>
                        </div>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="作品分类">
                            {CANVAS_TEMPLATE_CATEGORIES.map((item) => {
                                const active = category === item.key;
                                return (
                                    <button
                                        key={item.key}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        className="h-8 rounded-full border px-3 text-xs transition-colors"
                                        style={{ borderColor: active ? theme.accent.primary : theme.node.stroke, background: active ? theme.accent.primary : "transparent", color: active ? "#fff" : theme.node.text }}
                                        onClick={() => setCategory(item.key)}
                                    >
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <div className={labelClass}>作品简介</div>
                        <Input.TextArea value={description} maxLength={500} showCount autoSize={{ minRows: 3, maxRows: 6 }} placeholder="介绍创作思路、使用的模型和亮点，帮助其他创作者理解这个模版" onChange={(event) => setDescription(event.target.value)} />
                    </div>
                    <div>
                        <div className={labelClass}>标签</div>
                        <Select
                            mode="tags"
                            value={tags}
                            className="w-full"
                            maxCount={5}
                            tokenSeparators={[",", "，", " "]}
                            open={false}
                            suffixIcon={null}
                            placeholder="输入后回车添加，最多 5 个，例如：科幻、末日"
                            onChange={(values: string[]) => setTags(values.map((value) => value.replace(/^[#＃]+/, "").trim().slice(0, 12)).filter(Boolean).slice(0, 5))}
                        />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5" style={panelStyle}>
                        <div className="min-w-0">
                            <div className="text-[13px] font-medium">允许他人下载成片</div>
                            <div className="text-xs" style={{ color: theme.node.muted }}>
                                关闭后作品页不提供下载
                            </div>
                        </div>
                        <Switch checked={allowDownload} onChange={setAllowDownload} />
                    </div>
                    <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5" style={panelStyle}>
                        <Workflow className="mt-0.5 size-4 shrink-0" style={{ color: theme.accent.primary }} />
                        <div className="min-w-0">
                            <div className="text-[13px] font-medium">{`工程文件：当前画布 · ${nodeCount} 个节点 · ${connectionCount} 条连线`}</div>
                            <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                提交时自动保存并打包完整画布（节点、提示词、素材与连线）。他人只能只读查看创作过程，无法编辑。
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t pt-4" style={{ borderColor: theme.node.stroke }}>
                <span className="mr-auto text-xs" style={{ color: theme.node.muted }}>
                    {missing.length ? `还需完成：${missing.join("、")}` : "提交后将进入管理员审核"}
                </span>
                <Button onClick={onRequestClose}>取消</Button>
                <Button type="primary" loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>
                    {video?.status === "uploading" ? `成片上传中 ${video.progress}%` : "提交审核"}
                </Button>
            </div>
        </div>
    );
}

function LatestSubmission({ template, muted }: { template: CanvasTemplate; muted: string }) {
    const text =
        template.status === "pending"
            ? `该画布的模版「${template.title}」正在审核中，再次提交会替换审核中的版本。`
            : template.status === "approved"
              ? `该画布的模版「${template.title}」已上架首页作品区，再次提交会作为新版本进入审核。`
              : template.status === "rejected"
                ? `上次提交的「${template.title}」未通过审核${template.reviewNote ? `：${template.reviewNote}` : "。"}`
                : `模版「${template.title}」已下架${template.reviewNote ? `：${template.reviewNote}` : "。"}`;
    const color = template.status === "rejected" || template.status === "offline" ? "#ff9f43" : template.status === "approved" ? "#3ecf8e" : "#5aa9ff";
    return (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: `${color}55`, background: `${color}14`, color: muted }}>
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" style={{ color }} />
            <span>{text}</span>
        </div>
    );
}

function isVideoFile(file: File) {
    return file.type.startsWith("video/") || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 截取视频当前帧为 JPEG，长边不超过 1600px。本地 blob 地址同源，画布不会被污染。 */
async function captureVideoFrame(video: HTMLVideoElement): Promise<{ blob: Blob; width: number; height: number } | null> {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob ? { blob, width, height } : null;
}
