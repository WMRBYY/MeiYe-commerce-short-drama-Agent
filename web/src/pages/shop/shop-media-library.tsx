import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ClipboardPaste, Film, FolderOpen, Link2, LoaderCircle, Mic, Music2, Pause, Play, Search, Square, Star, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { loadAssetLibraryPage } from "@/services/user-data-sync";
import type { Asset } from "@/stores/use-asset-store";
import "./shop-media-library.css";

import { useShopScope } from "./shop-context";
import { favoriteWithNotice, useShopFavorites } from "./shop-edits";

export type MediaKind = "video" | "audio";
export type MediaPick = { resourceId: string; name: string; origin?: "我的作品" | "我的素材" };
type Item = MediaPick & { id: string; url: string; cover?: string; durationMs?: number };
type Source = "works" | "mine";

function durationText(ms?: number) {
    if (!ms) return "";
    const seconds = Math.round(ms / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`;
}

function assetItem(asset: Asset): Item | null {
    if (asset.kind !== "video" && asset.kind !== "audio") return null;
    const resourceId = resourceIdFromStorageKey(asset.data.storageKey) || "";
    if (!resourceId) return null;
    return { origin: "我的素材", id: asset.id, resourceId, name: asset.title || (asset.kind === "video" ? "视频" : "音频"), url: resourceFileUrl(resourceId), cover: asset.coverUrl || undefined, durationMs: asset.data.durationMs };
}

/** 把一段录音解码后重新编码成 16 位 PCM WAV：各家模型都认 WAV，浏览器原生录出的 webm 很多不收。 */
async function toWav(blob: Blob) {
    const context = new AudioContext();
    try {
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        const channels = Math.min(2, buffer.numberOfChannels);
        const length = buffer.length * channels * 2 + 44;
        const view = new DataView(new ArrayBuffer(length));
        const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
        write(0, "RIFF");
        view.setUint32(4, length - 8, true);
        write(8, "WAVE");
        write(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, buffer.sampleRate, true);
        view.setUint32(28, buffer.sampleRate * channels * 2, true);
        view.setUint16(32, channels * 2, true);
        view.setUint16(34, 16, true);
        write(36, "data");
        view.setUint32(40, length - 44, true);
        const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
        let offset = 44;
        for (let index = 0; index < buffer.length; index++)
            for (let channel = 0; channel < channels; channel++) {
                const sample = Math.max(-1, Math.min(1, data[channel][index]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
                offset += 2;
            }
        return new Blob([view], { type: "audio/wav" });
    } finally {
        void context.close();
    }
}

/** 录音：麦克风录一段，停止或到时长上限后转成 WAV 交给上传。 */
function Recorder({ maxSeconds, onDone }: { maxSeconds: number; onDone: (file: File) => Promise<void> }) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
    const [elapsed, setElapsed] = useState(0);
    const [level, setLevel] = useState(0);
    const recorder = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const frame = useRef(0);

    const cleanup = () => {
        window.clearInterval(timer.current);
        cancelAnimationFrame(frame.current);
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null;
    };
    useEffect(() => cleanup, []);

    const start = async () => {
        try {
            const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            stream.current = media;
            const chunks: Blob[] = [];
            const rec = new MediaRecorder(media);
            recorder.current = rec;
            rec.ondataavailable = (event) => event.data.size && chunks.push(event.data);
            rec.onstop = async () => {
                cleanup();
                setState("saving");
                try {
                    const wav = await toWav(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
                    await onDone(new File([wav], `录音-${new Date().toLocaleTimeString("zh-CN", { hour12: false }).replace(/:/g, "")}.wav`, { type: "audio/wav" }));
                    setOpen(false);
                } catch (cause) {
                    message.error(cause instanceof Error ? cause.message : "录音保存失败");
                } finally {
                    setState("idle");
                    setElapsed(0);
                }
            };
            // 音量条：让用户看到麦克风确实在收音。
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            audioContext.createMediaStreamSource(media).connect(analyser);
            const samples = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
                analyser.getByteFrequencyData(samples);
                setLevel(samples.reduce((sum, value) => sum + value, 0) / samples.length / 255);
                frame.current = requestAnimationFrame(tick);
            };
            tick();
            rec.start();
            setState("recording");
            const startedAt = Date.now();
            timer.current = window.setInterval(() => {
                const seconds = (Date.now() - startedAt) / 1000;
                setElapsed(seconds);
                if (seconds >= maxSeconds) rec.state === "recording" && rec.stop();
            }, 100);
        } catch {
            message.error("没能打开麦克风，请在浏览器地址栏允许使用麦克风后重试");
        }
    };
    const stop = () => recorder.current?.state === "recording" && recorder.current.stop();

    return (
        <div className="sml-record-wrap">
            <button type="button" className="sml-record-btn" data-open={open || undefined} onClick={() => setOpen((value) => !value)}>
                <Mic className="size-3.5" />
                录音
            </button>
            <AnimatePresence>
                {open ? (
                    <motion.div className="sml-record-pop" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
                        <strong>录音</strong>
                        <p>用麦克风录一段，停止后自动上传，最长 {maxSeconds} 秒</p>
                        {state === "recording" ? (
                            <div className="sml-record-live">
                                <i className="sml-record-dot" />
                                <span className="sml-record-bars" aria-hidden>
                                    {Array.from({ length: 14 }, (_, index) => (
                                        <i key={index} style={{ transform: `scaleY(${0.2 + Math.min(1, level * 2.2) * (0.4 + Math.abs(Math.sin(index * 1.7 + elapsed * 6)) * 0.6)})` }} />
                                    ))}
                                </span>
                                <b>{elapsed.toFixed(1)}s</b>
                            </div>
                        ) : null}
                        <div className="sml-record-actions">
                            {state === "recording" ? (
                                <button type="button" className="sml-btn-ink" onClick={stop}>
                                    <Square className="size-3" fill="currentColor" /> 停止并上传
                                </button>
                            ) : (
                                <button type="button" className="sml-btn-ink" disabled={state === "saving"} onClick={() => void start()}>
                                    {state === "saving" ? <LoaderCircle className="sp-spin size-3.5" /> : <Mic className="size-3.5" />}
                                    {state === "saving" ? "正在上传" : "开始录音"}
                                </button>
                            )}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

/**
 * 视频卡：首帧做封面（读到元数据后跳到 0.1 秒，避免黑屏）；悬停静音循环播放，
 * 右下角播放按钮打开带声音和进度条的预览。
 */
function VideoThumb({ src, cover, onPreview }: { src: string; cover?: string; onPreview: () => void }) {
    const video = useRef<HTMLVideoElement>(null);
    const [hover, setHover] = useState(false);
    useEffect(() => {
        const node = video.current;
        if (!node) return;
        if (hover) void node.play().catch(() => undefined);
        else node.pause();
    }, [hover]);
    return (
        <span className="sml-thumb" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
            {cover && !hover ? <img src={cover} alt="" loading="lazy" /> : null}
            <video
                ref={video}
                src={src}
                muted
                loop
                playsInline
                preload="metadata"
                data-hidden={(cover && !hover) || undefined}
                onLoadedMetadata={(event) => {
                    if (event.currentTarget.currentTime === 0) event.currentTarget.currentTime = 0.1;
                }}
            />
            <span
                role="button"
                tabIndex={0}
                className="sml-play"
                aria-label="播放预览"
                onClick={(event) => {
                    event.stopPropagation();
                    onPreview();
                }}
                onDoubleClick={(event) => event.stopPropagation()}
            >
                <Play className="size-4" fill="currentColor" />
            </span>
        </span>
    );
}

/** 列表里的一条音频：点播放就在弹窗里试听。 */
function AudioRow({
    item,
    playing,
    onPlay,
    selected,
    favorite,
    onFavorite,
    onRemove,
    onClick,
    onDoubleClick,
}: {
    item: Item;
    playing: boolean;
    onPlay: () => void;
    selected: boolean;
    favorite: boolean;
    onFavorite?: () => void;
    onRemove?: () => void;
    onClick: () => void;
    onDoubleClick: () => void;
}) {
    return (
        <motion.div layout className="sml-audio" data-selected={selected || undefined} onClick={onClick} onDoubleClick={onDoubleClick} role="option" aria-selected={selected}>
            <button
                type="button"
                className="sml-audio-play"
                data-playing={playing || undefined}
                aria-label={playing ? "暂停" : "试听"}
                onClick={(event) => {
                    event.stopPropagation();
                    onPlay();
                }}
            >
                {playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
            </button>
            <span className="sml-audio-wave" data-playing={playing || undefined} aria-hidden>
                {Array.from({ length: 22 }, (_, index) => (
                    <i key={index} style={{ height: `${30 + ((index * 37) % 60)}%`, animationDelay: `${index * 0.05}s` }} />
                ))}
            </span>
            <span className="sml-audio-text">
                <strong>{item.name}</strong>
                <small>{durationText(item.durationMs) || "音频"}</small>
            </span>
            {onFavorite ? (
                <button
                    type="button"
                    className="sml-fav"
                    data-on={favorite || undefined}
                    aria-label={favorite ? "取消收藏" : "收藏"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onFavorite();
                    }}
                >
                    <Star className="size-3.5" />
                </button>
            ) : null}
            {onRemove ? (
                <button
                    type="button"
                    className="sml-remove"
                    aria-label={`移除${item.name}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove();
                    }}
                >
                    <X className="size-3.5" />
                </button>
            ) : null}

            {selected ? (
                <span className="sml-check">
                    <Check className="size-3" strokeWidth={3} />
                </span>
            ) : null}
        </motion.div>
    );
}

/**
 * 素材库弹窗（参考视频 / 参考音频）：左边选来源和「只看收藏」，右边第一格本地上传，
 * 视频可以粘贴短视频链接解析，音频可以直接录音；单击选择，双击直接填入。
 */
export function ShopMediaLibrary({
    kind,
    label = kind === "video" ? "参考视频" : "参考音频",
    open,
    max = 1,
    current,
    onClose,
    onPick,
    onUpload,
    onRemove,
    works = [],
    link,
    onParseLink,
    recordSeconds = 15,
    extra,
}: {
    kind: MediaKind;
    label?: string;
    open: boolean;
    max?: number;
    /** 已填入的素材，弹窗里标出并可试听。 */
    current?: MediaPick[];
    onClose: () => void;
    onPick: (items: MediaPick[]) => void;
    onUpload: (files: File[]) => Promise<void> | void;
    onRemove?: (item: MediaPick) => void;
    works?: Array<{ resourceId: string; name: string; cover?: string; durationMs?: number }>;
    link?: { text: string; setText: (value: string) => void; busy: boolean; error?: string; progress?: ReactNode; parse: () => Promise<void> | void; paste: () => Promise<void> | void };
    onParseLink?: () => void;
    recordSeconds?: number;
    extra?: ReactNode;
}) {
    const { message } = App.useApp();
    const reduced = useReducedMotion();
    const scope = useShopScope();
    const favorites = useShopFavorites(scope);
    const [source, setSource] = useState<Source>("mine");
    const [favOnly, setFavOnly] = useState(false);
    const [query, setQuery] = useState("");
    const [picked, setPicked] = useState<Item[]>([]);
    const [linkOpen, setLinkOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [playing, setPlaying] = useState("");
    const [preview, setPreview] = useState<Item | null>(null);
    const player = useRef<HTMLAudioElement | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const dialog = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const previewOpenRef = useRef(false);
    previewOpenRef.current = Boolean(preview);

    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusable = () =>
            Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]') || []).filter(
                (element) => element.getClientRects().length > 0,
            );
        const frame = requestAnimationFrame(() => (focusable()[0] || dialog.current)?.focus());
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (previewOpenRef.current) setPreview(null);
                else onCloseRef.current();
            } else if (event.key === "Tab") {
                const items = focusable();
                const first = items[0];
                const last = items.at(-1);
                if (!first) {
                    event.preventDefault();
                    dialog.current?.focus();
                    return;
                }
                if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener("keydown", keydown, true);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("keydown", keydown, true);
            if (previous?.isConnected) previous.focus();
        };
    }, [open]);

    useEffect(() => {
        if (!open) {
            setPicked([]);
            setLinkOpen(false);
            setPreview(null);
            player.current?.pause();
            setPlaying("");
        }
    }, [open]);
    useEffect(() => () => player.current?.pause(), []);

    const assets = useQuery({
        queryKey: ["shop-media-library", scope, kind],
        queryFn: ({ signal }) => loadAssetLibraryPage({ page: 1, pageSize: 100, status: "active", kind, signal }),
        enabled: open && Boolean(scope),
        staleTime: 30_000,
    });
    const items = useMemo<Item[]>(() => {
        let list: Item[] = [];
        if (source === "mine") list = (assets.data?.assets || []).map(assetItem).filter((item): item is Item => Boolean(item));
        else if (source === "works") list = works.map((work) => ({ origin: "我的作品", id: work.resourceId, resourceId: work.resourceId, name: work.name, url: resourceFileUrl(work.resourceId), cover: work.cover, durationMs: work.durationMs }));
        else list = [];
        const text = query.trim();
        return list.filter((item) => (!favOnly || (item.resourceId && favorites.has(item.resourceId))) && (!text || item.name.includes(text)));
    }, [assets.data?.assets, favOnly, favorites, query, source, works]);
    const currentIds = new Set((current || []).map((item) => item.resourceId));
    const currentItems: Item[] = (current || []).map((item) => ({ id: `current:${item.resourceId}`, resourceId: item.resourceId, name: item.name, url: resourceFileUrl(item.resourceId) }));

    const play = (item: Item) => {
        if (playing === item.id) {
            player.current?.pause();
            setPlaying("");
            return;
        }
        player.current?.pause();
        const audio = new Audio(item.url);
        audio.onended = () => setPlaying("");
        void audio.play().catch(() => message.error("这段音频暂时无法播放"));
        player.current = audio;
        setPlaying(item.id);
    };
    const toggle = (item: Item) =>
        setPicked((list) => {
            if (list.some((entry) => entry.id === item.id)) return list.filter((entry) => entry.id !== item.id);
            if (max <= 0) return list;
            return max === 1 ? [item] : list.length >= max ? list : [...list, item];
        });
    const confirm = async (list = picked) => {
        const selection = list.slice(0, max);
        if (!selection.length) return;
        onPick(selection.map(({ resourceId, name, origin }) => ({ resourceId, name, origin })));
        onClose();
    };
    const upload = async (files: File[]) => {
        if (!files.length || max <= 0) return;
        setUploading(true);
        try {
            await onUpload(files.slice(0, max));
            onClose();
        } finally {
            setUploading(false);
        }
    };

    const sources: Array<[Source, string, ReactNode]> =
        kind === "video"
            ? [
                  ["works", "我的作品", <Film key="w" className="size-3.5" />],
                  ["mine", "我的素材", <FolderOpen key="m" className="size-3.5" />],
              ]
            : [["mine", "我的素材", <FolderOpen key="m" className="size-3.5" />]];

    return createPortal(
        <AnimatePresence>
            {open ? (
                <motion.div className="sml-scrim ms-scope" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
                    <motion.div
                        className="sml"
                        ref={dialog}
                        role="dialog"
                        aria-modal="true"
                        tabIndex={-1}
                        aria-label={`素材库 · ${label}`}
                        initial={reduced ? false : { opacity: 0, y: 20, scale: 0.97, filter: "blur(6px)" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: 12, scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 340, damping: 32 }}
                    >
                        <aside className="sml-side">
                            <h3>素材库</h3>
                            <small>来源</small>
                            {sources.map(([id, text, icon]) => (
                                <button key={id} type="button" className="sml-source" data-active={source === id || undefined} onClick={() => setSource(id)}>
                                    {source === id ? <motion.i layoutId="sml-source-pill" className="sml-source-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
                                    {icon}
                                    <span>{text}</span>
                                </button>
                            ))}
                            <small>范围</small>
                            <label className="sml-check-row">
                                <input type="checkbox" checked={favOnly} onChange={(event) => setFavOnly(event.target.checked)} />
                                只看收藏
                            </label>
                        </aside>
                        <AnimatePresence>
                            {preview ? (
                                <motion.div key="preview" className="sml-preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPreview(null)}>
                                    <motion.video src={preview.url} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} initial={{ scale: 0.94 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 360, damping: 30 }} />
                                    <div className="sml-preview-bar" onClick={(event) => event.stopPropagation()}>
                                        <strong>{preview.name}</strong>
                                        <button type="button" className="sml-btn" onClick={() => setPreview(null)}>
                                            返回
                                        </button>
                                        <button type="button" className="sml-btn-ink" onClick={() => void confirm([preview])}>
                                            填入{label}
                                        </button>
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                        <section className="sml-main">
                            <header className="sml-head">
                                <div>
                                    <h4>{sources.find(([id]) => id === source)?.[1]}</h4>
                                    <span className="sml-target">
                                        将填入 <em>→ {label}</em>
                                    </span>
                                </div>
                                <label className="sml-search">
                                    <Search className="size-3.5" />
                                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" />
                                </label>
                                <button type="button" className="sml-close" aria-label="关闭" onClick={onClose}>
                                    <X className="size-4" />
                                </button>
                            </header>
                            {currentItems.length ? (
                                <div className="sml-current">
                                    <small>已填入</small>
                                    {kind === "audio" ? (
                                        currentItems.map((item) => (
                                            <AudioRow
                                                key={item.id}
                                                item={item}
                                                playing={playing === item.id}
                                                onPlay={() => play(item)}
                                                selected={false}
                                                favorite={favorites.has(item.resourceId)}
                                                onRemove={onRemove ? () => onRemove({ resourceId: item.resourceId, name: item.name }) : undefined}
                                                onFavorite={() => void favoriteWithNotice(message, scope, item.resourceId)}
                                                onClick={() => play(item)}
                                                onDoubleClick={() => undefined}
                                            />
                                        ))
                                    ) : (
                                        <div className="sml-current-video">
                                            {currentItems.map((item) => (
                                                <div key={item.id} className="sml-current-video-item">
                                                    <video src={item.url} controls preload="metadata" />
                                                    {onRemove ? (
                                                        <button type="button" className="sml-remove" aria-label={`移除${item.name}`} onClick={() => onRemove({ resourceId: item.resourceId, name: item.name })}>
                                                            <X className="size-3.5" />
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : null}
                            <div className="sml-body" data-kind={kind}>
                                <div className="sml-upload-col">
                                    <button
                                        type="button"
                                        className="sml-upload"
                                        data-kind={kind}
                                        disabled={uploading || max <= 0}
                                        onClick={() => fileInput.current?.click()}
                                        onDragOver={(event) => {
                                            if (kind === "video") event.preventDefault();
                                        }}
                                        onDrop={(event) => {
                                            if (kind !== "video") return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            if (!uploading) void upload(Array.from(event.dataTransfer.files));
                                        }}
                                    >
                                        <span className="sml-upload-icon">{uploading ? <LoaderCircle className="sp-spin size-4" /> : <Upload className="size-4" />}</span>
                                        <strong>本地上传</strong>
                                        <small>{kind === "video" ? "或把文件拖进来 · MP4 / MOV" : `上传 1 段参考音频，台词按这个声音配音；不上传就自动生成配音`}</small>
                                    </button>
                                    <input
                                        ref={fileInput}
                                        type="file"
                                        hidden
                                        accept={kind === "video" ? "video/mp4,video/quicktime,.mp4,.mov" : "audio/*"}
                                        disabled={max <= 0}
                                        onChange={(event) => (void upload([...(event.target.files || [])]), (event.target.value = ""))}
                                    />
                                    {kind === "video" && onParseLink ? (
                                        <button type="button" className="sml-record-btn" onClick={onParseLink}>
                                            <Link2 className="size-3.5" />
                                            短视频解析
                                        </button>
                                    ) : kind === "video" && link ? (
                                        <div className="sml-link-wrap">
                                            <button type="button" className="sml-record-btn" data-open={linkOpen || undefined} onClick={() => setLinkOpen((value) => !value)}>
                                                <Link2 className="size-3.5" />
                                                短视频解析
                                            </button>
                                            <AnimatePresence>
                                                {linkOpen ? (
                                                    <motion.div
                                                        className="sml-record-pop"
                                                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                                        exit={{ opacity: 0, y: -4 }}
                                                        transition={{ type: "spring", stiffness: 420, damping: 30 }}
                                                    >
                                                        <strong>
                                                            视频链接解析 <small>抖音 / 快手 / 小红书 / 视频号</small>
                                                        </strong>
                                                        <input className="sml-link-input" value={link.text} onChange={(event) => link.setText(event.target.value)} placeholder="粘贴视频链接或分享文案" />
                                                        {link.progress ? <div className="sml-link-progress">{link.progress}</div> : null}
                                                        {link.error ? <p className="sml-link-error">{link.error}</p> : null}
                                                        <div className="sml-record-actions">
                                                            <button type="button" className="sml-btn" onClick={() => void link.paste()}>
                                                                <ClipboardPaste className="size-3.5" /> 粘贴
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="sml-btn-ink"
                                                                disabled={link.busy || !link.text.trim()}
                                                                onClick={async () => {
                                                                    await link.parse();
                                                                }}
                                                            >
                                                                {link.busy ? <LoaderCircle className="sp-spin size-3.5" /> : null}
                                                                解析
                                                            </button>
                                                        </div>
                                                    </motion.div>
                                                ) : null}
                                            </AnimatePresence>
                                        </div>
                                    ) : null}
                                    {kind === "audio" && max > 0 ? <Recorder maxSeconds={recordSeconds} onDone={(file) => upload([file])} /> : null}
                                    {extra}
                                </div>
                                {kind === "video" ? (
                                    <div className="sml-grid">
                                        {items.map((item, index) => {
                                            const selected = picked.some((entry) => entry.id === item.id);
                                            const fav = favorites.has(item.resourceId);
                                            return (
                                                <motion.button
                                                    key={item.id}
                                                    type="button"
                                                    className="sml-video"
                                                    data-selected={selected || undefined}
                                                    data-current={currentIds.has(item.resourceId) || undefined}
                                                    onClick={() => toggle(item)}
                                                    onDoubleClick={() => void confirm([item])}
                                                    initial={reduced ? false : { opacity: 0, scale: 0.95 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    transition={{ delay: Math.min(index, 16) * 0.02 }}
                                                    title={item.name}
                                                >
                                                    <VideoThumb src={item.url} cover={item.cover} onPreview={() => setPreview(item)} />
                                                    {item.durationMs ? <em>{durationText(item.durationMs)}</em> : null}
                                                    <span
                                                        role="button"
                                                        tabIndex={0}
                                                        className="sml-fav"
                                                        data-on={fav || undefined}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            void favoriteWithNotice(message, scope, item.resourceId);
                                                        }}
                                                    >
                                                        <Star className="size-3.5" />
                                                    </span>
                                                    {selected ? (
                                                        <span className="sml-check">
                                                            <Check className="size-3" strokeWidth={3} />
                                                        </span>
                                                    ) : null}
                                                </motion.button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="sml-list" role="listbox">
                                        {items.map((item) => (
                                            <AudioRow
                                                key={item.id}
                                                item={item}
                                                playing={playing === item.id}
                                                onPlay={() => play(item)}
                                                selected={picked.some((entry) => entry.id === item.id)}
                                                favorite={Boolean(item.resourceId && favorites.has(item.resourceId))}
                                                onFavorite={item.resourceId ? () => void favoriteWithNotice(message, scope, item.resourceId) : undefined}
                                                onClick={() => toggle(item)}
                                                onDoubleClick={() => void confirm([item])}
                                            />
                                        ))}
                                    </div>
                                )}
                                {source === "mine" && assets.isLoading ? (
                                    <div className="sml-empty">
                                        <LoaderCircle className="sp-spin size-4" /> 正在读取素材
                                    </div>
                                ) : max <= 0 ? (
                                    <div className="sml-empty">已达到参考音频数量上限，请先移除已填入的音频</div>
                                ) : !items.length ? (
                                    <div className="sml-empty">{favOnly ? "还没有收藏的素材" : "这里还没有素材，可以先从第一格本地上传"}</div>
                                ) : null}
                            </div>
                            <footer className="sml-foot">
                                <span>
                                    单击选择，双击直接填入 · 最多 {max} {kind === "video" ? "个" : "段"}
                                </span>
                                <button type="button" className="sml-btn" onClick={onClose}>
                                    取消
                                </button>
                                <button type="button" className="sml-btn-ink" disabled={!picked.length || uploading} onClick={() => void confirm()}>
                                    填入{label}
                                </button>
                            </footer>
                        </section>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>,
        document.body,
    );
}
