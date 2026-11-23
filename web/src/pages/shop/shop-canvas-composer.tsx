import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "antd";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { canvasOverlayBounds, updateCanvasNodePanelBounds } from "@/lib/canvas/canvas-overlay-layout";
import { resourceVariantUrl } from "@/services/api/resources";
import { placeShopCanvasComposer } from "./shop-canvas-geometry";
import "./shop-canvas-node-fields.css";

export function ShopCanvasComposer({ open, nodeId, title, inspect, editor, onClose, children }: { open: boolean; nodeId?: string; title: string; inspect?: boolean; editor?: "image"; onClose: () => void; children: ReactNode }) {
    const panel = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    const [expanded, setExpanded] = useState(false);
    useLayoutEffect(() => {
        if (!open || !panel.current) return;
        const element = panel.current;
        const root = element.closest("main")!;
        const canvas = root.querySelector<HTMLElement>("[data-canvas-viewport]");
        const node = nodeId ? root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`) : null;
        const body = element.querySelector<HTMLElement>(".sp-canvas-floating-composer-body");
        let reveal = true;
        let previousLayout = { width: 0, height: 0, bounds: "" };
        const layout = () => {
            const rail = root.querySelector(".sp-canvas-rail")?.getBoundingClientRect();
            const top = root.querySelector(".sp-canvas-topbar")?.getBoundingClientRect();
            const toolbar = root.querySelector(".commerce-canvas-toolbar")?.getBoundingClientRect();
            const agent = document.querySelector(".shop-agent-host:not([hidden]) .shop-agent-panel")?.getBoundingClientRect();
            const bounds = canvasOverlayBounds(
                { width: window.innerWidth, height: window.innerHeight },
                { left: window.innerWidth < 650 ? 12 : (rail?.right || 80) + 16, top: (top?.bottom || 90) + 12, right: agent ? agent.left - 12 : window.innerWidth - 12, bottom: (toolbar?.top || window.innerHeight - 65) - 12 },
            );
            element.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`;
            const maxHeight = Math.max(0, bounds.bottom - bounds.top);
            const rect = node?.getBoundingClientRect() || { x: window.innerWidth / 2 - 120, y: 110, width: 240, height: 120, right: window.innerWidth / 2 + 120 };
            const width = element.offsetWidth;
            const form = body?.querySelector<HTMLElement>(".sp-composer");
            const formContent = form?.querySelector<HTMLElement>(".sp-composer-body");
            const formToolbar = form?.querySelector<HTMLElement>(".sp-toolbar");
            const formSettings = form?.querySelector<HTMLElement>(".sp-canvas-scene-settings");
            const bodyStyle = body ? getComputedStyle(body) : null;
            const bodyPadding = bodyStyle ? parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom) : 0;
            const intrinsicHeight =
                formContent && formToolbar
                    ? (element.querySelector("header")?.getBoundingClientRect().height || 0) + bodyPadding + formContent.scrollHeight + formToolbar.offsetHeight + (formSettings?.offsetHeight || 0) + 2
                    : body
                      ? element.offsetHeight - body.clientHeight + body.scrollHeight
                      : element.offsetHeight;
            const desiredHeight = Math.min(maxHeight, Math.max(180, intrinsicHeight));
            // Reserve space for the node as well as the editor. Tall forms scroll internally.
            const preferredHeight = Math.min(desiredHeight, Math.max(180, maxHeight - Math.min(rect.height, maxHeight * 0.4) - 16));
            const boundsKey = `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
            const shouldReveal = reveal || width !== previousLayout.width || preferredHeight > previousLayout.height + 1 || boundsKey !== previousLayout.bounds;
            previousLayout = { width, height: preferredHeight, bounds: boundsKey };
            const placed = placeShopCanvasComposer(rect, { width, height: preferredHeight }, bounds, shouldReveal);
            element.style.maxHeight = `${Math.max(0, Math.min(preferredHeight, bounds.bottom - placed.top))}px`;
            element.style.height = `${preferredHeight}px`;
            if (shouldReveal && node && (editor !== "image" || body?.querySelector("[data-canvas-editor]"))) {
                reveal = false;
                if (Math.abs(placed.dx) > 1 || Math.abs(placed.dy) > 1) root.dispatchEvent(new CustomEvent("shop-canvas-reveal", { detail: { dx: placed.dx, dy: placed.dy } }));
            }
            const parent = element.offsetParent;
            const origin = parent?.getBoundingClientRect();
            element.style.left = `${placed.left - (origin?.left ?? 0) - (parent?.clientLeft ?? 0) + (parent?.scrollLeft ?? 0)}px`;
            element.style.top = `${placed.top - (origin?.top ?? 0) - (parent?.clientTop ?? 0) + (parent?.scrollTop ?? 0)}px`;
            if (canvas) updateCanvasNodePanelBounds(canvas, element, { left: placed.left, top: placed.top, right: placed.left + element.offsetWidth, bottom: placed.top + element.offsetHeight });
        };
        const resize = new ResizeObserver(layout);
        resize.observe(element);
        resize.observe(root);
        if (node) resize.observe(node);
        body?.addEventListener("toggle", layout, true);
        const observer = new MutationObserver(layout);
        const world = root.querySelector("[data-canvas-world-layer]");
        if (world) observer.observe(world, { attributes: true, attributeFilter: ["style"] });
        if (node) observer.observe(node, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", layout);
        layout();
        return () => {
            body?.removeEventListener("toggle", layout, true);
            resize.disconnect();
            observer.disconnect();
            window.removeEventListener("resize", layout);
            if (canvas) updateCanvasNodePanelBounds(canvas, element, null);
        };
    }, [open, nodeId, expanded, inspect, editor]);
    return (
        <AnimatePresence>
            {open ? (
                <motion.div
                    ref={panel}
                    className="sp-canvas-floating-composer"
                    data-editor={editor}
                    data-expanded={expanded || undefined}
                    data-inspect={inspect || undefined}
                    role="region"
                    aria-label="节点生成配置"
                    data-canvas-node-panel
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
                >
                    <header>
                        <ShopCanvasGlyph name="spark" size={16} />
                        <strong>{title}</strong>
                        <span />
                        <AntTooltip title={expanded ? "收起输入框" : "展开输入框"} trigger={["hover", "focus"]}>
                            <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-label={expanded ? "收起输入框" : "展开输入框"}>
                                {expanded ? <ShopCanvasGlyph name="shrink" size={16} /> : <ShopCanvasGlyph name="fit" size={16} />}
                            </button>
                        </AntTooltip>
                        <AntTooltip title="关闭配置 · Esc" trigger={["hover", "focus"]}>
                            <button type="button" aria-label="关闭生成配置" onClick={onClose}>
                                <ShopCanvasGlyph name="close" size={16} />
                            </button>
                        </AntTooltip>
                    </header>
                    <div className="sp-canvas-floating-composer-body" data-canvas-wheel-scroll>
                        {children}
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

export function ShopCanvasRunDetails({
    status,
    stage,
    error,
    progress,
    prompt,
    modelLabel,
    ratio,
    resolution,
    references,
    onReuse,
}: {
    status?: "loading" | "running" | "done" | "failed";
    stage?: string;
    error?: string;
    progress?: number;
    prompt?: string;
    modelLabel?: string;
    ratio?: string;
    resolution?: string;
    references: string[];
    onReuse?: () => void;
}) {
    const labels = [
        ["模型", modelLabel],
        ["比例", ratio?.toLowerCase() === "auto" ? "自动" : ratio],
        ["分辨率", resolution?.toLowerCase() === "auto" ? "自动" : resolution?.toUpperCase()],
    ].filter(([, value]) => value);
    const terminal = status === "done" || status === "failed";
    const stateLabel = status === "done" ? "已完成" : status === "failed" ? error || "生成失败" : stage || (status === "running" ? "正在生成" : "正在读取任务状态");
    return (
        <div className="sp-canvas-run-details">
            <div className="sp-canvas-run-status" role={status === "failed" ? "alert" : "status"} data-state={status}>
                <span>{stateLabel}</span>
                {status === "running" && typeof progress === "number" ? <span>{Math.round(progress)}%</span> : null}
            </div>
            {references.length ? (
                <section className="sp-canvas-run-references">
                    <strong>参考素材</strong>
                    <div data-canvas-wheel-scroll>
                        {[...new Set(references)].map((id, index) => (
                            <img key={id} src={resourceVariantUrl(id, "thumbnail-small")} alt={`参考图 ${index + 1}`} loading="lazy" draggable={false} />
                        ))}
                    </div>
                </section>
            ) : null}
            <label className="sp-canvas-run-prompt">
                <span>AI 提示词</span>
                <textarea value={prompt || ""} placeholder="这次任务未保存提示词" rows={3} readOnly />
            </label>
            {labels.length ? (
                <dl className="sp-canvas-run-parameters">
                    {labels.map(([name, value]) => (
                        <div key={name}>
                            <dt>{name}</dt>
                            <dd>{value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            {terminal && onReuse ? (
                <footer>
                    <Button className="sp-canvas-run-reuse" size="small" onClick={onReuse}>
                        使用配置新建节点
                    </Button>
                </footer>
            ) : null}
        </div>
    );
}
