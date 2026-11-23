import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { AppModal } from "@/components/ui/product/app-modal";
import { resourceStorageKey, resolveResourceVariantUrl } from "@/services/api/resources";
import { commerceConnectionPath } from "./shop-canvas-graph";
import type { ShopWorkflow } from "./shop-canvas-workflows";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";

export function ShopWorkflowGraph({ workflow, onSelect }: { workflow: ShopWorkflow; onSelect?: (node: CanvasLayer) => void }) {
    const bounds = useMemo(() => {
        const nodes = workflow.nodes;
        const left = Math.min(0, ...nodes.map((n) => n.x)) - 30,
            top = Math.min(0, ...nodes.map((n) => n.y)) - 30;
        return { left, top, width: Math.max(700, ...nodes.map((n) => n.x + 290)) - left, height: Math.max(340, ...nodes.map((n) => n.y + 260)) - top };
    }, [workflow]);
    return (
        <svg className="sp-workflow-graph" viewBox={`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`} aria-label={`${workflow.name} 制作链路`}>
            {workflow.nodes.flatMap((node) =>
                (node.inputs || []).map((id) => {
                    const source = workflow.nodes.find((n) => n.id === id);
                    return source ? <path key={`${id}-${node.id}`} d={commerceConnectionPath({ x: source.x + 240, y: source.y + 90 }, { x: node.x, y: node.y + 90 })} fill="none" stroke="var(--ms-accent-strong)" strokeWidth={2} /> : null;
                }),
            )}
            {workflow.nodes.map((node) => (
                <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    role={onSelect ? "button" : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    aria-label={onSelect ? `查看节点：${node.text || "素材"}` : undefined}
                    onClick={onSelect ? () => onSelect(node) : undefined}
                    onKeyDown={
                        onSelect
                            ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onSelect(node);
                                  }
                              }
                            : undefined
                    }
                >
                    <title>
                        {node.text || "素材"}
                        {node.prompt ? `：${node.prompt}` : ""}
                    </title>
                    <rect width={240} height={180} rx={14} fill="var(--ms-surface)" stroke="var(--ms-border)" />
                    {node.resourceId && node.type !== "video" ? (
                        <image href={resolveResourceVariantUrl(resourceStorageKey(node.resourceId), "thumbnail")} x={8} y={8} width={224} height={130} preserveAspectRatio="xMidYMid meet" />
                    ) : (
                        <>
                            <circle cx={120} cy={65} r={22} fill="var(--ms-accent-soft)" />
                            <g transform="translate(108 53)" color="var(--ms-accent-strong)">
                                <ShopCanvasGlyph name={node.draftKind || node.type} size={24} />
                            </g>
                        </>
                    )}
                    <text x={120} y={155} textAnchor="middle" fontSize={14} fill="var(--ms-text)">
                        {(node.text || (node.type === "video" ? "视频素材" : "图片素材")).split("\n")[0].slice(0, 18)}
                    </text>
                </g>
            ))}
        </svg>
    );
}

const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 5;
const INITIAL_VIEWPORT = { x: 0, y: 0, zoom: 1 };
type PreviewPoint = { x: number; y: number };
type PreviewPointer = { point: PreviewPoint; start: PreviewPoint; target: Element };

function zoomPreviewAt(viewport: typeof INITIAL_VIEWPORT, zoom: number, point: PreviewPoint) {
    const nextZoom = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, zoom));
    const ratio = nextZoom / viewport.zoom;
    return { x: point.x - (point.x - viewport.x) * ratio, y: point.y - (point.y - viewport.y) * ratio, zoom: nextZoom };
}

function ShopWorkflowPreviewContent({ workflow, onCopy, busy }: { workflow: ShopWorkflow; onCopy: () => void; busy: boolean }) {
    const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
    const viewportRef = useRef(viewport);
    const stageRef = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, PreviewPointer>());
    const moved = useRef(false);
    const suppressClick = useRef(false);
    const [dragging, setDragging] = useState(false);
    const [selected, setSelected] = useState<CanvasLayer | null>(null);
    const updateViewport = (next: typeof INITIAL_VIEWPORT) => {
        viewportRef.current = next;
        setViewport(next);
    };
    const zoomFromCenter = (zoom: number) => {
        const stage = stageRef.current;
        if (stage) updateViewport(zoomPreviewAt(viewportRef.current, zoom, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }));
    };
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const activePointers = pointers.current;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = stage.getBoundingClientRect();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
            updateViewport(zoomPreviewAt(viewportRef.current, viewportRef.current.zoom * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002), { x: event.clientX - rect.left - stage.clientLeft, y: event.clientY - rect.top - stage.clientTop }));
        };
        stage.addEventListener("wheel", wheel, { passive: false });
        return () => {
            stage.removeEventListener("wheel", wheel);
            const captured = [...activePointers.entries()];
            activePointers.clear();
            for (const [id, pointer] of captured) if (pointer.target.hasPointerCapture(id)) pointer.target.releasePointerCapture(id);
        };
    }, []);
    const pointerPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
        const stage = event.currentTarget;
        const rect = stage.getBoundingClientRect();
        return { x: event.clientX - rect.left - stage.clientLeft, y: event.clientY - rect.top - stage.clientTop };
    };
    const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        const pointer = pointers.current.get(event.pointerId);
        if (!pointer) return;
        pointers.current.delete(event.pointerId);
        if (event.type !== "pointerup") suppressClick.current = true;
        if (pointer.target.hasPointerCapture(event.pointerId)) pointer.target.releasePointerCapture(event.pointerId);
        for (const remaining of pointers.current.values()) remaining.start = remaining.point;
        if (!pointers.current.size) {
            moved.current = false;
            setDragging(false);
        }
    };
    return (
        <section className="sp-workflow-preview ms-scope" data-canvas-no-zoom>
            <header>
                <span>
                    <ShopCanvasGlyph name="lock" size={15} />
                    只读模式，如需创建请点击复制项目
                </span>
                <button onClick={onCopy} disabled={busy}>
                    <ShopCanvasGlyph name="duplicate" size={16} />
                    {busy ? "正在复制…" : "复制项目"}
                </button>
            </header>
            <div className="sp-workflow-brief">
                <p>{workflow.description}</p>
                {workflow.requirements?.length ? <p>准备素材：{workflow.requirements.join(" · ")}</p> : null}
                {workflow.limitation ? <p className="sp-workflow-limit">{workflow.limitation}</p> : null}
                <small>拖动画布移动，滚轮或双指缩放，点击节点查看用途与提示词。</small>
            </div>
            <div
                ref={stageRef}
                className={`sp-workflow-preview-stage${dragging ? " is-dragging" : ""}`}
                role="region"
                aria-label="工作流预览画布"
                tabIndex={0}
                style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px` }}
                onPointerDown={(event) => {
                    if ((event.button !== 0 && event.button !== 1) || pointers.current.size >= 2) return;
                    event.stopPropagation();
                    if (!pointers.current.size) {
                        moved.current = false;
                        suppressClick.current = false;
                    } else {
                        moved.current = true;
                        suppressClick.current = true;
                        setDragging(true);
                    }
                    const point = pointerPoint(event);
                    // Keep capture on the pressed element so a stationary click still reaches its node.
                    const target = event.target as Element;
                    pointers.current.set(event.pointerId, { point, start: point, target });
                    target.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const pointer = pointers.current.get(event.pointerId);
                    if (!pointer) return;
                    event.stopPropagation();
                    const point = pointerPoint(event);
                    const previous = pointer.point;
                    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
                    pointer.point = point;
                    if (other) {
                        const before = { x: (previous.x + other.point.x) / 2, y: (previous.y + other.point.y) / 2 };
                        const after = { x: (point.x + other.point.x) / 2, y: (point.y + other.point.y) / 2 };
                        const distance = Math.hypot(previous.x - other.point.x, previous.y - other.point.y);
                        const nextDistance = Math.hypot(point.x - other.point.x, point.y - other.point.y);
                        const next = zoomPreviewAt(viewportRef.current, viewportRef.current.zoom * (distance > 0 ? nextDistance / distance : 1), before);
                        updateViewport({ ...next, x: next.x + after.x - before.x, y: next.y + after.y - before.y });
                    } else {
                        if (!moved.current && Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) < 4) return;
                        const from = moved.current ? previous : pointer.start;
                        moved.current = true;
                        suppressClick.current = true;
                        setDragging(true);
                        updateViewport({ ...viewportRef.current, x: viewportRef.current.x + point.x - from.x, y: viewportRef.current.y + point.y - from.y });
                    }
                }}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
                onLostPointerCapture={endPointer}
                onClickCapture={(event) => {
                    if (suppressClick.current && event.detail !== 0) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }}
                onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "+" || event.key === "=") zoomFromCenter(viewportRef.current.zoom + 0.25);
                    else if (event.key === "-") zoomFromCenter(viewportRef.current.zoom - 0.25);
                    else if (event.key === "0") updateViewport(INITIAL_VIEWPORT);
                    else if (event.key.startsWith("Arrow")) {
                        const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
                        if (!delta) return;
                        updateViewport({ ...viewportRef.current, x: viewportRef.current.x + delta[0], y: viewportRef.current.y + delta[1] });
                    } else return;
                    event.preventDefault();
                    event.stopPropagation();
                }}
            >
                <div className="sp-workflow-preview-content" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
                    <ShopWorkflowGraph workflow={workflow} onSelect={setSelected} />
                </div>
            </div>
            {selected ? (
                <aside className="sp-workflow-node-detail" aria-label="工作流节点详情">
                    <strong>{selected.text}</strong>
                    <p>{selected.draftKind === "upload-card" ? "复制项目后，在此节点上传自己的图片或视频。已连接的生成节点会使用这份素材。" : selected.prompt || (selected.type === "text" ? selected.text : "复制后可选择模型、补充提示词与参考素材。")}</p>
                    <small>{selected.inputs?.length || 0} 个上游输入 · 预览不可修改</small>
                </aside>
            ) : null}
            <footer>
                <button aria-label="缩小预览" title="缩小预览" disabled={viewport.zoom <= MIN_PREVIEW_ZOOM} onClick={() => zoomFromCenter(viewportRef.current.zoom - 0.25)}>
                    <ShopCanvasGlyph name="minus" size={16} />
                </button>
                <span>{Math.round(viewport.zoom * 100)}%</span>
                <button aria-label="放大预览" title="放大预览" disabled={viewport.zoom >= MAX_PREVIEW_ZOOM} onClick={() => zoomFromCenter(viewportRef.current.zoom + 0.25)}>
                    <ShopCanvasGlyph name="plus" size={16} />
                </button>
                <button aria-label="复位预览" title="复位预览" onClick={() => updateViewport(INITIAL_VIEWPORT)}>
                    <ShopCanvasGlyph name="fit" size={16} />
                    复位
                </button>
            </footer>
        </section>
    );
}

export function ShopWorkflowPreview({ workflow, onClose, onCopy, busy }: { workflow: ShopWorkflow | null; onClose: () => void; onCopy: () => void; busy: boolean }) {
    return (
        <AppModal open={Boolean(workflow)} onCancel={onClose} footer={null} width="min(1440px, 96vw)" style={{ top: 24 }} title={workflow?.name} destroyOnHidden>
            {workflow ? <ShopWorkflowPreviewContent key={workflow.id} workflow={workflow} onCopy={onCopy} busy={busy} /> : null}
        </AppModal>
    );
}
