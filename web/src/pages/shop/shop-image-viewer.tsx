import { App, Tooltip } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Copy, Download, ImagePlus, LoaderCircle, Maximize, Minus, Plus, RotateCcw, Scan, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { ModelPicker } from "@/components/model-picker";
import { ReferencePromptTextarea, imagePromptReferences } from "@/components/ui/reference-prompt-textarea";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { displayImageSizeChoices } from "@/pages/ecommerce/catalog";
import { commerceImageReferences } from "@/pages/ecommerce/workflow";
import { logicalModelIDForConfig, resolveModelChannel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useCommerceDisplayConfig } from "@/pages/ecommerce/admin-models";
import { modelDisplayName } from "@/stores/config-model-options";
import { projectDraft } from "@/services/api/ecommerce";

import { findDetailPlanImage, regenerateDetailImage, type DetailPlanSource } from "./detail-regenerate";
import { useImageQuote } from "./shop-edits";
import "./shop-image-viewer.css";

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

/** 预览里的一张图：缩略图先显示，原图加载完替换。 */
export type ViewerImage = { key: string; src: string; thumb?: string; title?: string };

/** 滚轮以指针为中心缩放、按住拖动、双击在「适应窗口」和 2 倍之间切换。换图时复位。 */
export function ZoomStage({ image, children }: { image: ViewerImage; children?: ReactNode }) {
    const box = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const [loaded, setLoaded] = useState(false);
    const drag = useRef<{ id: number; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
    useEffect(() => {
        setView({ scale: 1, x: 0, y: 0 });
        setLoaded(false);
    }, [image.src]);
    const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
        const rect = box.current?.getBoundingClientRect();
        setView((current) => {
            const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
            if (!rect || clientX === undefined || clientY === undefined) return { ...current, scale };
            // 让指针下的那一点缩放前后保持不动。
            const px = clientX - rect.left - rect.width / 2;
            const py = clientY - rect.top - rect.height / 2;
            const ratio = scale / current.scale;
            return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
        });
    }, []);
    useEffect(() => {
        const node = box.current;
        if (!node) return;
        // 原生非被动监听，才能阻止页面跟着滚动。
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
        };
        node.addEventListener("wheel", onWheel, { passive: false });
        return () => node.removeEventListener("wheel", onWheel);
    }, [zoomAt]);
    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
        setView((value) => ({ ...value, x: current.ox + dx, y: current.oy + dy }));
    };
    const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (drag.current?.id === event.pointerId) drag.current = null;
    };
    const fit = () => setView({ scale: 1, x: 0, y: 0 });
    return (
        <div
            ref={box}
            className="siv-stage"
            data-dragging={drag.current ? true : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(event) => (view.scale > 1.05 ? fit() : zoomAt(2 / view.scale, event.clientX, event.clientY))}
        >
            <div className="siv-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
                {image.thumb && !loaded ? <img className="siv-img is-thumb" src={image.thumb} alt="" draggable={false} /> : null}
                <img className="siv-img" data-loaded={loaded || undefined} src={image.src} alt={image.title || ""} draggable={false} onLoad={() => setLoaded(true)} />
            </div>
            {!loaded ? (
                <span className="siv-loading">
                    <LoaderCircle className="size-5 animate-spin" />
                </span>
            ) : null}
            <div className="siv-zoombar" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                <button type="button" aria-label="缩小" onClick={() => zoomAt(1 / 1.25)}>
                    <Minus className="size-3.5" />
                </button>
                <button type="button" className="siv-zoom-value" onClick={fit} title="适应窗口">
                    {Math.round(view.scale * 100)}%
                </button>
                <button type="button" aria-label="放大" onClick={() => zoomAt(1.25)}>
                    <Plus className="size-3.5" />
                </button>
                <i />
                <button type="button" aria-label="适应窗口" title="适应窗口" onClick={fit}>
                    <Scan className="size-3.5" />
                </button>
                <button type="button" aria-label="放大到 2 倍" title="放大到 2 倍" onClick={() => setView({ scale: 2, x: 0, y: 0 })}>
                    <Maximize className="size-3.5" />
                </button>
            </div>
            {children}
        </div>
    );
}

function Overlay({ open, onClose, className, children }: { open: boolean; onClose: () => void; className?: string; children: ReactNode }) {
    const reduced = useReducedMotion();
    if (typeof document === "undefined") return null;
    return createPortal(
        <AnimatePresence>
            {open ? (
                <motion.div className="siv-backdrop ms-scope" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
                    <motion.div
                        className={`siv-modal ${className || ""}`}
                        role="dialog"
                        aria-modal="true"
                        initial={reduced ? false : { opacity: 0, y: 18, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {children}
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>,
        document.body,
    );
}

/** 输入框里按方向键不翻页。 */
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * 大图预览弹窗：左边大图（滚轮缩放、拖动、双击放大）+ 左右切换 + 底部缩略条，右边由调用方渲染（提示词与操作）。
 * 键盘 ← → 切换，Esc 关闭。
 */
export function ShopImageViewer<T extends ViewerImage>({ items, index, onIndex, onClose, side }: { items: T[]; index: number | null; onIndex: (index: number) => void; onClose: () => void; side: (item: T) => ReactNode }) {
    const open = index !== null && Boolean(items[index]);
    const current = open ? items[index!] : null;
    const go = useCallback(
        (step: number) => {
            if (index === null || !items.length) return;
            onIndex((index + step + items.length) % items.length);
        },
        [index, items.length, onIndex],
    );
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
            else if (typing(event.target)) return;
            else if (event.key === "ArrowLeft") go(-1);
            else if (event.key === "ArrowRight") go(1);
            else return;
            event.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [go, onClose, open]);
    const strip = useRef<HTMLDivElement>(null);
    useEffect(() => {
        strip.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }, [index]);
    return (
        <Overlay open={open} onClose={onClose} className="siv-viewer">
            {current ? (
                <>
                    <section className="siv-left">
                        <ZoomStage image={current}>
                            {items.length > 1 ? (
                                <>
                                    <button type="button" className="siv-nav is-prev" aria-label="上一张（←）" onClick={() => go(-1)} onPointerDown={(event) => event.stopPropagation()}>
                                        <ChevronLeft className="size-5" />
                                    </button>
                                    <button type="button" className="siv-nav is-next" aria-label="下一张（→）" onClick={() => go(1)} onPointerDown={(event) => event.stopPropagation()}>
                                        <ChevronRight className="size-5" />
                                    </button>
                                </>
                            ) : null}
                            <span className="siv-counter">
                                {index! + 1} / {items.length}
                            </span>
                        </ZoomStage>
                        {items.length > 1 ? (
                            <div className="siv-strip" ref={strip}>
                                {items.map((item, position) => (
                                    <button key={item.key} type="button" data-active={position === index ? "true" : undefined} onClick={() => onIndex(position)} aria-label={`第 ${position + 1} 张`}>
                                        <img src={item.thumb || item.src} alt="" loading="lazy" />
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </section>
                    <aside className="siv-side">
                        <button type="button" className="siv-close" aria-label="关闭（Esc）" onClick={onClose}>
                            <X className="size-4" />
                        </button>
                        {side(current)}
                    </aside>
                </>
            ) : null}
        </Overlay>
    );
}

export function copyText(text: string, message: { success: (text: string) => void; error: (text: string) => void }) {
    void navigator.clipboard
        .writeText(text)
        .then(() => message.success("已复制"))
        .catch(() => message.error("复制失败，请手动选择复制"));
}

/** 详情图预览右侧：主题、画面文案、提示词（可复制）、参数和操作。 */
export function DetailPreviewSide({
    title,
    subtitle,
    copy,
    prompt,
    meta,
    onRegenerate,
    onReference,
    onDownload,
}: {
    title: string;
    subtitle?: string;
    copy?: string;
    prompt: string;
    meta: string[];
    onRegenerate?: () => void;
    onReference?: (role: "product" | "style") => void;
    onDownload: () => void;
}) {
    const { message } = App.useApp();
    const [refMenu, setRefMenu] = useState(false);
    return (
        <div className="siv-info">
            <header>
                <small>{subtitle || "详情图"}</small>
                <h3>{title || "未命名画面"}</h3>
                {meta.length ? (
                    <div className="siv-meta">
                        {meta.map((item) => (
                            <span key={item}>{item}</span>
                        ))}
                    </div>
                ) : null}
            </header>
            <div className="siv-scroll">
                {copy?.trim() ? (
                    <section className="siv-block">
                        <div className="siv-block-head">
                            <strong>画面文案</strong>
                            <Tooltip title="复制文案">
                                <button type="button" onClick={() => copyText(copy, message)} aria-label="复制文案">
                                    <Copy className="size-3.5" />
                                </button>
                            </Tooltip>
                        </div>
                        <p className="siv-copy">{copy}</p>
                    </section>
                ) : null}
                <section className="siv-block">
                    <div className="siv-block-head">
                        <strong>提示词</strong>
                        <Tooltip title="复制提示词">
                            <button type="button" onClick={() => copyText(prompt, message)} aria-label="复制提示词" disabled={!prompt}>
                                <Copy className="size-3.5" />
                            </button>
                        </Tooltip>
                    </div>
                    <p className="siv-prompt">{prompt || "这张图的提示词还在保存，稍后再看"}</p>
                </section>
            </div>
            <footer className="siv-actions">
                {onRegenerate ? (
                    <motion.button type="button" className="siv-primary" onClick={onRegenerate} whileTap={{ scale: 0.97 }}>
                        <RotateCcw className="size-4" /> 重新生成
                    </motion.button>
                ) : null}
                <div className="siv-secondary">
                    {onReference ? (
                        <span className="siv-ref">
                            <button type="button" onClick={() => setRefMenu((value) => !value)} data-open={refMenu || undefined}>
                                <ImagePlus className="size-4" /> 用作参考图
                            </button>
                            <AnimatePresence>
                                {refMenu ? (
                                    <motion.span className="siv-ref-menu" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                                        <button type="button" onClick={() => (setRefMenu(false), onReference("product"))}>
                                            作为商品图
                                            <small>加到左侧「商品图」，下一轮按它出图</small>
                                        </button>
                                        <button type="button" onClick={() => (setRefMenu(false), onReference("style"))}>
                                            作为风格排版参考
                                            <small>切到「参考风格与排版」，借鉴它的版式和配色</small>
                                        </button>
                                    </motion.span>
                                ) : null}
                            </AnimatePresence>
                        </span>
                    ) : null}
                    <button type="button" onClick={onDownload}>
                        <Download className="size-4" /> 下载
                    </button>
                </div>
            </footer>
        </div>
    );
}

function ratioBox(value: string) {
    const parts = value.split(/[:x×]/).map(Number);
    const ratio = parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0) ? parts[0] / parts[1] : 1;
    return { width: Math.max(8, Math.round(ratio >= 1 ? 16 : 16 * ratio)), height: Math.max(8, Math.round(ratio >= 1 ? 16 / ratio : 16)) };
}

/**
 * 重新生成弹窗：左边大图，右边可直接编辑原提示词和画面文案，选模型、比例、分辨率后在当前页提交（不跳页）。
 * 提交后新任务替换方案里这一张，右栏显示创作中动画。
 */
export function DetailRegenerateModal({ target, onClose, onSubmitted }: { target: { projectId: string; taskId: string; image: ViewerImage; fallbackPrompt?: string } | null; onClose: () => void; onSubmitted: () => void }) {
    const { message } = App.useApp();
    const baseConfig = useEffectiveConfig();
    const config = useCommerceDisplayConfig(baseConfig);
    const [source, setSource] = useState<DetailPlanSource | null | undefined>(undefined);
    const [prompt, setPrompt] = useState("");
    const [copy, setCopy] = useState("");
    const [model, setModel] = useState("");
    const [ratio, setRatio] = useState("");
    const [resolution, setResolution] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const key = target ? `${target.projectId}:${target.taskId}` : "";
    useEffect(() => {
        if (!target) return;
        let cancelled = false;
        setSource(undefined);
        setError("");
        findDetailPlanImage(target.projectId, target.taskId)
            .then((found) => {
                if (cancelled) return;
                setSource(found);
                if (found) {
                    setPrompt(found.image.prompt || "");
                    setCopy(found.image.copy || "");
                    setModel(found.image.imageModel);
                    setRatio(found.image.ratio);
                    setResolution(found.image.resolution);
                }
            })
            .catch((cause) => !cancelled && (setSource(null), setError(cause instanceof Error ? cause.message : "读取方案失败")));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    const imageModels = useMemo(() => selectableModelsByCapability(config, "image").filter((value) => Boolean(logicalModelIDForConfig({ ...config, model: value })) || resolveModelChannel(config, value).scope === "system"), [config]);
    const activeModel = model && imageModels.includes(model) ? model : imageModels[0] || "";
    const profile = activeModel ? modelCapabilityConfigFor(config, activeModel).image : undefined;
    const ratioValues = profile?.size.values.length ? profile.size.values : [profile?.size.default || "1:1"];
    const activeRatio = ratioValues.includes(ratio) ? ratio : profile?.size.default || ratioValues[0];
    const ratioChoices = displayImageSizeChoices(ratioValues, activeRatio);
    const resolutionChoices = profile?.resolution.supported ? profile.resolution.values : [profile?.quality.default || "auto"];
    const activeResolution = resolutionChoices.includes(resolution) ? resolution : profile?.resolution.default || resolutionChoices[0];
    const quoteSize = activeRatio === "auto" ? ratioValues.find((value) => value !== "auto") || activeRatio : activeRatio;
    const refCount = source ? Math.max(1, (source.image.sourceDraft || projectDraft(source.project)).references.length || 1) : 1;
    const promptReferences = source ? imagePromptReferences(commerceImageReferences(source.image.sourceDraft || projectDraft(source.project), source.image, source.plan.images.indexOf(source.image), false)) : [];
    const quote = useImageQuote(config, activeModel, quoteSize, activeResolution, refCount);
    const promptChanged = Boolean(source && prompt.trim() !== (source.image.prompt || "").trim());
    const priceText = quote.loading ? "报价中…" : quote.value !== null ? `约 ${quote.value.toFixed(2)} 积分` : "暂未取到报价";

    const submit = async () => {
        if (!source || busy) return;
        setBusy(true);
        setError("");
        try {
            await regenerateDetailImage(config, source, { prompt, copy, imageModel: activeModel, ratio: activeRatio, resolution: activeResolution });
            message.success("已提交重新生成，右侧显示创作进度");
            onSubmitted();
            onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "提交失败，请稍后重试");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Overlay open={Boolean(target)} onClose={() => !busy && onClose()} className="siv-regen">
            {target ? (
                <>
                    <section className="siv-left">
                        <ZoomStage image={target.image} />
                    </section>
                    <aside className="siv-side">
                        <button type="button" className="siv-close" aria-label="关闭" onClick={onClose} disabled={busy}>
                            <X className="size-4" />
                        </button>
                        <div className="siv-info">
                            <header>
                                <small>重新生成</small>
                                <h3>{source?.image.theme || target.image.title || "这张图"}</h3>
                            </header>
                            {source === undefined ? (
                                <div className="siv-pending">
                                    <LoaderCircle className="size-5 animate-spin" /> 正在读取这张图的方案…
                                </div>
                            ) : source === null ? (
                                <div className="siv-pending is-warn">
                                    {error || "这一屏的方案还在保存，稍等几秒再打开重新生成。"}
                                    {target.fallbackPrompt ? <p className="siv-prompt">{target.fallbackPrompt}</p> : null}
                                </div>
                            ) : (
                                <div className="siv-scroll">
                                    <label className="siv-field">
                                        <span>
                                            提示词 {promptChanged ? <em>已修改</em> : <small>不改直接生成会换一版构图</small>}
                                            {promptChanged ? (
                                                <button type="button" onClick={() => setPrompt(source.image.prompt || "")}>
                                                    还原
                                                </button>
                                            ) : null}
                                        </span>
                                        <ReferencePromptTextarea materials={promptReferences} value={prompt} maxLength={6000} rows={9} onChange={setPrompt} aria-label="图片提示词" />
                                    </label>
                                    {source.image.copy?.trim() || copy ? (
                                        <label className="siv-field">
                                            <span>
                                                画面文案 <small>逐字印在图上</small>
                                            </span>
                                            <textarea value={copy} maxLength={600} rows={3} onChange={(event) => setCopy(event.target.value)} />
                                        </label>
                                    ) : null}
                                    <div className="siv-field">
                                        <span>模型</span>
                                        <ModelPicker
                                            config={config}
                                            capability="image"
                                            value={activeModel}
                                            selectedPrice={
                                                <span className="model-picker-price shrink-0 text-xs" role="status">
                                                    {priceText}
                                                </span>
                                            }
                                            onChange={(next) => {
                                                const nextProfile = modelCapabilityConfigFor(config, next).image;
                                                setModel(next);
                                                if (nextProfile && !nextProfile.size.values.includes(activeRatio)) setRatio(nextProfile.size.default);
                                                if (nextProfile)
                                                    setResolution(nextProfile.resolution.supported ? (nextProfile.resolution.values.includes(activeResolution) ? activeResolution : nextProfile.resolution.default) : nextProfile.quality.default || "auto");
                                            }}
                                            modelFilter={(value) => imageModels.includes(value)}
                                            closeOnSelect
                                            fullWidth
                                            className="creation-model-picker"
                                            variant="creation"
                                            showOptionPrices
                                            placeholder="选择图片模型"
                                        />
                                    </div>
                                    <div className="siv-field">
                                        <span>比例</span>
                                        <div className="siv-chips">
                                            {ratioChoices.map(({ label, value }) => (
                                                <button key={label} type="button" data-active={value === activeRatio || undefined} onClick={() => setRatio(value)}>
                                                    <i style={ratioBox(value)} />
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="siv-field">
                                        <span>分辨率</span>
                                        <div className="siv-chips">
                                            {resolutionChoices.map((value) => (
                                                <button key={value} type="button" data-active={value === activeResolution || undefined} onClick={() => setResolution(value)}>
                                                    {value.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {error && source ? <p className="siv-error">{error}</p> : null}
                            <footer className="siv-actions">
                                <span className="siv-price">{source ? `${priceText} · ${modelDisplayName(config, activeModel)}` : ""}</span>
                                <motion.button type="button" className="siv-primary" disabled={!source || busy || !prompt.trim()} onClick={() => void submit()} whileTap={{ scale: 0.97 }}>
                                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} 重新生成
                                </motion.button>
                            </footer>
                        </div>
                    </aside>
                </>
            ) : null}
        </Overlay>
    );
}
