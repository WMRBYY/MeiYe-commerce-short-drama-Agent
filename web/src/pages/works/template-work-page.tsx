import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from "react";
import { App, Button, ConfigProvider, Input, Modal, Radio, theme as antdTheme } from "antd";
import { AnimatePresence } from "motion/react";
import { AlertCircle, ArrowLeft, Download, Ellipsis, Forward, Heart, LoaderCircle, Maximize, Minimize, Pause, Play, Share2, Volume2, VolumeX } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { TemplateAuthorAvatar } from "@/components/canvas-template/template-author-avatar";
import {
    CANVAS_TEMPLATE_REPORT_REASONS,
    canvasTemplateMediaUrl,
    formatTemplateDuration,
    getPublicCanvasTemplate,
    listPublicCanvasTemplates,
    reportCanvasTemplate,
    setCanvasTemplateLike,
    setUserFollow,
    templateQualityLabel,
    type CanvasTemplate,
    remixEcommerceWork,
} from "@/services/api/canvas-templates";
import { ApiError } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import { CreationProcessOverlay } from "./creation-process-overlay";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import "./ecommerce-work.css";

function isLoginRequired(error: unknown) {
    return error instanceof ApiError && error.status === 401;
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 作品播放页：全屏自动播放成片，顶部切换作品，底部作者、点赞、下载/分享/举报和查看创作过程。 */
export default function TemplateWorkPage() {
    const { id = "" } = useParams();
    const [searchParams] = useSearchParams();
    const from = searchParams.get("from") || "featured";
    const navigate = useNavigate();
    const location = useLocation();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const [template, setTemplate] = useState<CanvasTemplate | null>(null);
    const [list, setList] = useState<CanvasTemplate[]>([]);
    const [error, setError] = useState("");
    const [processOpen, setProcessOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [liking, setLiking] = useState(false);
    const [heartBurst, setHeartBurst] = useState(0);
    const [promptOpen, setPromptOpen] = useState(false);
    const [remixing, setRemixing] = useState(false);
    const [following, setFollowing] = useState(false);
    const resumeAfterProcessRef = useRef(false);
    const player = useVideoPlayer(template?.id || "");
    const comparisonRef = useRef<HTMLVideoElement>(null);
    const syncComparison = useCallback(() => {
        const result = player.ref.current,
            reference = comparisonRef.current;
        if (!result || !reference || !reference.readyState) return;
        const end = Number.isFinite(reference.duration) ? reference.duration : result.currentTime;
        if (Math.abs(reference.currentTime - result.currentTime) > 0.3) reference.currentTime = Math.min(result.currentTime, end);
        if (result.paused || result.ended) reference.pause();
        else if (reference.paused && !reference.ended) void reference.play().catch(() => undefined);
    }, [player.ref]);
    useEffect(() => {
        const video = player.ref.current;
        if (!video) return;
        const events = ["play", "pause", "seeking", "timeupdate", "ended"];
        events.forEach((event) => video.addEventListener(event, syncComparison));
        return () => events.forEach((event) => video.removeEventListener(event, syncComparison));
    }, [template?.id, syncComparison]);

    useEffect(() => {
        const controller = new AbortController();
        setError("");
        setTemplate(null);
        setPromptOpen(false);
        getPublicCanvasTemplate(id, controller.signal)
            .then(({ template: next }) => setTemplate(next))
            .catch((reason) => {
                if (!controller.signal.aborted) setError(errorText(reason, "作品不存在或已下架"));
            });
        return () => controller.abort();
        // 登录状态变化后重新读取点赞和关注状态。
    }, [id, user?.id]);

    useEffect(() => {
        const controller = new AbortController();
        listPublicCanvasTemplates({ category: template?.ecommerce ? "ecommerce" : from === "featured" ? undefined : from, pageSize: 50 }, controller.signal)
            .then((result) => setList(result.items))
            .catch(() => undefined);
        return () => controller.abort();
    }, [from, Boolean(template?.ecommerce)]);

    const strip = useMemo(() => {
        if (!template || list.some((item) => item.id === template.id)) return list;
        return [template, ...list];
    }, [list, template]);

    const goBack = useCallback(() => {
        if (location.key !== "default") navigate(-1);
        else navigate("/", { replace: true });
    }, [location.key, navigate]);

    const requireLogin = useCallback(() => {
        if (useUserStore.getState().user) return true;
        navigate(`/login?next=${encodeURIComponent(`/works/${id}?from=${from}`)}`);
        return false;
    }, [from, id, navigate]);

    const openProcess = () => {
        resumeAfterProcessRef.current = !player.paused;
        player.pause();
        setMenuOpen(false);
        setProcessOpen(true);
    };

    const closeProcess = useCallback(() => {
        setProcessOpen(false);
        if (resumeAfterProcessRef.current) player.play();
    }, [player]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("input,textarea,[contenteditable='true']")) return;
            if (event.key === "Escape") {
                if (reportOpen) return;
                event.preventDefault();
                if (promptOpen) setPromptOpen(false);
                else if (menuOpen) setMenuOpen(false);
                else if (processOpen) closeProcess();
                else goBack();
                return;
            }
            if (processOpen || reportOpen || promptOpen || target?.closest("button,[role='dialog']")) return;
            if (event.code === "Space") {
                event.preventDefault();
                player.toggle();
            } else if (event.key === "ArrowRight") player.seekBy(5);
            else if (event.key === "ArrowLeft") player.seekBy(-5);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [closeProcess, goBack, menuOpen, player, processOpen, reportOpen, promptOpen]);

    const toggleLike = async () => {
        if (!template || liking || !requireLogin()) return;
        const next = !template.liked;
        if (next) setHeartBurst((value) => value + 1);
        setLiking(true);
        setTemplate({ ...template, liked: next, likeCount: Math.max(0, template.likeCount + (next ? 1 : -1)) });
        try {
            const result = await setCanvasTemplateLike(template.id, next);
            setTemplate((current) => (current && current.id === template.id ? { ...current, liked: result.liked, likeCount: result.likeCount } : current));
        } catch (reason) {
            setTemplate((current) => (current && current.id === template.id ? { ...current, liked: template.liked, likeCount: template.likeCount } : current));
            if (isLoginRequired(reason)) requireLogin();
            else message.error(errorText(reason, "操作失败，请稍后重试"));
        } finally {
            setLiking(false);
        }
    };

    const remix = async () => {
        if (!template?.ecommerce || remixing || !requireLogin()) return;
        setRemixing(true);
        try {
            const material = await remixEcommerceWork(template.id);
            player.pause();
            navigate("/ecommerce?kind=video", { state: { workRemix: material, workId: template.id } });
        } catch (error) {
            message.error(errorText(error, "参考素材载入未完成，请重试"));
        } finally {
            setRemixing(false);
        }
    };

    const toggleFollow = async () => {
        if (!template || following || !requireLogin()) return;
        const next = !template.author.followed;
        setFollowing(true);
        try {
            const result = await setUserFollow(template.author.id, next);
            setTemplate((current) => (current && current.author.id === template.author.id ? { ...current, author: { ...current.author, followed: result.followed } } : current));
            setList((items) => items.map((item) => (item.author.id === template.author.id ? { ...item, author: { ...item.author, followed: result.followed } } : item)));
            message.success(result.followed ? `已关注 ${template.author.displayName}` : "已取消关注");
        } catch (reason) {
            if (isLoginRequired(reason)) requireLogin();
            else message.error(errorText(reason, "操作失败，请稍后重试"));
        } finally {
            setFollowing(false);
        }
    };

    const download = () => {
        setMenuOpen(false);
        if (!template?.allowDownload) {
            message.info("作者未开放下载");
            return;
        }
        const link = document.createElement("a");
        link.href = canvasTemplateMediaUrl(`${template.videoUrl.split("?")[0]}?download=1`);
        link.download = `${template.title}.mp4`;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const share = async () => {
        setMenuOpen(false);
        if (!template) return;
        const url = `${window.location.origin}/works/${encodeURIComponent(template.id)}`;
        try {
            await navigator.clipboard.writeText(`${template.title} ${url}`);
            message.success("作品链接已复制，快去分享吧");
        } catch {
            message.info(url);
        }
    };

    const openReport = () => {
        setMenuOpen(false);
        if (!requireLogin()) return;
        if (template?.author.isSelf) {
            message.info("不能举报自己的作品");
            return;
        }
        setReportOpen(true);
    };

    const switchTo = (next: CanvasTemplate) => {
        if (next.id === template?.id) return;
        navigate(`/works/${encodeURIComponent(next.id)}?from=${from}`, { replace: true });
    };

    return (
        <ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm }}>
            <main className={`template-work fixed inset-0 select-none overflow-hidden bg-black text-white${template?.ecommerce ? " ecw" : ""}`}>
                {template ? (
                    <video
                        key={template.id}
                        ref={player.ref}
                        src={canvasTemplateMediaUrl(template.videoUrl)}
                        poster={canvasTemplateMediaUrl(template.coverUrl)}
                        className={template.ecommerce?.referenceVideoResourceId ? "ecw-comparison-result absolute inset-0 size-full object-contain" : "absolute inset-0 size-full object-contain"}
                        playsInline
                        autoPlay
                        preload="auto"
                        onClick={player.toggle}
                        {...player.handlers}
                    />
                ) : (
                    <div className="absolute inset-0 grid place-items-center">
                        {error ? (
                            <div className="flex flex-col items-center gap-4 text-center">
                                <AlertCircle className="size-8 text-white/50" />
                                <p className="m-0 text-sm text-white/70">{error}</p>
                                <Button onClick={goBack}>返回</Button>
                            </div>
                        ) : (
                            <LoaderCircle className="size-7 animate-spin text-white/60" />
                        )}
                    </div>
                )}
                {template?.ecommerce?.referenceVideoResourceId ? (
                    <>
                        <video
                            key={template.id + "-reference"}
                            ref={comparisonRef}
                            src={canvasTemplateMediaUrl(template.ecommerce.referenceVideoResourceId)}
                            className="ecw-comparison-reference"
                            muted
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={syncComparison}
                            onClick={player.toggle}
                        />
                        <div className="ecw-comparison-labels">
                            <span>参考视频</span>
                            <span>生成结果</span>
                        </div>
                    </>
                ) : null}

                <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

                <button type="button" className="absolute left-4 top-4 z-10 grid size-9 place-items-center rounded-lg text-white/90 transition hover:bg-white/15" aria-label="返回（Esc）" title="返回（Esc）" onClick={goBack}>
                    <ArrowLeft className="size-5" />
                </button>

                {template?.ecommerce ? (
                    <>
                        <section className="ecw-references" aria-label="参考图片，悬停查看" tabIndex={0}>
                            <div className="ecw-reference-flow">
                                {template.ecommerce.referenceResourceIds.map((url, i) => (
                                    <div key={url}>
                                        <img src={canvasTemplateMediaUrl(url)} alt={`参考图 ${i + 1}`} />
                                    </div>
                                ))}
                            </div>
                        </section>
                        {strip.length > 1 ? (
                            <nav className="ecw-projects" aria-label="电商视频项目">
                                {strip.map((item) => (
                                    <button key={item.id} type="button" aria-current={item.id === template.id ? "true" : undefined} onClick={() => switchTo(item)}>
                                        <img src={canvasTemplateMediaUrl(item.coverThumbUrl || item.coverUrl)} alt="" />
                                        <span>{item.title}</span>
                                    </button>
                                ))}
                            </nav>
                        ) : null}
                        <AppModal
                            open={promptOpen}
                            title="生成提示词"
                            onCancel={() => setPromptOpen(false)}
                            footer={
                                <>
                                    <Button
                                        onClick={() =>
                                            void navigator.clipboard
                                                .writeText(template.ecommerce!.prompt)
                                                .then(() => message.success("提示词已复制"))
                                                .catch(() => message.error("复制未完成，请手动选择提示词"))
                                        }
                                    >
                                        复制提示词
                                    </Button>
                                    <Button type="primary" onClick={() => void remix()} loading={remixing}>
                                        生成同款视频
                                    </Button>
                                </>
                            }
                        >
                            <p className="ecw-model-label">{template.ecommerce.model}</p>
                            <p className="ecw-prompt">{template.ecommerce.prompt}</p>
                        </AppModal>
                    </>
                ) : null}
                {!template?.ecommerce && strip.length > 1 ? (
                    <nav aria-label="切换作品" className="template-work-strip absolute right-4 top-3 z-10 flex max-w-[min(64vw,760px)] gap-2 overflow-x-auto p-1">
                        {strip.map((item) => {
                            const active = item.id === template?.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    title={item.title}
                                    aria-current={active ? "true" : undefined}
                                    className={`relative h-[52px] w-[92px] shrink-0 overflow-hidden rounded-md transition ${active ? "opacity-100 ring-2 ring-white" : "opacity-60 hover:opacity-100"}`}
                                    onClick={() => switchTo(item)}
                                >
                                    <img src={canvasTemplateMediaUrl(item.coverThumbUrl || item.coverUrl)} alt="" className="size-full object-cover" loading="lazy" />
                                </button>
                            );
                        })}
                    </nav>
                ) : null}

                {template ? (
                    <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-2" onClick={(event) => event.stopPropagation()}>
                        <div className="ecw-info mb-3 flex items-end justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex min-w-0 items-baseline gap-2">
                                    <h1 className="m-0 truncate text-[22px] font-semibold leading-tight" title={template.title}>
                                        {template.title}
                                    </h1>
                                    <span className="shrink-0 text-xs text-white/45">内容由 AI 生成</span>
                                </div>
                                <div className="mt-2.5 flex items-center gap-2">
                                    <TemplateAuthorAvatar name={template.author.displayName} url={template.author.avatarUrl} size={28} avatarMode={template.author.avatarMode} avatarPreset={template.author.avatarPreset} />
                                    <span className="max-w-[40vw] truncate text-[15px] font-medium">{template.author.displayName}</span>
                                    {!template.author.isSelf ? (
                                        <button
                                            type="button"
                                            disabled={following}
                                            className={`ml-1 h-7 rounded-md px-3 text-xs font-medium transition ${template.author.followed ? "bg-white/10 text-white/60 hover:bg-white/15" : "bg-white/20 text-white hover:bg-white/30"}`}
                                            onClick={() => void toggleFollow()}
                                        >
                                            {template.author.followed ? "已关注" : "关注"}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            <div className="relative flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] font-medium backdrop-blur transition hover:bg-white/20"
                                    onClick={template.ecommerce ? () => void remix() : openProcess}
                                    disabled={remixing}
                                >
                                    <Share2 className="size-4" />
                                    {template.ecommerce ? (remixing ? "载入素材中…" : "一键同款") : "查看创作过程"}
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={template.liked}
                                    aria-label={template.liked ? "取消点赞" : "点赞"}
                                    className="ecw-like inline-flex h-9 min-w-[64px] items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] tabular-nums backdrop-blur transition hover:bg-white/20"
                                    onClick={() => void toggleLike()}
                                >
                                    <Heart className={`size-4 transition ${template.liked ? "scale-110 fill-[#ff4d6d] text-[#ff4d6d]" : ""}`} />
                                    {template.likeCount}
                                    {heartBurst > 0 && template.liked ? (
                                        <span key={heartBurst} className="ecw-heart-burst" aria-hidden>
                                            {Array.from({ length: 7 }, (_, i) => (
                                                <Heart key={i} style={{ "--heart-index": i } as React.CSSProperties} />
                                            ))}
                                        </span>
                                    ) : null}
                                </button>
                                <button
                                    type="button"
                                    aria-label="更多操作"
                                    aria-expanded={menuOpen}
                                    className="grid size-9 place-items-center rounded-lg bg-white/10 backdrop-blur transition hover:bg-white/20"
                                    onClick={() => setMenuOpen((value) => !value)}
                                >
                                    <Ellipsis className="size-4" />
                                </button>
                                {menuOpen ? (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                                        <div role="menu" className="absolute bottom-11 right-0 z-20 w-32 overflow-hidden rounded-xl border border-white/10 bg-[#2b2b2b]/95 p-1 shadow-2xl backdrop-blur-xl">
                                            {template.ecommerce ? (
                                                <MenuItem
                                                    icon={<Share2 className="size-4" />}
                                                    label="查看提示词"
                                                    onClick={() => {
                                                        setMenuOpen(false);
                                                        setPromptOpen(true);
                                                    }}
                                                />
                                            ) : null}
                                            <MenuItem icon={<Download className="size-4" />} label={template.allowDownload ? "下载" : "下载（未开放）"} muted={!template.allowDownload} onClick={download} />
                                            <MenuItem icon={<Forward className="size-4" />} label="分享" onClick={() => void share()} />
                                            <MenuItem icon={<AlertCircle className="size-4" />} label="举报" onClick={openReport} />
                                        </div>
                                    </>
                                ) : null}
                            </div>
                        </div>
                        <ProgressBar player={player} />
                        <div className="flex h-9 items-center justify-between">
                            <div className="flex items-center gap-3">
                                <button type="button" className="grid size-8 place-items-center rounded-md transition hover:bg-white/10" aria-label={player.paused ? "播放" : "暂停"} onClick={player.toggle}>
                                    {player.paused ? <Play className="size-[18px] fill-white" /> : <Pause className="size-[18px] fill-white" />}
                                </button>
                                <span className="text-xs tabular-nums">
                                    <span className="text-white">{formatTemplateDuration(player.currentTime * 1000)}</span>
                                    <span className="text-white/50"> / {formatTemplateDuration((player.duration || template.videoDurationMs / 1000) * 1000)}</span>
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <VolumeControl player={player} />
                                {template.ecommerce ? <span className="ecw-model">{template.ecommerce.model}</span> : null}
                                <span className="px-1 text-xs font-medium text-white/85">{templateQualityLabel(template.videoWidth, template.videoHeight)}</span>
                                <FullscreenButton />
                            </div>
                        </div>
                    </div>
                ) : null}

                <AnimatePresence>{processOpen && template ? <CreationProcessOverlay key={template.id} template={template} onClose={closeProcess} /> : null}</AnimatePresence>

                {template ? <ReportModal open={reportOpen} templateId={template.id} onClose={() => setReportOpen(false)} /> : null}
            </main>
        </ConfigProvider>
    );
}

function MenuItem({ icon, label, muted = false, onClick }: { icon: ReactNode; label: string; muted?: boolean; onClick: () => void }) {
    return (
        <button type="button" role="menuitem" className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition hover:bg-white/10 ${muted ? "text-white/45" : "text-white/90"}`} onClick={onClick}>
            {icon}
            {label}
        </button>
    );
}

type VideoPlayer = ReturnType<typeof useVideoPlayer>;

function useVideoPlayer(sourceKey: string) {
    const ref = useRef<HTMLVideoElement | null>(null);
    const [paused, setPaused] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [muted, setMuted] = useState(false);
    const [volume, setVolumeState] = useState(1);

    useEffect(() => {
        setPaused(true);
        setCurrentTime(0);
        setDuration(0);
        setBuffered(0);
    }, [sourceKey]);

    const play = useCallback(() => {
        const video = ref.current;
        if (!video) return;
        // 浏览器禁止有声自动播放时退回静音播放，用户可在右下角打开声音。
        void video.play().catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "NotAllowedError" && !video.muted) {
                video.muted = true;
                setMuted(true);
                void video.play().catch(() => undefined);
            }
        });
    }, []);
    const pause = useCallback(() => ref.current?.pause(), []);
    const toggle = useCallback(() => {
        const video = ref.current;
        if (!video) return;
        if (video.paused || video.ended) play();
        else video.pause();
    }, [play]);
    const seek = useCallback((time: number) => {
        const video = ref.current;
        if (!video || !Number.isFinite(video.duration)) return;
        video.currentTime = Math.min(video.duration, Math.max(0, time));
        setCurrentTime(video.currentTime);
    }, []);
    const seekBy = useCallback(
        (delta: number) => {
            const video = ref.current;
            if (video) seek(video.currentTime + delta);
        },
        [seek],
    );
    const setVolume = useCallback((value: number) => {
        const video = ref.current;
        if (!video) return;
        video.volume = Math.min(1, Math.max(0, value));
        video.muted = video.volume === 0;
        setVolumeState(video.volume);
        setMuted(video.muted);
    }, []);
    const toggleMute = useCallback(() => {
        const video = ref.current;
        if (!video) return;
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 0.6;
        setMuted(video.muted);
        setVolumeState(video.volume);
    }, []);

    const handlers = useMemo(
        () => ({
            onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
                const video = event.currentTarget;
                setDuration(Number.isFinite(video.duration) ? video.duration : 0);
                video.muted = muted;
                video.volume = volume;
                if (video.paused) play();
            },
            onPlay: () => setPaused(false),
            onPause: () => setPaused(true),
            onEnded: () => setPaused(true),
            onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => setCurrentTime(event.currentTarget.currentTime),
            onDurationChange: (event: SyntheticEvent<HTMLVideoElement>) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0),
            onProgress: (event: SyntheticEvent<HTMLVideoElement>) => {
                const video = event.currentTarget;
                const ranges = video.buffered;
                for (let index = ranges.length - 1; index >= 0; index--) {
                    if (ranges.start(index) <= video.currentTime) {
                        setBuffered(ranges.end(index));
                        return;
                    }
                }
            },
            onVolumeChange: (event: SyntheticEvent<HTMLVideoElement>) => {
                setMuted(event.currentTarget.muted);
                setVolumeState(event.currentTarget.volume);
            },
        }),
        [muted, play, volume],
    );

    return { ref, paused, currentTime, duration, buffered, muted, volume, play, pause, toggle, seek, seekBy, setVolume, toggleMute, handlers };
}

function ProgressBar({ player }: { player: VideoPlayer }) {
    const barRef = useRef<HTMLDivElement>(null);
    const [dragTime, setDragTime] = useState<number | null>(null);
    const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
    const duration = player.duration || 0;
    const shown = dragTime ?? player.currentTime;
    const ratio = duration > 0 ? Math.min(1, shown / duration) : 0;
    const bufferedRatio = duration > 0 ? Math.min(1, player.buffered / duration) : 0;

    const timeAt = (clientX: number) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || !duration) return { x: 0, time: 0 };
        const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
        return { x, time: (x / rect.width) * duration };
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!duration) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragTime(timeAt(event.clientX).time);
    };
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const point = timeAt(event.clientX);
        setHover(point);
        if (dragTime !== null) setDragTime(point.time);
    };
    const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragTime === null) return;
        player.seek(timeAt(event.clientX).time);
        setDragTime(null);
    };

    return (
        <div
            ref={barRef}
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(shown)}
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    event.stopPropagation();
                    player.seekBy(event.key === "ArrowRight" ? 5 : -5);
                } else if (event.key === "Home") {
                    event.preventDefault();
                    player.seek(0);
                } else if (event.key === "End") {
                    event.preventDefault();
                    player.seek(duration);
                }
            }}
            className="group relative flex h-3 cursor-pointer items-center"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
        >
            <div className="relative h-[2px] w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover:h-1">
                <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufferedRatio * 100}%` }} />
                <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${ratio * 100}%` }} />
            </div>
            <span className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100" style={{ left: `${ratio * 100}%` }} />
            {hover && duration ? (
                <span className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums text-white" style={{ left: hover.x }}>
                    {formatTemplateDuration(hover.time * 1000)}
                </span>
            ) : null}
        </div>
    );
}

function VolumeControl({ player }: { player: VideoPlayer }) {
    const level = player.muted ? 0 : player.volume;
    return (
        <div className="group flex items-center">
            <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={level}
                aria-label="音量"
                className="mr-1 h-1 w-0 cursor-pointer accent-white opacity-0 transition-all duration-200 group-hover:w-20 group-hover:opacity-100 group-focus-within:w-20 group-focus-within:opacity-100"
                onChange={(event) => player.setVolume(Number(event.target.value))}
            />
            <button type="button" className="grid size-8 place-items-center rounded-md transition hover:bg-white/10" aria-label={player.muted ? "打开声音" : "静音"} onClick={player.toggleMute}>
                {level === 0 ? <VolumeX className="size-[18px]" /> : <Volume2 className="size-[18px]" />}
            </button>
        </div>
    );
}

function FullscreenButton() {
    const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
    useEffect(() => {
        const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);
    const toggle = () => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void document.documentElement.requestFullscreen().catch(() => undefined);
    };
    return (
        <button type="button" className="grid size-8 place-items-center rounded-md transition hover:bg-white/10" aria-label={fullscreen ? "退出全屏" : "全屏"} onClick={toggle}>
            {fullscreen ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}
        </button>
    );
}

function ReportModal({ open, templateId, onClose }: { open: boolean; templateId: string; onClose: () => void }) {
    const { message } = App.useApp();
    const [reason, setReason] = useState<string>("");
    const [detail, setDetail] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setReason("");
            setDetail("");
        }
    }, [open]);

    const submit = async () => {
        if (!reason) return;
        setSubmitting(true);
        try {
            await reportCanvasTemplate(templateId, { reason, detail: detail.trim() });
            message.success("举报已提交，我们会尽快核实处理");
            onClose();
        } catch (error) {
            message.error(errorText(error, "举报提交失败，请稍后重试"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal title="举报作品" open={open} onCancel={onClose} onOk={() => void submit()} okText="提交举报" cancelText="取消" okButtonProps={{ disabled: !reason, loading: submitting, danger: true }} centered width={420} destroyOnHidden>
            <Radio.Group value={reason} onChange={(event) => setReason(event.target.value)} className="!grid grid-cols-2 gap-2 py-2">
                {CANVAS_TEMPLATE_REPORT_REASONS.map((item) => (
                    <Radio key={item.key} value={item.key}>
                        {item.label}
                    </Radio>
                ))}
            </Radio.Group>
            <Input.TextArea value={detail} maxLength={300} showCount autoSize={{ minRows: 3, maxRows: 5 }} placeholder="补充说明（选填）" onChange={(event) => setDetail(event.target.value)} />
        </Modal>
    );
}
