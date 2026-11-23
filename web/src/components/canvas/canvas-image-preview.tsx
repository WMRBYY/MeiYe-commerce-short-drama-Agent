import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal";
import { resolveImagePreviewUrl, resolveImageUrl } from "@/services/image-storage";
import { useCachedResourceUrl } from "@/hooks/use-cached-resource-url";
import { getActiveUserScope } from "@/lib/user-scope";
import "./canvas-image-preview.css";

/** 当前图片在同组结果中的位置；多于一张时显示左右切换，并支持键盘左右方向键。 */
export type CanvasImagePreviewNavigation = {
    index: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
};

type CanvasImagePreviewProps = {
    src?: string;
    storageKey?: string;
    /** Already loaded card thumbnail; never used as the original image. */
    previewSrc?: string;
    alt?: string;
    navigation?: CanvasImagePreviewNavigation;
    interactive?: boolean;
    onClose: () => void;
};

type CanvasImagePreviewImageProps = Pick<CanvasImagePreviewProps, "src" | "storageKey" | "previewSrc" | "alt" | "interactive">;

const navigationButtonClass =
    "absolute top-1/2 z-20 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border shadow-sm transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] motion-reduce:transition-none";
const navigationButtonStyle: CSSProperties = {
    borderColor: "var(--workspace-border-strong)",
    background: "color-mix(in srgb, var(--workspace-surface-strong) 88%, transparent)",
    color: "var(--foreground)",
    backdropFilter: "blur(8px)",
};

function editableKeyTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export function CanvasImagePreview(props: CanvasImagePreviewProps) {
    if (!props.src && !props.storageKey) return null;
    return <CanvasImagePreviewDialog {...props} />;
}

function CanvasImagePreviewDialog({ src = "", storageKey, previewSrc = "", alt = "图片", navigation, interactive = true, onClose }: CanvasImagePreviewProps) {
    const { t } = useTranslation();
    const navigable = Boolean(navigation && navigation.total > 1);

    useEffect(() => {
        if (!navigation || navigation.total < 2) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || editableKeyTarget(event.target)) return;
            event.preventDefault();
            if (event.key === "ArrowLeft") navigation.onPrevious();
            else navigation.onNext();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [navigation]);

    return (
        <AppModal
            open
            flush
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] border"
                        style={{
                            borderColor: "var(--workspace-border)",
                            background: "color-mix(in srgb, var(--workspace-surface-strong) 72%, var(--workspace-surface))",
                            color: "var(--workspace-text-muted)",
                        }}
                    >
                        <ImageIcon className="size-4" />
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold" title={alt}>
                        {alt}
                    </span>
                    {navigable && navigation ? (
                        <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums" style={{ borderColor: "var(--workspace-border)", color: "var(--workspace-text-muted)" }} aria-live="polite">
                            {navigation.index + 1} / {navigation.total}
                        </span>
                    ) : null}
                </div>
            }
            footer={null}
            centered
            width={interactive ? "min(1800px, calc(100vw - 32px))" : "min(1160px, calc(100vw - 32px))"}
            onCancel={onClose}
            className={`canvas-image-preview-modal${interactive ? " is-interactive" : ""}`}
        >
            <div
                className="flex min-h-[min(72vh,680px)] items-center justify-center border-t p-4 sm:p-6"
                style={{
                    borderColor: "var(--workspace-border)",
                    background: "color-mix(in srgb, var(--workspace-surface) 86%, var(--background))",
                }}
            >
                <div
                    className="relative flex min-h-[min(62vh,560px)] w-full items-center justify-center overflow-hidden rounded-[var(--r-lg)] border p-3 sm:p-5"
                    style={{
                        borderColor: "var(--workspace-border-strong)",
                        background: "var(--workspace-surface-strong)",
                        boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--foreground) 5%, transparent), 0 18px 50px color-mix(in srgb, var(--foreground) 14%, transparent)",
                    }}
                >
                    {/* 切换图片只重建图片层，弹窗保持打开，不重复播放开场动画。 */}
                    <ImagePreviewViewport key={`${getActiveUserScope()}:${storageKey || ""}:${src}:${navigation?.index ?? 0}`} src={src} storageKey={storageKey} previewSrc={previewSrc} alt={alt} interactive={interactive} />
                    {navigable && navigation ? (
                        <>
                            <button
                                type="button"
                                className={`${navigationButtonClass} left-3 sm:left-4`}
                                style={navigationButtonStyle}
                                aria-label={t("canvasB.imagePreview.previous")}
                                title={t("canvasB.imagePreview.previous")}
                                onClick={navigation.onPrevious}
                            >
                                <ChevronLeft className="size-5" />
                            </button>
                            <button type="button" className={`${navigationButtonClass} right-3 sm:right-4`} style={navigationButtonStyle} aria-label={t("canvasB.imagePreview.next")} title={t("canvasB.imagePreview.next")} onClick={navigation.onNext}>
                                <ChevronRight className="size-5" />
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
        </AppModal>
    );
}

export function ImagePreviewViewport({ src = "", storageKey, previewSrc = "", alt = "图片", interactive = true }: CanvasImagePreviewImageProps) {
    const { t } = useTranslation();
    const cachedUrl = useCachedResourceUrl(storageKey);
    const [resolvedSrc, setResolvedSrc] = useState(storageKey ? "" : src);
    const [loading, setLoading] = useState(Boolean(src || storageKey));
    const [error, setError] = useState(false);
    const [thumbnail, setThumbnail] = useState(previewSrc);
    const [thumbnailReady, setThumbnailReady] = useState(Boolean(previewSrc));
    const viewport = useRef<HTMLDivElement>(null);
    const originalImage = useRef<HTMLImageElement>(null);
    const thumbnailImage = useRef<HTMLImageElement>(null);
    const drag = useRef<{ id: number; x: number; y: number } | null>(null);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const bounded = (next: typeof view) => {
        const box = viewport.current;
        const image = originalImage.current?.naturalWidth ? originalImage.current : thumbnailImage.current;
        if (!box || !image?.naturalWidth || !image.naturalHeight) return { scale: next.scale, x: 0, y: 0 };
        const fit = Math.min(box.clientWidth / image.naturalWidth, box.clientHeight / image.naturalHeight);
        const maxX = Math.max(0, (image.naturalWidth * fit * next.scale - box.clientWidth) / 2);
        const maxY = Math.max(0, (image.naturalHeight * fit * next.scale - box.clientHeight) / 2);
        return { ...next, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    };
    useEffect(() => {
        const box = viewport.current;
        if (!interactive || !box) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const image = originalImage.current?.naturalWidth ? originalImage.current : thumbnailImage.current;
            if (!image?.naturalWidth) return;
            const rect = box.getBoundingClientRect();
            const x = event.clientX - rect.left - rect.width / 2;
            const y = event.clientY - rect.top - rect.height / 2;
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.clientHeight : 1);
            setView((previous) => {
                const scale = Math.max(1, Math.min(8, previous.scale * Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002)));
                const ratio = scale / previous.scale;
                return bounded({ scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio });
            });
        };
        // 非 passive 监听将滚轮限定在图片内，避免缩放或滚动背景页面。
        box.addEventListener("wheel", wheel, { passive: false });
        const observer = new ResizeObserver(() => setView((previous) => bounded(previous)));
        observer.observe(box);
        return () => {
            box.removeEventListener("wheel", wheel);
            observer.disconnect();
        };
    }, [interactive]);
    const endDrag = () => {
        drag.current = null;
        setDragging(false);
    };
    const imageTransform: CSSProperties | undefined = interactive ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } : undefined;

    useEffect(() => {
        if (previewSrc) {
            setThumbnail(previewSrc);
            setThumbnailReady(true);
        }
    }, [previewSrc]);

    useEffect(() => {
        if (previewSrc || !storageKey || cachedUrl) return;
        let cancelled = false;
        void resolveImagePreviewUrl(storageKey)
            .then((url) => {
                if (!cancelled && url) setThumbnail(url);
            })
            .catch(() => {
                /* The original remains available if thumbnail lookup fails. */
            });
        return () => {
            cancelled = true;
        };
    }, [storageKey, previewSrc, cachedUrl]);

    useEffect(() => {
        let cancelled = false;
        // 本会话刚上传的图片直接用内存中的原图 Blob，打开预览不再等待服务器回传。
        const localSrc = cachedUrl;
        setResolvedSrc(storageKey ? localSrc : src);
        setLoading(Boolean(src || storageKey));
        setError(false);
        if (localSrc || (!src && !storageKey))
            return () => {
                cancelled = true;
            };
        void resolveImageUrl(storageKey, src)
            .then((url) => {
                if (cancelled) return;
                if (!url) {
                    setLoading(false);
                    setError(true);
                    return;
                }
                setResolvedSrc(url);
            })
            .catch(() => {
                if (!cancelled) {
                    setLoading(false);
                    setError(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [src, storageKey, cachedUrl]);

    if (!src && !storageKey) return null;

    return (
        <div
            ref={viewport}
            className={interactive ? "canvas-image-preview-viewport" : "contents"}
            data-zoom={interactive ? view.scale : undefined}
            data-dragging={dragging || undefined}
            data-canvas-no-zoom={interactive || undefined}
            onPointerDown={(event) => {
                if (!interactive || event.button !== 0 || view.scale <= 1) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                setDragging(true);
            }}
            onPointerMove={(event) => {
                const previous = drag.current;
                if (!previous || previous.id !== event.pointerId) return;
                event.stopPropagation();
                const dx = event.clientX - previous.x,
                    dy = event.clientY - previous.y;
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                setView((current) => bounded({ ...current, x: current.x + dx, y: current.y + dy }));
            }}
            onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                endDrag();
            }}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onDoubleClick={interactive ? () => setView({ scale: 1, x: 0, y: 0 }) : undefined}
        >
            {loading && !error && !thumbnailReady ? (
                <div
                    className="absolute inset-3 grid place-items-center rounded-[var(--r-md)] border border-dashed sm:inset-5"
                    style={{
                        borderColor: "var(--workspace-border)",
                        background: "color-mix(in srgb, var(--workspace-surface-strong) 68%, var(--workspace-surface))",
                    }}
                    role="status"
                    aria-label={t("canvasB.imagePreview.loadingLabel")}
                >
                    <div className="flex flex-col items-center gap-3" style={{ color: "var(--workspace-text-muted)" }}>
                        <span className="grid size-11 place-items-center rounded-full border bg-[var(--workspace-surface-strong)]" style={{ borderColor: "var(--workspace-border)" }}>
                            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                        </span>
                        <span className="text-xs font-medium">{t("canvasB.imagePreview.loadingHd")}</span>
                    </div>
                </div>
            ) : null}
            {error && !thumbnailReady ? (
                <div
                    className="absolute inset-3 grid place-items-center rounded-[var(--r-md)] border border-dashed sm:inset-5"
                    style={{
                        borderColor: "var(--workspace-border-strong)",
                        background: "color-mix(in srgb, var(--workspace-surface-strong) 68%, var(--workspace-surface))",
                        color: "var(--workspace-text-muted)",
                    }}
                    role="alert"
                >
                    <div className="flex flex-col items-center gap-3 text-center">
                        <ImageIcon className="size-8 opacity-45" />
                        <div>
                            <div className="text-sm font-medium">{t("canvasB.imagePreview.unavailable")}</div>
                            <div className="mt-1 text-xs opacity-70">{t("canvasB.imagePreview.retryHint")}</div>
                        </div>
                    </div>
                </div>
            ) : null}
            {thumbnail && (loading || error) ? (
                <img
                    ref={thumbnailImage}
                    key={`thumbnail:${thumbnail}`}
                    src={thumbnail}
                    alt={alt}
                    draggable={false}
                    decoding="async"
                    style={imageTransform}
                    className="absolute inset-0 size-full object-contain p-3 sm:p-5"
                    onLoad={() => setThumbnailReady(true)}
                    onError={() => {
                        setThumbnailReady(false);
                        setThumbnail("");
                    }}
                />
            ) : null}
            {thumbnailReady && (loading || error) ? (
                <div role="status" className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-xs" style={{ background: "var(--workspace-surface-strong)", color: "var(--workspace-text-muted)" }}>
                    {loading ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
                    {loading ? "正在载入高清图片" : "当前显示预览图，高清图片暂未载入"}
                </div>
            ) : null}
            {resolvedSrc ? (
                <img
                    ref={originalImage}
                    key={`original:${resolvedSrc}`}
                    src={resolvedSrc}
                    alt={alt}
                    draggable={false}
                    decoding="async"
                    fetchPriority="high"
                    aria-hidden={loading || error}
                    className={`absolute inset-0 size-full object-contain p-3 transition-opacity duration-200 motion-reduce:transition-none sm:p-5 ${loading || error ? "opacity-0" : "opacity-100"}`}
                    style={{ borderColor: "var(--workspace-border-strong)", ...imageTransform }}
                    onLoad={() => {
                        setLoading(false);
                        setError(false);
                    }}
                    onError={() => {
                        setLoading(false);
                        setError(true);
                    }}
                />
            ) : null}
            {interactive ? (
                <span className="canvas-image-preview-help">
                    {Math.round(view.scale * 100)}% · {t("canvasB.imagePreview.interactionHint")}
                </span>
            ) : null}
        </div>
    );
}
