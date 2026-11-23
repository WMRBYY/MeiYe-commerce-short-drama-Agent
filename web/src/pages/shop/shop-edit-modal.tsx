import { App } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Eraser, LoaderCircle, Paintbrush, Redo2, Undo2, X } from "lucide-react";
import { CreditStar } from "@/components/ui/credit-star";
import { ReferencePromptTextarea, imagePromptReferences } from "@/components/ui/reference-prompt-textarea";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { RollingCreditAmount } from "@/components/rolling-credit-text";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { resourceFileUrl, resourceVariantUrl, uploadResourceFile } from "@/services/api/resources";
import { modelDisplayName } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { TryOnState } from "@/pages/ecommerce/tryon/use-tryon";

import { editSize, submitShopEdits, useImageQuote, type ShopEditRecord } from "./shop-edits";
import { annotateImage, canvasPainted, cropImage } from "./shop-image-ops";
import type { ShopItem } from "./shop-items";

export type EditKind = "inpaint" | "repaint" | "upscale" | "cutout";

const COPY: Record<EditKind, { title: string; sub: string; action: string; placeholder: string; hint: string }> = {
    inpaint: { title: "局部重绘", sub: "在画面上涂抹要补强的区域，用一句话说明想要的效果。", action: "开始增强", placeholder: "例如：补全发丝边缘，纹理更自然。", hint: "用一两句话说明涂抹区域要变成什么样" },
    repaint: { title: "智能重绘", sub: "主体、服装和构图保持不变，按你的描述重新绘制质感、光影与细节。", action: "开始重绘", placeholder: "例如：换成清晨柔和窗光，背景更简洁，质感更高级。", hint: "不写就整体提升质感与细节" },
    upscale: { title: "高清放大", sub: "内容保持不变，提升清晰度与细节纹理，输出更高分辨率。", action: "开始放大", placeholder: "补充要求（选填），例如：保留皮肤真实纹理，不要磨皮。", hint: "选填" },
    cutout: { title: "图片抠图", sub: "把主体完整抠出来放在纯白背景上，边缘干净，可直接做商品白底图。", action: "开始抠图", placeholder: "补充要求（选填），例如：只保留模特和手里的包。", hint: "选填" },
};

const DOODLE_COLORS = ["#ff2d55", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];

function promptFor(kind: EditKind, text: string, painted: { mask: boolean; doodle: boolean }) {
    const desc = text.trim();
    switch (kind) {
        case "inpaint": {
            const marks = [painted.mask ? "半透明红色区域是需要修改的范围" : "", painted.doodle ? "彩色线条是用户画的形状与位置示意" : ""].filter(Boolean).join("，");
            return [
                "【局部重绘】参考图一是原图；参考图二是在同一张原图上做过标记的版本：" + marks + "。",
                `只修改标记范围内的内容：${desc || "补全并增强这一块的细节，让它清晰、真实、自然"}。`,
                "标记范围以外的人物长相、发型、服装、商品、背景、构图、光线和色调都必须与参考图一完全一致，不增删任何元素。",
                "输出完整的一整张图，画幅比例与参考图一相同；画面里不能出现任何红色标记、涂鸦线条或文字说明。",
            ].join("\n");
        }
        case "repaint":
            return `【智能重绘】以参考图一为基础重新绘制整张图${desc ? `：${desc}` : "，整体提升质感、光影和细节"}。\n人物身份与长相、服装款式与颜色、商品外观、构图与机位保持不变；画面真实自然，像相机实拍，不要出现文字、水印和边框。`;
        case "upscale":
            return `【高清放大】把参考图一重新输出为更高清晰度的版本：画面内容、构图、人物长相、服装与商品细节、文字和颜色都与原图完全一致，只提升清晰度、锐度和细节纹理，去掉噪点、模糊和压缩痕迹，不增删任何元素。${desc ? `\n补充要求：${desc}` : ""}`;
        case "cutout":
            return `【图片抠图】把参考图一中的主体（人物或商品）完整、精确地抠出来，放在纯白色（#FFFFFF）背景上居中，主体的形状、颜色、细节和比例完全不变；边缘干净利落，发丝和半透明部分自然过渡，不要投影，不要任何其他元素和文字。${desc ? `\n补充要求：${desc}` : ""}`;
    }
}

type Layer = "mask" | "doodle";
type Snapshot = { mask: ImageData; doodle: ImageData };

/** 涂抹画板：遮罩层（半透明荧光绿）与涂鸦层（彩色线条），支持橡皮擦、撤销、重做。 */
function MaskPainter({
    src,
    natural,
    onPainted,
    canvases,
}: {
    src: string;
    natural: { w: number; h: number };
    onPainted: (value: { mask: boolean; doodle: boolean }) => void;
    canvases: MutableRefObject<{ mask: HTMLCanvasElement | null; doodle: HTMLCanvasElement | null }>;
}) {
    const reduced = useReducedMotion();
    const box = useRef<HTMLDivElement>(null);
    const mask = useRef<HTMLCanvasElement>(null);
    const doodle = useRef<HTMLCanvasElement>(null);
    const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
    const [layer, setLayer] = useState<Layer>("mask");
    const [tool, setTool] = useState<"brush" | "eraser">("brush");
    const [size, setSize] = useState(40);
    const [color, setColor] = useState(DOODLE_COLORS[0]);
    const [panel, setPanel] = useState(false);
    const [peek, setPeek] = useState(false);
    const [history, setHistory] = useState<{ stack: Snapshot[]; index: number }>({ stack: [], index: -1 });
    const drawing = useRef<{ last: { x: number; y: number } | null }>({ last: null });
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

    // 画布内部分辨率：原图等比缩到最长边 1600。
    const scale = Math.min(1, 1600 / Math.max(natural.w || 1, natural.h || 1));
    const cw = Math.max(1, Math.round((natural.w || 1) * scale));
    const ch = Math.max(1, Math.round((natural.h || 1) * scale));

    useEffect(() => {
        canvases.current = { mask: mask.current, doodle: doodle.current };
    });

    // 图片按 contain 摆进画框，两层画布与图片显示区域完全重合。
    useEffect(() => {
        const node = box.current;
        if (!node) return;
        const measure = () => {
            const bw = node.clientWidth;
            const bh = node.clientHeight;
            const ratio = (natural.w || 1) / (natural.h || 1);
            const width = Math.min(bw, bh * ratio);
            const height = width / ratio;
            setRect({ left: (bw - width) / 2, top: (bh - height) / 2, width, height });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [natural.h, natural.w]);

    const snapshot = (): Snapshot | null => {
        const m = mask.current?.getContext("2d");
        const d = doodle.current?.getContext("2d");
        if (!m || !d) return null;
        return { mask: m.getImageData(0, 0, cw, ch), doodle: d.getImageData(0, 0, cw, ch) };
    };
    const restore = (shot: Snapshot | undefined) => {
        const m = mask.current?.getContext("2d");
        const d = doodle.current?.getContext("2d");
        if (!m || !d) return;
        m.clearRect(0, 0, cw, ch);
        d.clearRect(0, 0, cw, ch);
        if (shot) {
            m.putImageData(shot.mask, 0, 0);
            d.putImageData(shot.doodle, 0, 0);
        }
        report();
    };
    const report = () => onPainted({ mask: canvasPainted(mask.current), doodle: canvasPainted(doodle.current) });
    const commit = () => {
        const shot = snapshot();
        if (!shot) return;
        setHistory((value) => {
            const stack = [...value.stack.slice(0, value.index + 1), shot].slice(-30);
            return { stack, index: stack.length - 1 };
        });
        report();
    };
    // 第一张快照是空白画布，撤销到底就是清空。
    useEffect(() => {
        const shot = snapshot();
        if (shot) setHistory({ stack: [shot], index: 0 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cw, ch]);

    const point = (event: ReactPointerEvent) => {
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        return { x: ((event.clientX - bounds.left) / bounds.width) * cw, y: ((event.clientY - bounds.top) / bounds.height) * ch };
    };
    const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const canvas = layer === "mask" ? mask.current : doodle.current;
        const context = canvas?.getContext("2d");
        if (!context) return;
        // 笔刷大小按显示尺寸换算到画布分辨率，屏幕上看到多粗就画多粗。
        const width = (size * cw) / Math.max(1, rect.width);
        context.save();
        context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
        context.strokeStyle = layer === "mask" ? "#a3e635" : color;
        context.lineWidth = layer === "mask" ? width : Math.max(2, width / 4);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x + 0.01, to.y + 0.01);
        context.stroke();
        context.restore();
    };
    const clearLayer = (which: Layer | "all") => {
        if (which !== "doodle") mask.current?.getContext("2d")?.clearRect(0, 0, cw, ch);
        if (which !== "mask") doodle.current?.getContext("2d")?.clearRect(0, 0, cw, ch);
        commit();
    };

    const brushPx = layer === "mask" ? size : Math.max(4, size / 4);
    return (
        <div ref={box} className="se-board" data-peek={peek || undefined}>
            <img src={src} alt="" className="se-base" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} draggable={false} />
            <canvas ref={mask} width={cw} height={ch} className="se-mask" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
            <canvas
                ref={doodle}
                width={cw}
                height={ch}
                className="se-doodle"
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, cursor: "none" }}
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const at = point(event);
                    drawing.current.last = at;
                    stroke(at, at);
                }}
                onPointerMove={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setCursor({ x: event.clientX - bounds.left + rect.left, y: event.clientY - bounds.top + rect.top });
                    if (!drawing.current.last) return;
                    const at = point(event);
                    stroke(drawing.current.last, at);
                    drawing.current.last = at;
                }}
                onPointerUp={() => {
                    if (!drawing.current.last) return;
                    drawing.current.last = null;
                    commit();
                }}
                onPointerLeave={() => setCursor(null)}
            />
            {cursor ? <i className="se-cursor" data-eraser={tool === "eraser" || undefined} style={{ left: cursor.x, top: cursor.y, width: brushPx, height: brushPx, borderColor: layer === "doodle" && tool === "brush" ? color : undefined }} /> : null}

            <button type="button" className="se-float" data-pos="tl" data-on={peek || undefined} onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} title="按住只看基础图片">
                基础图片
            </button>
            <button type="button" className="se-float" data-pos="bl" data-on={panel || undefined} onClick={() => setPanel((value) => !value)}>
                涂鸦设置
            </button>
            <button type="button" className="se-float" data-pos="br" onClick={() => clearLayer("all")}>
                清空
            </button>

            <AnimatePresence>
                {panel ? (
                    <motion.div
                        className="se-tools"
                        initial={reduced ? false : { opacity: 0, y: 10, scale: 0.96, filter: "blur(4px)" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: 8, scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    >
                        <header>
                            <strong>工具</strong>
                            <button type="button" onClick={() => setPanel(false)}>
                                收起
                            </button>
                        </header>
                        <div className="se-seg">
                            {(["mask", "doodle"] as Layer[]).map((value) => (
                                <button key={value} type="button" data-active={layer === value || undefined} onClick={() => setLayer(value)}>
                                    {layer === value ? <motion.i layoutId="se-seg-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
                                    <span>{value === "mask" ? "遮罩" : "涂鸦"}</span>
                                </button>
                            ))}
                        </div>
                        <label className="se-range">
                            <span>笔刷</span>
                            <input type="range" min={6} max={120} value={size} onChange={(event) => setSize(Number(event.target.value))} style={{ "--p": `${((size - 6) / 114) * 100}%` } as CSSProperties} />
                            <b>{size}</b>
                        </label>
                        <AnimatePresence initial={false}>
                            {layer === "doodle" ? (
                                <motion.div className="se-colors" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                                    {DOODLE_COLORS.map((value) => (
                                        <button key={value} type="button" data-active={color === value || undefined} style={{ background: value }} aria-label={value} onClick={() => setColor(value)} />
                                    ))}
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                        <div className="se-actions">
                            <button type="button" data-active={tool === "brush" || undefined} onClick={() => setTool("brush")}>
                                <Paintbrush className="size-3" />
                                画笔
                            </button>
                            <button type="button" data-active={tool === "eraser" || undefined} onClick={() => setTool("eraser")}>
                                <Eraser className="size-3" />
                                橡皮擦
                            </button>
                            <button
                                type="button"
                                disabled={history.index <= 0}
                                onClick={() => {
                                    const index = history.index - 1;
                                    restore(history.stack[index]);
                                    setHistory((value) => ({ ...value, index }));
                                }}
                            >
                                <Undo2 className="size-3" />
                                撤销
                            </button>
                            <button
                                type="button"
                                disabled={history.index >= history.stack.length - 1}
                                onClick={() => {
                                    const index = history.index + 1;
                                    restore(history.stack[index]);
                                    setHistory((value) => ({ ...value, index }));
                                }}
                            >
                                <Redo2 className="size-3" />
                                重做
                            </button>
                            <button type="button" data-tone="danger" onClick={() => clearLayer(layer)}>
                                {layer === "mask" ? "清空遮罩" : "清空涂鸦"}
                            </button>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

export function ShopEditModal({ kind, item, natural, state, onClose, onSubmitted }: { kind: EditKind; item: ShopItem; natural: { w: number; h: number }; state: TryOnState; onClose: () => void; onSubmitted: (records: ShopEditRecord[]) => void }) {
    const { message } = App.useApp();
    const reduced = useReducedMotion();
    const copy = COPY[kind];
    const needRefs = kind === "inpaint" ? 2 : 1;
    const config = state.config;
    // 模型还是输入框里选中的那个；局部重绘需要两张参考图，当前模型不支持时换第一个支持的。
    const model = useMemo(() => {
        const fits = (value: string) => (modelCapabilityConfigFor(config, value).image?.references.maxImages || 0) >= needRefs;
        return state.imageModel && fits(state.imageModel) ? state.imageModel : state.imageModels.find(fits) || "";
    }, [config, needRefs, state.imageModel, state.imageModels]);
    const profile = model ? modelCapabilityConfigFor(config, model).image : undefined;
    const resolutionValues = profile?.resolution.supported ? profile.resolution.values : [];
    const preferred = resolutionValues.filter((value) => /^(2k|4k)$/i.test(value));
    const choices = preferred.length ? preferred : resolutionValues;
    const [resolution, setResolution] = useState(() => (kind === "upscale" ? choices[choices.length - 1] : choices.find((value) => /2k/i.test(value)) || choices[0]) || profile?.quality.default || "auto");
    const [text, setText] = useState("");
    const [painted, setPainted] = useState({ mask: false, doodle: false });
    const [busy, setBusy] = useState(false);
    const canvases = useRef<{ mask: HTMLCanvasElement | null; doodle: HTMLCanvasElement | null }>({ mask: null, doodle: null });
    const size = editSize(config, model, "", natural.w, natural.h);
    const quote = useImageQuote(config, model, size, resolution, needRefs);
    const creditsEnabled = useUserStore((store) => store.features.creditsEnabled);
    const reason = !model
        ? kind === "inpaint"
            ? "没有支持两张参考图的图片模型，暂时不能局部重绘"
            : "当前没有可用的图片模型"
        : kind === "inpaint" && !painted.mask && !painted.doodle
          ? "先在图上涂抹要修改的区域"
          : creditsEnabled && quote.value === null
            ? quote.loading
                ? "正在报价"
                : "暂时无法报价，请稍后重试"
            : "";

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    const start = async () => {
        if (reason || busy) {
            if (reason) message.warning(reason);
            return;
        }
        setBusy(true);
        try {
            let submitRefs = [item.resourceId];
            if (kind === "inpaint") {
                const annotated = await annotateImage(item.resourceId, painted.mask ? canvases.current.mask : null, painted.doodle ? canvases.current.doodle : null);
                const resource = await uploadResourceFile(annotated.blob, "image", { fileName: "inpaint-mark.jpg", width: annotated.width, height: annotated.height });
                submitRefs = [item.resourceId, resource.id];
            }
            const records = submitShopEdits({ scope: state.scope, config }, { model, modelLabel: modelDisplayName(config, model), ratio: size, resolution }, [
                { kind, text: text.trim() || copy.title, prompt: promptFor(kind, text, painted), references: [item.resourceId], submitRefs, baseResourceId: item.resourceId, width: natural.w, height: natural.h },
            ]);
            message.success(`已开始${copy.title}，完成后出现在右侧`);
            onSubmitted(records);
            onClose();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "提交失败");
        } finally {
            setBusy(false);
        }
    };

    return createPortal(
        <motion.div className="se-scrim ms-scope" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
            <motion.div
                className="se-modal"
                role="dialog"
                aria-label={copy.title}
                initial={reduced ? false : { opacity: 0, y: 24, scale: 0.96, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: 16, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
            >
                <header className="se-head">
                    <div>
                        <h3>{copy.title}</h3>
                        <p>{copy.sub}</p>
                    </div>
                    <button type="button" className="se-close" aria-label="关闭" onClick={onClose}>
                        <X className="size-4" />
                    </button>
                </header>
                <div className="se-body">
                    <div className="se-baseline">
                        <img src={resourceVariantUrl(item.resourceId, "thumbnail")} alt="" />
                        <div>
                            <strong>基础图</strong>
                            <small>{item.label}</small>
                            <span>
                                <i />
                                已自动带入
                            </span>
                        </div>
                    </div>
                    {kind === "inpaint" ? (
                        <>
                            <div className="se-label">
                                <strong>涂抹增强区域</strong>
                                <motion.span
                                    key={painted.mask || painted.doodle ? "on" : "off"}
                                    className="se-status"
                                    data-on={painted.mask || painted.doodle || undefined}
                                    initial={reduced ? false : { scale: 0.85, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                >
                                    {painted.mask || painted.doodle ? "已涂抹" : "尚未涂抹"}
                                </motion.span>
                            </div>
                            <MaskPainter src={resourceFileUrl(item.resourceId)} natural={natural} onPainted={setPainted} canvases={canvases} />
                        </>
                    ) : null}
                    <div className="se-label">
                        <strong>描述效果</strong>
                        <small>{copy.hint}</small>
                    </div>
                    <ReferencePromptTextarea className="se-text" materials={imagePromptReferences([item])} value={text} onChange={setText} placeholder={copy.placeholder} maxLength={600} rows={3} />
                    {choices.length ? (
                        <div className="se-row">
                            <strong>输出分辨率</strong>
                            <div className="se-pills">
                                {choices.map((value) => (
                                    <button key={value} type="button" data-active={value === resolution || undefined} onClick={() => setResolution(value)}>
                                        {value === resolution ? <motion.i layoutId="se-res-pill" transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
                                        <span>{value.toUpperCase()}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
                <footer className="se-foot">
                    <span className="se-price" title={model ? modelDisplayName(config, model) : ""}>
                        <CreditStar className="size-3.5" />
                        {quote.value === null ? <em>{quote.loading ? "报价中" : "--"}</em> : <RollingCreditAmount value={quote.value} maximumFractionDigits={2} />}
                        <b>积分</b>
                        {model ? <small>{modelDisplayName(config, model)}</small> : null}
                    </span>
                    <motion.button type="button" className="se-go" data-ready={!reason || undefined} disabled={busy} onClick={() => void start()} whileTap={{ scale: 0.96 }} title={reason || copy.action}>
                        {busy ? <LoaderCircle className="sp-spin size-4" /> : null}
                        {copy.action}
                        <ArrowRight className="se-go-arrow size-4" />
                    </motion.button>
                </footer>
            </motion.div>
        </motion.div>,
        document.body,
    );
}

/** 裁剪：拖动选框和四个角，比例可选；确认后在浏览器裁出新图并上传。 */
const CROP_RATIOS: Array<[string, number | null]> = [
    ["自由", null],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["4:3", 4 / 3],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
];

export function ShopCropModal({ item, natural, onClose, onDone }: { item: ShopItem; natural: { w: number; h: number }; onClose: () => void; onDone: (blob: Blob, size: { width: number; height: number }) => Promise<void> }) {
    const { message } = App.useApp();
    const reduced = useReducedMotion();
    const box = useRef<HTMLDivElement>(null);
    const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });
    const [crop, setCrop] = useState({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    const [ratio, setRatio] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const drag = useRef<{ mode: string; start: { x: number; y: number }; crop: typeof crop } | null>(null);
    const imageRatio = (natural.w || 1) / (natural.h || 1);

    useEffect(() => {
        const node = box.current;
        if (!node) return;
        const measure = () => {
            const bw = node.clientWidth;
            const bh = node.clientHeight;
            const width = Math.min(bw, bh * imageRatio);
            setFrame({ left: (bw - width) / 2, top: (bh - width / imageRatio) / 2, width, height: width / imageRatio });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [imageRatio]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    const applyRatio = (value: number | null) => {
        setRatio(value);
        if (!value) return;
        // 选框比例换算到相对坐标：w/h(相对) = value / imageRatio。
        const relative = value / imageRatio;
        let w = 0.84;
        let h = w / relative;
        if (h > 0.84) {
            h = 0.84;
            w = h * relative;
        }
        setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
    };

    const onPointerDown = (mode: string) => (event: ReactPointerEvent) => {
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { mode, start: { x: event.clientX, y: event.clientY }, crop };
    };
    const onPointerMove = (event: ReactPointerEvent) => {
        const current = drag.current;
        if (!current || !frame.width) return;
        const dx = (event.clientX - current.start.x) / frame.width;
        const dy = (event.clientY - current.start.y) / frame.height;
        const base = current.crop;
        const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
        if (current.mode === "move") {
            setCrop({ ...base, x: clamp(base.x + dx, 0, 1 - base.w), y: clamp(base.y + dy, 0, 1 - base.h) });
            return;
        }
        const left = current.mode.includes("l");
        const top = current.mode.includes("t");
        let w = clamp(base.w + (left ? -dx : dx), 0.05, left ? base.x + base.w : 1 - base.x);
        let h = clamp(base.h + (top ? -dy : dy), 0.05, top ? base.y + base.h : 1 - base.y);
        if (ratio) {
            const relative = ratio / imageRatio;
            h = w / relative;
            const maxH = top ? base.y + base.h : 1 - base.y;
            if (h > maxH) {
                h = maxH;
                w = h * relative;
            }
        }
        setCrop({ x: left ? base.x + base.w - w : base.x, y: top ? base.y + base.h - h : base.y, w, h });
    };

    const confirm = async () => {
        setBusy(true);
        try {
            const result = await cropImage(item.resourceId, crop);
            await onDone(result.blob, { width: result.width, height: result.height });
            onClose();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "裁剪失败");
        } finally {
            setBusy(false);
        }
    };

    const px = (value: number, size: number) => value * size;
    return createPortal(
        <motion.div className="se-scrim ms-scope" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
            <motion.div
                className="se-modal se-crop"
                initial={reduced ? false : { opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
            >
                <header className="se-head">
                    <div>
                        <h3>裁剪</h3>
                        <p>拖动选框或四个角调整范围，裁出来的图会作为一张新图出现在右侧。</p>
                    </div>
                    <button type="button" className="se-close" aria-label="关闭" onClick={onClose}>
                        <X className="size-4" />
                    </button>
                </header>
                <div className="se-pills se-crop-ratios">
                    {CROP_RATIOS.map(([label, value]) => (
                        <button key={label} type="button" data-active={ratio === value || undefined} onClick={() => applyRatio(value)}>
                            {ratio === value ? <motion.i layoutId="se-crop-pill" transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
                <div ref={box} className="se-crop-stage" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
                    <img src={resourceFileUrl(item.resourceId)} alt="" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }} draggable={false} />
                    <div className="se-crop-box" style={{ left: frame.left + px(crop.x, frame.width), top: frame.top + px(crop.y, frame.height), width: px(crop.w, frame.width), height: px(crop.h, frame.height) }} onPointerDown={onPointerDown("move")}>
                        <i className="se-crop-grid" />
                        {["tl", "tr", "bl", "br"].map((corner) => (
                            <b key={corner} data-corner={corner} onPointerDown={onPointerDown(corner)} />
                        ))}
                        <span>
                            {Math.round(crop.w * natural.w)} × {Math.round(crop.h * natural.h)}
                        </span>
                    </div>
                </div>
                <footer className="se-foot">
                    <span className="se-price">本机裁剪，不消耗积分</span>
                    <motion.button type="button" className="se-go" data-ready disabled={busy} onClick={() => void confirm()} whileTap={{ scale: 0.96 }}>
                        {busy ? <LoaderCircle className="sp-spin size-4" /> : null}
                        确认裁剪
                        <ArrowRight className="se-go-arrow size-4" />
                    </motion.button>
                </footer>
            </motion.div>
        </motion.div>,
        document.body,
    );
}
