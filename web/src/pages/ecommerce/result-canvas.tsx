import { createClientUUID } from "@/lib/client-id";
import { App, Tooltip } from "antd";
import { connectCommerceNodes, commerceNodeReferences, commerceConnectionPath, syncShopCanvasReferences, type CommerceGraphNode, type ShopCanvasReferenceInput } from "@/pages/shop/shop-canvas-graph";
import { SHOP_CANVAS_TOOLS } from "@/pages/shop/shop-canvas-catalog";
import { cloneWorkflowNodes } from "@/pages/shop/shop-canvas-workflows";
import { SHOP_CANVAS_SNAPSHOT_SAVED } from "@/pages/shop/shop-canvas-projects";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { ShopCanvasTextTools } from "@/pages/shop/shop-canvas-text-tools";
import { ShopCanvasGlyph } from "@/pages/shop/shop-canvas-glyph";
import { ShopCreating } from "@/pages/shop/shop-thinking";
import { ShopCanvasMediaTools, ShopCanvasVideo } from "@/pages/shop/shop-canvas-media-tools";
import { readShopCanvasVideoSubmission, shopCanvasVideoSubmissionKey } from "@/pages/shop/shop-canvas-normal-video-state";
import "@/pages/shop/shop-canvas-normal-video.css";
import { aspectRatioOf, workbenchTaskOutputs, workbenchTaskStateLabel } from "@/pages/workbench/workbench-batches";
import type { WorkbenchVideoNodeDraft } from "@/pages/workbench/workbench-video-node";
import { subscribeGenerationTasks } from "@/services/api/task-center";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { motion, useReducedMotion } from "motion/react";
import { Check, Eye, Pencil, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { CanvasViewport } from "@/components/canvas/canvas-viewport";
import { HandIcon, ImagePlusIcon, LayersIcon, PointerIcon, RedoIcon, TextToolIcon, UndoIcon } from "@/components/ui/ecommerce-icons";
import { resolveCanvasSelectionStrategy } from "@/lib/canvas/canvas-selection";
import { canvasNodePanelBounds } from "@/lib/canvas/canvas-overlay-layout";
import { resourceStorageKey, resolveResourceVariantUrl, uploadResourceFile } from "@/services/api/resources";
import type { ViewportTransform } from "@/types/canvas";
import { arrangeCommerceBoxes, type CommerceArrangeKind } from "./canvas-arrange";
import { CommerceArrangeMenu, type CommerceArrangeAction } from "./canvas-arrange-bar";
import { commerceCanvasLayout } from "./canvas-layout";
import { COMMERCE_SNAP_THRESHOLD, measureCommerceSnapScene, paintCommerceSnapGuides, snapCommerceMove, type SnapScene } from "./canvas-snap";
import { useResultNodeDrag } from "./use-result-node-drag";
import { resizeShopImage, SHOP_IMAGE_RESIZE_HANDLES, type ShopImageResizeHandle } from "@/pages/shop/shop-canvas-geometry";

export type CanvasLayer = {
    id: string;
    type: "text" | "image" | "video" | "audio" | "result" | "generation" | "draft";
    x: number;
    y: number;
    width?: number;
    height?: number;
    text?: string;
    resourceId?: string;
    generationKey?: string;
    draftKind?: string;
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    inputs?: string[];
    managedInputIds?: string[];
    generatedReference?: true;
    groupId?: string;
    flipX?: boolean;
    flipY?: boolean;
    annotation?: boolean;
    fontWeight?: number;
    italic?: boolean;
    textAlign?: "left" | "center" | "right";
    letterSpacing?: number;
    lineHeight?: number;
    config?: unknown;
    prompt?: string;
    videoKind?: "model" | "face" | "combination" | "clothing" | "product" | "background";
    materialCategory?: string;
    videoProjectId?: string;
    videoTaskId?: string;
    videoResultUnavailable?: boolean;
    videoStage?: string;
    videoFailed?: boolean;
    normalVideoDraft?: WorkbenchVideoNodeDraft;
    normalVideoLinks?: string;
};
export type CanvasLayerSummary = { id: string; type: Exclude<CanvasLayer["type"], "result">; label: string; resourceId?: string; draftKind?: string; generationKey?: string; videoProjectId?: string; videoTaskId?: string };
export type EcommerceCanvasGeneration = { key: string; status: "running" | "done" | "failed"; resourceId: string; label: string; stage?: string; error?: string; progress?: number; createdAt?: string };
export type EcommerceCanvasGenerationRequest = { keys: string[]; nonce: number; targetId?: string; submitted?: Pick<CanvasLayer, "draftKind" | "text" | "config">; references?: ShopCanvasReferenceInput[] };
export type EcommerceCanvasReferenceRequest = { nodeId: string; references: ShopCanvasReferenceInput[]; nonce: number; append?: boolean };
export type EcommerceCanvasDraftRequest = { kind: string; label: string; nonce: number; position?: { x: number; y: number }; connection?: NodeConnection; reuse?: { sourceId: string; config: unknown } };
type CanvasHistory = { past: CanvasLayer[][]; present: CanvasLayer[]; future: CanvasLayer[][] };
type CanvasTool = "select" | "hand" | "text";
type NodeConnection = { nodeId: string; side: "input" | "output" };
type CanvasToolRequest = { tool: CanvasTool; nonce: number; text?: string; fontFamily?: string; fontSize?: number; color?: string; position?: { x: number; y: number }; connection?: NodeConnection; annotation?: boolean };
type GroupBounds = { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number; inset: number };

/** 与视口组件的缩放范围一致；快捷键缩放落在常用整档比例上。 */
const ZOOM_STOPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const clampZoom = (k: number) => Math.min(2, Math.max(0.05, k));
/** 排布动画时长，结束后再重新测量选区外框。 */
const ARRANGE_MOTION_MS = 380;

/** 底部工具条与画布边缘、右下角图层组之间的最小间距。 */
const TOOLBAR_EDGE = 16;
const TOOLBAR_GAP = 12;
const EMPTY_RESULT_SELECTION = new Set<string>();

const REFERENCE_NODE_SIZE = { width: 180, height: 128 };
const GENERATOR_NODE_SIZE = { width: 262, height: 302 };
const REFERENCE_NODE_LABEL = { image: "参考图", video: "参考视频", audio: "参考音频", text: "参考文字" };
type GraphNodeSize = { width: number; height: number };

function availableLayerPosition(position: { x: number; y: number }, size: GraphNodeSize, nodes: CanvasLayer[], measured: ReadonlyMap<string, GraphNodeSize>) {
    const gap = 48;
    const peers = nodes
        .filter((node) => node.type !== "result")
        .map((node) => ({ x: node.x, y: node.y, ...(measured.get(node.id) || (node.generatedReference ? REFERENCE_NODE_SIZE : GENERATOR_NODE_SIZE)) }))
        .filter((node) => position.x < node.x + node.width + gap && position.x + size.width + gap > node.x);
    const step = size.height + gap;
    for (let index = 0; index <= peers.length * 4; index += 1) {
        const offset = Math.ceil(index / 2) * (index % 2 ? 1 : -1) * step;
        const y = position.y + offset;
        if (peers.every((node) => y >= node.y + node.height + gap || y + size.height + gap <= node.y)) return { x: position.x, y };
    }
    return { x: position.x, y: Math.max(position.y, ...peers.map((node) => node.y + node.height + gap)) };
}

function synchronizeGeneratorReferences(nodes: CanvasLayer[], target: CanvasLayer, references: ShopCanvasReferenceInput[], ids: string[], measured: ReadonlyMap<string, GraphNodeSize>, append = false, panelLeft?: number) {
    const height = measured.get(target.id)?.height || GENERATOR_NODE_SIZE.height;
    const origin = { x: Math.min(target.x - 104, panelLeft ?? Infinity) - REFERENCE_NODE_SIZE.width, y: target.y + (height - REFERENCE_NODE_SIZE.height) / 2 };
    return syncShopCanvasReferences<CanvasLayer>(
        nodes,
        target.id,
        references,
        (reference, current, index) => ({
            id: ids[index],
            type: reference.kind,
            resourceId: reference.resourceId,
            text: reference.name?.trim() || REFERENCE_NODE_LABEL[reference.kind],
            materialCategory: reference.materialCategory,
            generatedReference: true,
            ...availableLayerPosition(origin, REFERENCE_NODE_SIZE, current, measured),
        }),
        append,
    );
}

function isCompletedVideoNode(layer: CanvasLayer) {
    return layer.type === "video" && Boolean(layer.videoProjectId || layer.videoTaskId);
}

/**
 * 左侧 Agent 面板悬浮在画布上时，从画布左边缘算起被面板占住的宽度；面板收起，
 * 或窄屏下面板改为与画布上下堆叠（不再绝对定位）时为 0。
 * 用 offsetLeft/offsetWidth 而不是 getBoundingClientRect，收起/展开动画里的 transform 不会让结果抖动。
 */
function overlayPanelInset(section: HTMLElement | null) {
    const panel = section?.parentElement?.querySelector<HTMLElement>(".flylep-workspace:not(.is-collapsed), .sp-canvas-side-panel");
    if (!section || !panel || getComputedStyle(panel).position !== "absolute") return 0;
    return Math.max(0, Math.min(section.clientWidth, panel.offsetLeft + panel.offsetWidth - section.offsetLeft));
}

function readLayers(storageKey: string): CanvasLayer[] {
    try {
        const value = JSON.parse(localStorage.getItem(`ecommerce-canvas:${storageKey}`) || "[]");
        return Array.isArray(value)
            ? value.filter((item): item is CanvasLayer => item && typeof item.id === "string" && ["text", "image", "video", "audio", "result", "generation", "draft"].includes(item.type) && Number.isFinite(item.x) && Number.isFinite(item.y))
            : [];
    } catch {
        return [];
    }
}

type ResultLayer = { id: string; label: string; src?: string; ready: boolean };
export type EcommerceCanvasContextTarget = { id: string; type: CanvasLayer["type"] };
export type EcommerceCanvasLayerSelectionRequest = { ids: string[]; nonce: number };
export type EcommerceCanvasLayerCommandRequest = {
    action: "delete" | "duplicate" | "bring-front" | "send-back" | "arrange" | "flip-horizontal" | "flip-vertical" | "group" | "ungroup";
    ids: string[];
    arrangeAction?: CommerceArrangeKind;
    nonce: number;
};
export function EcommerceResultCanvas({
    children,
    count,
    ratio,
    actions,
    emptyState,
    storageKey,
    resultLayers = [],
    selectedResults = EMPTY_RESULT_SELECTION,
    onSelectResult,
    onSelectResults,
    onSelectAll,
    onExportSelection,
    onInspectResult,
    onCanvasContextMenu,
    onSelectLayers,
    selectLayersRequest,
    layerCommandRequest,
    toolRequest,
    resourceRequest,
    uploadRequest,
    focusLayerRequest,
    onCanvasItemsChange,
    historyRequest,
    onHistoryStateChange,
    generationRequest,
    referenceRequest,
    generations = [],
    draftRequest,
    onOpenDraft,
    onInspectGeneration,
    graphEnabled = false,
    workflowRequest,
    onSnapshotChange,
    onConnectionDrop,
    persistenceScope,
    updateNodeRequest,
}: {
    children: ReactNode;
    count: number;
    ratio: string;
    actions: ReactNode;
    emptyState?: ReactNode;
    storageKey: string;
    resultLayers?: ResultLayer[];
    selectedResults?: Set<string>;
    onSelectResult?: (id: string) => void;
    onSelectResults?: (ids: string[]) => void;
    onSelectAll?: () => void;
    onExportSelection?: () => void;
    onInspectResult?: (id: string) => void;
    /** 电商画布专属右键入口；目标为空表示空白画布。 */
    onCanvasContextMenu?: (event: MouseEvent, target?: EcommerceCanvasContextTarget) => void;
    /** 普通文字/上传图片图层的选择结果，结果图片仍由 onSelectResults 管理。 */
    onSelectLayers?: (ids: string[]) => void;
    /** 由父层触发普通图层的多选，供右键复制/删除等操作回写选择。 */
    selectLayersRequest?: EcommerceCanvasLayerSelectionRequest;
    layerCommandRequest?: EcommerceCanvasLayerCommandRequest;
    toolRequest?: CanvasToolRequest;
    resourceRequest?: { resourceId: string; kind?: "image" | "video"; nonce: number };
    uploadRequest?: number;
    focusLayerRequest?: { id: string; nonce: number };
    onCanvasItemsChange?: (items: CanvasLayerSummary[]) => void;
    historyRequest?: { action: "undo" | "redo"; nonce: number };
    onHistoryStateChange?: (state: { canUndo: boolean; canRedo: boolean; pastCount: number }) => void;
    generationRequest?: EcommerceCanvasGenerationRequest;
    referenceRequest?: EcommerceCanvasReferenceRequest;
    generations?: EcommerceCanvasGeneration[];
    draftRequest?: EcommerceCanvasDraftRequest;
    onOpenDraft?: (id: string, kind: string, references?: CommerceGraphNode[], config?: unknown, layer?: CanvasLayer) => void;
    onInspectGeneration?: (layer: CanvasLayer) => void;
    graphEnabled?: boolean;
    workflowRequest?: { nodes: CanvasLayer[]; nonce: number };
    onSnapshotChange?: (nodes: CanvasLayer[]) => void;
    onConnectionDrop?: (anchor: { x: number; y: number; connection: NodeConnection }) => void;
    persistenceScope?: string;
    updateNodeRequest?: { id: string; patch: Partial<CanvasLayer>; nonce: number };
}) {
    const reducedMotion = useReducedMotion();
    const { message } = App.useApp();
    const [connecting, setConnecting] = useState<string | null>(null);
    const connectionSide = useRef<"input" | "output">("output");
    const connectionStart = useRef({ x: 0, y: 0 });
    const connectionPreview = useRef<SVGPathElement>(null);
    const [selectedEdge, setSelectedEdge] = useState<{ source: string; target: string } | null>(null);
    const root = useRef<HTMLElement>(null);
    const container = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const imageFitFrame = useRef<number | null>(null);
    const manuallyNavigated = useRef(false);
    const uploadInput = useRef<HTMLInputElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const layerToggleRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ id: string; groupId?: string; pointerId: number; startX: number; startY: number; layerX: number; layerY: number; before: CanvasLayer[]; snap: SnapScene | null; moved?: boolean } | null>(null);
    const guideLayer = useRef<HTMLDivElement>(null);
    const layout = commerceCanvasLayout(count, ratio);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 450, y: 160, k: 0.8 });
    const [showMiniMap, setShowMiniMap] = useState(true);
    const [gridSnap, setGridSnap] = useState(false);
    const navigateViewport = useCallback((next: ViewportTransform) => {
        manuallyNavigated.current = true;
        setViewport(next);
    }, []);
    const [tool, setTool] = useState<CanvasTool>("select");
    const pendingText = useRef("电商 Agent");
    const pendingTextStyle = useRef<{ fontFamily?: string; fontSize?: number; color?: string }>({});
    useEffect(() => {
        if (!graphEnabled) return;
        const host = root.current?.closest("main");
        const reveal = (event: Event) => {
            const { dx = 0, dy = 0 } = (event as CustomEvent<{ dx?: number; dy?: number }>).detail;
            if (Number.isFinite(dx) && Number.isFinite(dy)) setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
        };
        host?.addEventListener("shop-canvas-reveal", reveal);
        return () => host?.removeEventListener("shop-canvas-reveal", reveal);
    }, [graphEnabled]);
    const [history, setHistory] = useState<CanvasHistory>(() => ({ past: [], present: readLayers(storageKey), future: [] }));
    const [storageReady, setStorageReady] = useState(!persistenceScope);
    const storageWrites = useRef<Promise<unknown>>(Promise.resolve());
    const lastPersisted = useRef("");
    useEffect(() => {
        if (!updateNodeRequest) return;
        setHistory((current) => ({ ...current, present: current.present.map((n) => (n.id === updateNodeRequest.id ? { ...n, ...updateNodeRequest.patch } : n)) }));
    }, [updateNodeRequest]);
    const pendingVideoTasks = history.present
        .filter((node) => node.videoTaskId && !node.resourceId && !node.videoFailed && !node.videoResultUnavailable)
        .map((node) => node.videoTaskId)
        .join("|");
    useEffect(() => {
        if (!pendingVideoTasks) return;
        const controller = new AbortController();
        const finalizing = new Set<string>();
        const patch = (id: string, update: Partial<CanvasLayer>) => {
            if (controller.signal.aborted) return;
            setHistory((current) => ({ ...current, present: current.present.map((node) => (node.videoTaskId === id ? { ...node, ...update } : node)) }));
        };
        const unsubscribe = subscribeGenerationTasks(pendingVideoTasks.split("|"), (task) => {
            if (task.status !== "succeeded") {
                patch(task.id, { videoStage: workbenchTaskStateLabel(task), videoFailed: task.status === "failed" || task.status === "cancelled" });
                return;
            }
            const resourceId = workbenchTaskOutputs(task, "video").find((output) => output.resourceId)?.resourceId;
            if (resourceId) {
                patch(task.id, { type: "video", resourceId, videoStage: undefined });
                return;
            }
            if (finalizing.has(task.id)) return;
            finalizing.add(task.id);
            patch(task.id, { videoStage: "正在载入视频结果" });
            const unavailable = () => patch(task.id, { videoStage: "视频已生成，暂无法载入。可前往生图页的「视频」查看任务", videoResultUnavailable: true });
            void materializeGenerationTaskAssets(task, controller.signal)
                .then((materialized) => {
                    const resourceId = workbenchTaskOutputs(materialized, "video").find((output) => output.resourceId)?.resourceId;
                    if (resourceId) patch(task.id, { type: "video", resourceId, videoStage: undefined });
                    else unavailable();
                })
                .catch(unavailable);
        });
        return () => {
            controller.abort();
            unsubscribe();
        };
    }, [pendingVideoTasks]);
    useEffect(() => {
        if (!persistenceScope) return;
        let alive = true;
        void Promise.resolve(localForageStorageForScope(persistenceScope).getItem(`ecommerce-canvas:${storageKey}`))
            .then(async (raw) => {
                const layers: CanvasLayer[] = raw ? JSON.parse(String(raw)) : readLayers(storageKey);
                const restored = await Promise.all(
                    layers.map(async (layer) => {
                        if (layer.draftKind !== "product-video" || layer.type !== "draft") return layer;
                        const receipt = await readShopCanvasVideoSubmission(persistenceScope, shopCanvasVideoSubmissionKey(storageKey, layer.id)).catch(() => null);
                        if (!receipt?.taskId || receipt.taskId === layer.videoTaskId) return layer;
                        return { ...layer, normalVideoDraft: receipt.draft, videoTaskId: receipt.taskId, videoStage: "正在读取视频任务", videoFailed: false, videoResultUnavailable: false };
                    }),
                );
                if (!alive) return;
                if (raw || restored.some((layer, index) => layer !== layers[index])) setHistory({ past: [], present: restored, future: [] });
                setStorageReady(true);
            })
            .catch(() => message.error("画布读取失败，请刷新重试"));
        return () => {
            alive = false;
        };
    }, [persistenceScope, storageKey]);
    const graphSizes = useRef(new Map<string, { width: number; height: number }>());
    const [, refreshGraphSizes] = useState(0);
    const graphNodeIds = graphEnabled ? history.present.map((node) => node.id).join("|") : "";
    const previouslyVisibleNodes = useRef<Set<string> | null>(null);
    useLayoutEffect(() => {
        if (!graphEnabled || !content.current) return;
        const measure = () => {
            let changed = false;
            content.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((node) => {
                const id = node.dataset.nodeId!;
                const prior = graphSizes.current.get(id);
                if (prior?.width === node.offsetWidth && prior?.height === node.offsetHeight) return;
                graphSizes.current.set(id, { width: node.offsetWidth, height: node.offsetHeight });
                changed = true;
            });
            if (changed) refreshGraphSizes((value) => value + 1);
        };
        const observer = new ResizeObserver(measure);
        content.current.querySelectorAll<HTMLElement>("[data-node-id]").forEach((node) => observer.observe(node));
        measure();
        return () => observer.disconnect();
    }, [graphEnabled, graphNodeIds]);
    useLayoutEffect(() => {
        if (!graphEnabled || !storageReady || !content.current) return;
        const visible = new Set(graphNodeIds.split("|"));
        const previous = previouslyVisibleNodes.current;
        previouslyVisibleNodes.current = visible;
        if (!previous || reducedMotion) return;
        content.current.querySelectorAll<HTMLElement>("[data-generated-reference]").forEach((node) => {
            if (!previous.has(node.dataset.nodeId || "")) node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
        });
    }, [graphEnabled, graphNodeIds, reducedMotion, storageReady]);
    useEffect(() => {
        if (storageReady) onSnapshotChange?.(history.present);
    }, [history.present, onSnapshotChange, storageReady]);
    const workflowNonce = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!workflowRequest || workflowNonce.current === workflowRequest.nonce) return;
        workflowNonce.current = workflowRequest.nonce;
        const nodes = cloneWorkflowNodes(workflowRequest.nodes, true);
        setHistory((current) => {
            const offsetY = current.present.length && nodes.length ? Math.max(...current.present.map((node) => node.y + (graphSizes.current.get(node.id)?.height || 260))) + 120 - Math.min(...nodes.map((node) => node.y)) : 0;
            const placed = nodes.map((node) => ({ ...node, y: node.y + offsetY }));
            return { past: [...current.past.slice(-39), current.present], present: [...current.present, ...placed], future: [] };
        });
    }, [workflowRequest]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [layersOpen, setLayersOpen] = useState(false);
    const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [groupBounds, setGroupBounds] = useState<GroupBounds | null>(null);
    const [arranging, setArranging] = useState(false);
    const arrangeTimer = useRef<number | null>(null);
    const marqueeFrame = useRef<number | null>(null);
    const selectionCleanup = useRef<(() => void) | null>(null);
    const toolRequestNonce = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!toolRequest || toolRequestNonce.current === toolRequest.nonce) return;
        toolRequestNonce.current = toolRequest.nonce;
        if (graphEnabled && toolRequest.tool === "text") {
            const rect = container.current?.getBoundingClientRect();
            const point = toolRequest.position || { x: (rect?.left || 0) + (rect?.width || 1000) / 2, y: (rect?.top || 0) + (rect?.height || 700) / 2 };
            const layer: CanvasLayer = {
                id: createClientUUID(),
                type: "text",
                ...worldPoint(point.x, point.y),
                text: toolRequest.text || "输入文案",
                fontFamily: toolRequest.fontFamily,
                fontSize: toolRequest.fontSize || 24,
                color: toolRequest.color,
                annotation: toolRequest.annotation,
            };
            let nodes = [...history.present, layer];
            if (toolRequest.connection) {
                const { nodeId, side } = toolRequest.connection;
                nodes = connectCommerceNodes(nodes, side === "output" ? nodeId : layer.id, side === "output" ? layer.id : nodeId).nodes;
            }
            commit(nodes);
            setSelectedId(layer.id);
            setSelectedLayerIds(new Set([layer.id]));
            onSelectLayers?.([layer.id]);
            setEditingId(layer.id);
            setEditingText(layer.text!);
            setTool("select");
            return;
        }
        setTool(toolRequest.tool);
        if (toolRequest.text?.trim()) pendingText.current = toolRequest.text.trim();
        pendingTextStyle.current = { fontFamily: toolRequest.fontFamily, fontSize: toolRequest.fontSize, color: toolRequest.color };
        root.current?.focus({ preventScroll: true });
    }, [toolRequest]);
    useEffect(() => {
        if (!resourceRequest?.resourceId) return;
        const rect = container.current?.getBoundingClientRect();
        const point = worldPoint((rect?.left || 0) + (rect?.width || 1000) / 2, (rect?.top || 0) + (rect?.height || 700) / 2);
        commit([...history.present, { id: `import-${resourceRequest.nonce}`, type: resourceRequest.kind === "video" ? "video" : "image", x: point.x, y: point.y, resourceId: resourceRequest.resourceId }]);
        setTool("select");
    }, [resourceRequest]);
    useEffect(() => {
        if (!storageReady) return;
        setHistory((current) => {
            let changed = false;
            const present = current.present.map((layer) => {
                if (layer.type !== "generation" || !layer.generationKey) return layer;
                const resourceId = generations.find((item) => item.key === layer.generationKey)?.resourceId;
                if (!resourceId || resourceId === layer.resourceId) return layer;
                changed = true;
                return { ...layer, resourceId };
            });
            return changed ? { ...current, present } : current;
        });
    }, [generations, storageReady]);
    const handledReferenceNonce = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!graphEnabled || !storageReady || !referenceRequest || handledReferenceNonce.current === referenceRequest.nonce) return;
        handledReferenceNonce.current = referenceRequest.nonce;
        const { nodeId, references, append } = referenceRequest;
        const ids = references.map(() => createClientUUID());
        const canvas = container.current;
        const panels = canvas ? canvasNodePanelBounds(canvas) : [];
        const panelLeft = panels.length ? Math.min(...panels.map((panel) => panel.left)) - 18 : 0;
        const visibleLeft = canvas?.getBoundingClientRect().left ?? 0;
        const availableLane = panelLeft - visibleLeft >= REFERENCE_NODE_SIZE.width * viewport.k + 96 ? worldPoint(panelLeft, 0).x : undefined;
        setHistory((current) => {
            const target = current.present.find((layer) => layer.id === nodeId && layer.type === "draft");
            if (!target) return current;
            const present = synchronizeGeneratorReferences(current.present, target, references, ids, graphSizes.current, append, availableLane);
            return present === current.present ? current : { past: [...current.past.slice(-39), current.present], present, future: [] };
        });
    }, [graphEnabled, referenceRequest, storageReady]);
    const handledGenerationNonce = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!storageReady || !generationRequest?.keys.length || handledGenerationNonce.current === generationRequest.nonce) return;
        handledGenerationNonce.current = generationRequest.nonce;
        const rect = container.current?.getBoundingClientRect();
        const point = worldPoint((rect?.left || 0) + (rect?.width || 1000) / 2, (rect?.top || 0) + (rect?.height || 700) / 2);
        const { keys, targetId, submitted, references } = generationRequest;
        const ids = keys.map(() => createClientUUID());
        const referenceIds = references?.map(() => createClientUUID()) || [];
        const completed = new Map(generations.filter((result) => result.resourceId).map((result) => [result.key, result.resourceId]));
        setHistory((current) => {
            const attachedKeys = new Set(current.present.map((layer) => layer.generationKey).filter(Boolean));
            const freshKeys = [...new Set(keys)].filter((key) => !attachedKeys.has(key));
            if (!freshKeys.length) return current;
            const anchor = current.present.find((layer) => layer.id === targetId);
            const target = anchor?.type === "draft" ? anchor : undefined;
            const newKeys = freshKeys.slice(target ? 1 : 0);
            const anchorWidth = anchor ? graphSizes.current.get(anchor.id)?.width || GENERATOR_NODE_SIZE.width : 0;
            const siblings = newKeys.map((key, index): CanvasLayer => ({
                ...submitted,
                id: ids[index],
                type: "generation",
                generationKey: key,
                resourceId: completed.get(key),
                ...(graphEnabled
                    ? availableLayerPosition({ x: (anchor?.x ?? point.x) + (anchor ? anchorWidth + 104 : 0) + index * (GENERATOR_NODE_SIZE.width + 104), y: anchor?.y ?? point.y }, GENERATOR_NODE_SIZE, current.present, graphSizes.current)
                    : { x: (target?.x ?? point.x) + (target ? index + 1 : index) * 280, y: (target?.y ?? point.y) + (target ? 310 : 0) }),
            }));
            let present = [...current.present.map((layer) => (layer === target ? { ...layer, ...submitted, type: "generation" as const, generationKey: freshKeys[0], resourceId: completed.get(freshKeys[0]) } : layer)), ...siblings];
            const lead = target || siblings[0];
            if (lead && graphEnabled) {
                if (references) present = synchronizeGeneratorReferences(present, lead, references, referenceIds, graphSizes.current);
                const configured = present.find((layer) => layer.id === lead.id);
                const siblingIds = new Set(siblings.map((layer) => layer.id));
                present = present.map((layer) => (layer.id !== lead.id && siblingIds.has(layer.id) ? { ...layer, inputs: configured?.inputs, managedInputIds: configured?.managedInputIds } : layer));
            }
            return {
                past: [...current.past.slice(-39), current.present],
                present,
                future: [],
            };
        });
    }, [generationRequest, graphEnabled, storageReady]);
    const handledDraftNonce = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!draftRequest || handledDraftNonce.current === draftRequest.nonce) return;
        handledDraftNonce.current = draftRequest.nonce;
        const rect = container.current?.getBoundingClientRect();
        const point = worldPoint(draftRequest.position?.x ?? (rect?.left || 0) + (rect?.width || 1000) / 2, draftRequest.position?.y ?? (rect?.top || 0) + (rect?.height || 700) / 2);
        const source = draftRequest.reuse ? history.present.find((layer) => layer.id === draftRequest.reuse?.sourceId) : undefined;
        const layer: CanvasLayer = {
            id: createClientUUID(),
            type: "draft",
            draftKind: draftRequest.kind,
            text: draftRequest.label,
            ...(source ? { x: source.x + 320, y: source.y, inputs: source.inputs } : point),
            config: draftRequest.reuse?.config,
            managedInputIds: source?.managedInputIds,
            normalVideoDraft: source?.normalVideoDraft,
            normalVideoLinks: source?.normalVideoLinks,
        };
        setHistory((current) => {
            let nodes = [...current.present, layer];
            if (draftRequest.connection) {
                const { nodeId, side } = draftRequest.connection;
                nodes = connectCommerceNodes(nodes, side === "output" ? nodeId : layer.id, side === "output" ? layer.id : nodeId).nodes;
            }
            return { past: [...current.past.slice(-39), current.present], present: nodes, future: [] };
        });
        setSelectedId(layer.id);
        setSelectedLayerIds(new Set([layer.id]));
        onSelectLayers?.([layer.id]);
        if (draftRequest.reuse) onOpenDraft?.(layer.id, draftRequest.kind, commerceNodeReferences([...history.present, layer], layer.id), layer.config, layer);
    }, [draftRequest]);
    useEffect(() => {
        if (uploadRequest === undefined) return;
        uploadInput.current?.click();
    }, [uploadRequest]);
    useEffect(() => {
        if (!focusLayerRequest) return;
        setTool("select");
        setSelectedId(focusLayerRequest.id);
        setSelectedLayerIds(new Set([focusLayerRequest.id]));
        onSelectLayers?.([focusLayerRequest.id]);
    }, [focusLayerRequest]);
    const handledSelectionNonce = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!selectLayersRequest || handledSelectionNonce.current === selectLayersRequest.nonce) return;
        handledSelectionNonce.current = selectLayersRequest.nonce;
        const valid = new Set(selectLayersRequest.ids.filter((id) => history.present.some((layer) => layer.id === id && layer.type !== "result")));
        setSelectedLayerIds(valid);
        setSelectedId(valid.size === 1 ? Array.from(valid)[0] : null);
        onSelectLayers?.(Array.from(valid));
    }, [history.present, onSelectLayers, selectLayersRequest]);
    useEffect(() => {
        onCanvasItemsChange?.(
            history.present
                .filter((layer) => layer.type !== "result")
                .map((layer) => {
                    const generated = layer.type === "generation" ? generations.find((item) => item.key === layer.generationKey) : undefined;
                    return {
                        id: layer.id,
                        type: generated?.resourceId || (layer.type === "generation" && layer.resourceId) ? ("image" as const) : (layer.type as CanvasLayerSummary["type"]),
                        label:
                            generated?.label ||
                            layer.text ||
                            (layer.type === "video"
                                ? layer.videoProjectId
                                    ? "视频替换"
                                    : layer.videoTaskId
                                      ? "视频生成"
                                      : "视频素材"
                                : layer.type === "audio"
                                  ? "音频素材"
                                  : layer.type === "generation"
                                    ? "生成节点"
                                    : layer.type === "image"
                                      ? "图片素材"
                                      : "文字节点"),
                        resourceId: generated?.resourceId || (layer.type === "text" ? undefined : layer.resourceId),
                        draftKind: layer.draftKind,
                        generationKey: layer.generationKey,
                        videoProjectId: layer.videoProjectId,
                        videoTaskId: layer.videoTaskId,
                    };
                }),
        );
    }, [generations, history.present, onCanvasItemsChange]);
    useEffect(
        () => () => {
            selectionCleanup.current?.();
            if (arrangeTimer.current !== null) window.clearTimeout(arrangeTimer.current);
            if (marqueeFrame.current !== null) cancelAnimationFrame(marqueeFrame.current);
        },
        [],
    );
    const commit = useCallback((next: CanvasLayer[]) => setHistory((current) => ({ past: [...current.past.slice(-39), current.present], present: next, future: [] })), []);
    const handledLayerCommandNonce = useRef<number | null>(null);
    const applyLayerCommand = useCallback(
        (request: EcommerceCanvasLayerCommandRequest) => {
            const ids = new Set(request.ids);
            const selected = history.present.filter((layer) => ids.has(layer.id) && layer.type !== "result");
            if (!selected.length) return;
            if (request.action === "group" || request.action === "ungroup") {
                const groupId = request.action === "group" ? createClientUUID() : undefined;
                commit(history.present.map((node) => (ids.has(node.id) ? { ...node, groupId } : node)));
                return;
            }
            if (request.action === "delete") {
                commit(
                    history.present.filter((layer) => !ids.has(layer.id) || layer.type === "result").map((layer) => ({ ...layer, inputs: layer.inputs?.filter((id) => !ids.has(id)), managedInputIds: layer.managedInputIds?.filter((id) => !ids.has(id)) })),
                );
                setSelectedLayerIds(new Set());
                setSelectedId(null);
                onSelectLayers?.([]);
                return;
            }
            if (request.action === "duplicate") {
                const remap = new Map(selected.map((layer) => [layer.id, createClientUUID()]));
                const groups = new Map(selected.filter((layer) => layer.groupId).map((layer) => [layer.groupId!, createClientUUID()]));
                const clones = selected.map((layer) => ({ ...layer, id: remap.get(layer.id)!, inputs: layer.inputs?.map((id) => remap.get(id) || id), groupId: layer.groupId ? groups.get(layer.groupId) : undefined, x: layer.x + 24, y: layer.y + 24 }));
                commit([...history.present, ...clones]);
                const cloneIds = clones.map((layer) => layer.id);
                setSelectedLayerIds(new Set(cloneIds));
                setSelectedId(cloneIds.length === 1 ? cloneIds[0] : null);
                onSelectLayers?.(cloneIds);
                return;
            }
            if (request.action === "bring-front" || request.action === "send-back") {
                const selectedIds = new Set(selected.map((layer) => layer.id));
                const rest = history.present.filter((layer) => !selectedIds.has(layer.id));
                commit(request.action === "bring-front" ? [...rest, ...selected] : [...selected, ...rest]);
                return;
            }
            if (request.action === "flip-horizontal" || request.action === "flip-vertical") {
                const selectedIds = new Set(selected.map((layer) => layer.id));
                commit(
                    history.present.map((layer) =>
                        selectedIds.has(layer.id) && layer.type !== "result" ? { ...layer, [request.action === "flip-horizontal" ? "flipX" : "flipY"]: !layer[request.action === "flip-horizontal" ? "flipX" : "flipY"] } : layer,
                    ),
                );
                return;
            }
            if (request.action !== "arrange" || !request.arrangeAction) return;
            const world = content.current;
            const origin = world?.getBoundingClientRect();
            const scale = world && world.offsetWidth && origin ? origin.width / world.offsetWidth : 1;
            if (!world || !origin) return;
            const boxes = selected
                .map((layer) => {
                    const node = world.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(layer.id)}"]`);
                    if (!node) return null;
                    const rect = node.getBoundingClientRect();
                    return { id: layer.id, x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale, width: rect.width / scale, height: rect.height / scale };
                })
                .filter((box): box is { id: string; x: number; y: number; width: number; height: number } => Boolean(box));
            if (boxes.length < 2) return;
            const points = arrangeCommerceBoxes(boxes, request.arrangeAction, graphEnabled ? 96 : undefined);
            const nextById = new Map(points.map((point) => [point.id, point]));
            const next = history.present.map((layer) => {
                const point = nextById.get(layer.id);
                return point && layer.type !== "result" ? { ...layer, x: point.x, y: point.y } : layer;
            });
            if (next.every((layer, index) => layer.x === history.present[index]?.x && layer.y === history.present[index]?.y)) return;
            if (!reducedMotion) {
                if (arrangeTimer.current !== null) window.clearTimeout(arrangeTimer.current);
                setArranging(true);
                arrangeTimer.current = window.setTimeout(() => {
                    arrangeTimer.current = null;
                    setArranging(false);
                }, ARRANGE_MOTION_MS);
            }
            commit(next);
        },
        [commit, history.present, onSelectLayers, reducedMotion, graphEnabled],
    );
    useEffect(() => {
        if (!layerCommandRequest || handledLayerCommandNonce.current === layerCommandRequest.nonce) return;
        handledLayerCommandNonce.current = layerCommandRequest.nonce;
        applyLayerCommand(layerCommandRequest);
    }, [applyLayerCommand, layerCommandRequest]);
    const resultDrag = useResultNodeDrag({
        content,
        root,
        enabled: tool === "select",
        positions: history.present.filter((item) => item.type === "result"),
        selected: selectedResults,
        onSelect: (ids) => {
            setSelectedId(null);
            setSelectedLayerIds(new Set());
            onSelectLayers?.([]);
            onSelectResults?.(ids);
        },
        onCommit: (positions) => {
            const moved = new Set(positions.map((item) => item.id));
            commit([...history.present.filter((item) => item.type !== "result" || !moved.has(item.id)), ...positions.map((item) => ({ ...item, type: "result" as const }))]);
        },
    });
    useLayoutEffect(() => {
        if (selectedResults.size + selectedLayerIds.size < 2) {
            setGroupBounds(null);
            return;
        }
        // 排布动画进行中节点仍在过渡，等动画结束再测量；期间外框与排布条由样式隐藏。
        if (arranging) return;
        const frame = container.current?.getBoundingClientRect();
        if (!frame) return;
        const selected = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id],[data-node-id]") || []).filter(
            (item) => selectedResults.has(item.dataset.ecommerceImageId || "") || selectedLayerIds.has(item.dataset.nodeId || ""),
        );
        if (selected.length < 2) {
            setGroupBounds(null);
            return;
        }
        const bounds = selected.map((item) => item.getBoundingClientRect());
        const left = Math.min(...bounds.map((item) => item.left));
        const top = Math.min(...bounds.map((item) => item.top));
        const right = Math.max(...bounds.map((item) => item.right));
        const bottom = Math.max(...bounds.map((item) => item.bottom));
        const inset = Number.parseFloat(root.current?.style.getPropertyValue("--commerce-sidebar-width") || "") || 0;
        const outline = root.current?.querySelector<HTMLElement>(".commerce-canvas-group-outline");
        if (outline) outline.style.translate = "";
        setGroupBounds({ x: left - frame.left, y: top - frame.top, width: right - left, height: bottom - top, frameWidth: frame.width, frameHeight: frame.height, inset });
    }, [selectedResults, selectedLayerIds, viewport, history.present, arranging]);
    const undo = useCallback(() => setHistory((current) => (current.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future] } : current)), []);
    const redo = useCallback(() => setHistory((current) => (current.future.length ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) } : current)), []);
    useEffect(() => {
        if (!historyRequest) return;
        if (historyRequest.action === "undo") undo();
        else redo();
    }, [historyRequest, redo, undo]);
    useEffect(() => onHistoryStateChange?.({ canUndo: history.past.length > 0, canRedo: history.future.length > 0, pastCount: history.past.length }), [history.past.length, history.future.length, onHistoryStateChange]);
    useEffect(() => {
        if (!storageReady) return;
        if (persistenceScope) {
            const value = JSON.stringify(history.present);
            const persist = () => {
                if (lastPersisted.current === value) return;
                lastPersisted.current = value;
                storageWrites.current = storageWrites.current
                    .catch(() => undefined)
                    .then(async () => {
                        const key = `ecommerce-canvas:${storageKey}`;
                        await localForageStorageForScope(persistenceScope).setItem(key, value);
                        if (storageKey.startsWith("shop-canvas:")) window.dispatchEvent(new CustomEvent(SHOP_CANVAS_SNAPSHOT_SAVED, { detail: { scope: persistenceScope, key } }));
                    })
                    .catch(() => {
                        lastPersisted.current = "";
                        message.error({ key: "canvas-save", content: "画布未能保存，请检查本机存储空间" });
                    });
            };
            const timer = setTimeout(persist, 250);
            window.addEventListener("pagehide", persist);
            return () => {
                clearTimeout(timer);
                window.removeEventListener("pagehide", persist);
                if (!drag.current) persist();
            };
        }
        try {
            localStorage.setItem(`ecommerce-canvas:${storageKey}`, JSON.stringify(history.present));
        } catch {
            /* Storage is optional; editing remains available. */
        }
    }, [history.present, storageKey, persistenceScope, storageReady]);
    // 快捷键处理依赖较多实时状态，用 ref 保存最新处理函数，只订阅一次窗口事件。
    const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => keyHandler.current(event);
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    const fitTarget = useCallback((): ViewportTransform => {
        const width = container.current?.clientWidth || 1200;
        const height = container.current?.clientHeight || 700;
        // 只有面板真正悬浮在画布上方时才让出左侧空间（与样式断点一致，不再按画布宽度猜测）。
        const occupied = overlayPanelInset(root.current);
        const inset = occupied ? occupied + 20 : 24;
        root.current?.style.setProperty("--commerce-sidebar-width", `${occupied}px`);
        const rightInset = 24;
        const bounds = commerceCanvasLayout(count, ratio);
        const origin = content.current?.getBoundingClientRect();
        const scale = origin && content.current?.offsetWidth ? origin.width / content.current.offsetWidth : 1;
        const nodes = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-node-id]") || []).map((node) => node.getBoundingClientRect());
        const left = origin && nodes.length ? Math.min(...nodes.map((node) => (node.left - origin.left) / scale)) : 0;
        const top = origin && nodes.length ? Math.min(...nodes.map((node) => (node.top - origin.top) / scale)) : 0;
        const contentWidth = origin && nodes.length ? Math.max(...nodes.map((node) => (node.right - origin.left) / scale)) - left : bounds.width;
        const contentHeight = origin && nodes.length ? Math.max(...nodes.map((node) => (node.bottom - origin.top) / scale)) - top : bounds.height;
        const k = Math.min(1, Math.max(0.05, Math.min((width - inset - rightInset) / Math.max(1, contentWidth), (height - 140) / Math.max(1, contentHeight))));
        return { x: inset + (width - inset - rightInset - contentWidth * k) / 2 - left * k, y: Math.max(80, (height - contentHeight * k) / 2) - top * k, k };
    }, [count, ratio]);
    const fit = useCallback(() => setViewport(fitTarget()), [fitTarget]);
    useEffect(
        () => () => {
            if (imageFitFrame.current !== null) cancelAnimationFrame(imageFitFrame.current);
        },
        [],
    );
    useLayoutEffect(() => {
        fit();
        const observer = new ResizeObserver(fit);
        if (container.current) observer.observe(container.current);
        const sidebar = container.current?.parentElement?.parentElement?.querySelector<HTMLElement>(".flylep-workspace, .sp-canvas-side-panel");
        if (sidebar) observer.observe(sidebar);
        const classObserver = new MutationObserver(fit);
        if (sidebar) classObserver.observe(sidebar, { attributes: true, attributeFilter: ["class"] });
        return () => {
            observer.disconnect();
            classObserver.disconnect();
        };
    }, [fit]);
    /**
     * 底部工具条居中在可见画布里（左侧面板右缘到画布右缘），并夹在面板与右下角图层组之间；
     * 空间不够时退而保证整条留在画布内。画布、面板、工具条或图层组尺寸变化、面板收起展开时重新计算，
     * 不依赖 fitTarget 的副作用，也不受画布按项目重新挂载的影响。
     */
    const placeToolbar = useCallback(() => {
        const section = root.current,
            bar = toolbarRef.current;
        if (!section || !bar) return;
        const width = section.clientWidth;
        const half = bar.offsetWidth / 2;
        const left = overlayPanelInset(section);
        const toggle = layerToggleRef.current;
        const right = toggle?.offsetWidth ? Math.min(width, toggle.offsetLeft - TOOLBAR_GAP) : width - TOOLBAR_EDGE;
        const min = left + TOOLBAR_EDGE + half,
            max = right - half;
        const center = min <= max ? Math.min(max, Math.max(min, (left + width) / 2)) : Math.min(width - TOOLBAR_EDGE - half, Math.max(TOOLBAR_EDGE + half, (left + right) / 2));
        section.style.setProperty("--commerce-toolbar-x", `${Math.round(center)}px`);
    }, []);
    useLayoutEffect(() => {
        const section = root.current;
        if (!section) return;
        placeToolbar();
        const observer = new ResizeObserver(() => placeToolbar());
        observer.observe(section);
        for (const element of [toolbarRef.current, layerToggleRef.current]) if (element) observer.observe(element);
        const panel = section.parentElement?.querySelector<HTMLElement>(".flylep-workspace, .sp-canvas-side-panel");
        const panelClass = new MutationObserver(() => placeToolbar());
        if (panel) {
            observer.observe(panel);
            panelClass.observe(panel, { attributes: true, attributeFilter: ["class"] });
        }
        window.addEventListener("resize", placeToolbar);
        return () => {
            observer.disconnect();
            panelClass.disconnect();
            window.removeEventListener("resize", placeToolbar);
        };
    }, [placeToolbar]);
    const worldPoint = (clientX: number, clientY: number) => {
        const rect = container.current?.getBoundingClientRect();
        return { x: Math.round((clientX - (rect?.left || 0) - viewport.x) / viewport.k), y: Math.round((clientY - (rect?.top || 0) - viewport.y) / viewport.k) };
    };
    /**
     * 框选：拖动时实时高亮命中的图片（直接改 DOM 属性，不触发页面重渲染），松开后一次性提交选择。
     * Shift 追加、Ctrl/⌘ 反选、Alt 减选，与主画布一致；Esc 取消本次框选并保留原选择。
     */
    const startMarquee = (event: PointerEvent<HTMLDivElement>) => {
        const frame = container.current?.getBoundingClientRect();
        if (!frame) return;
        // 画布获得焦点后 V/H/T、Ctrl+A、方向键等快捷键才会生效。
        root.current?.focus({ preventScroll: true });
        const startX = event.clientX,
            startY = event.clientY,
            pointerId = event.pointerId;
        const strategy = resolveCanvasSelectionStrategy(event);
        const base = new Set(selectedResults);
        const baseLayers = new Set(selectedLayerIds);
        const ready = new Set(resultLayers.filter((item) => item.ready).map((item) => item.id));
        const resultCandidates = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]") || [])
            .filter((node) => ready.has(node.dataset.ecommerceImageId || ""))
            .map((node) => ({ node, id: node.dataset.ecommerceImageId!, kind: "result" as const, rect: node.getBoundingClientRect() }));
        const ordinaryIds = new Set(history.present.filter((layer) => layer.type !== "result").map((layer) => layer.id));
        const ordinaryCandidates = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-node-id]") || [])
            .filter((node) => ordinaryIds.has(node.dataset.nodeId || ""))
            .map((node) => ({ node, id: node.dataset.nodeId!, kind: "layer" as const, rect: node.getBoundingClientRect() }));
        const candidates = [...resultCandidates, ...ordinaryCandidates];
        let latest = { x: startX, y: startY };
        const hits = () => {
            const left = Math.min(startX, latest.x),
                right = Math.max(startX, latest.x),
                top = Math.min(startY, latest.y),
                bottom = Math.max(startY, latest.y);
            return new Set(candidates.filter(({ rect }) => rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top).map(({ id }) => id));
        };
        const combine = (hit: Set<string>) => {
            const current = new Set([...base, ...baseLayers]);
            if (strategy === "add") return new Set([...current, ...hit]);
            if (strategy === "subtract") return new Set([...current].filter((id) => !hit.has(id)));
            if (strategy === "toggle") return new Set([...[...current].filter((id) => !hit.has(id)), ...[...hit].filter((id) => !current.has(id))]);
            return hit;
        };
        const publish = (next: Set<string>) => {
            const resultIds = Array.from(next).filter((id) => resultCandidates.some((candidate) => candidate.id === id));
            const layerIds = Array.from(next).filter((id) => ordinaryCandidates.some((candidate) => candidate.id === id));
            setSelectedLayerIds(new Set(layerIds));
            setSelectedId(layerIds.length === 1 ? layerIds[0] : null);
            onSelectResults?.(resultIds);
            onSelectLayers?.(layerIds);
        };
        const paint = () => {
            marqueeFrame.current = null;
            setSelectionBox({ x: Math.min(startX, latest.x) - frame.left, y: Math.min(startY, latest.y) - frame.top, width: Math.abs(latest.x - startX), height: Math.abs(latest.y - startY) });
            const next = combine(hits());
            for (const { node, id } of candidates) node.toggleAttribute("data-marquee-hit", next.has(id));
        };
        const finish = (apply: boolean) => {
            selectionCleanup.current?.();
            selectionCleanup.current = null;
            if (marqueeFrame.current !== null) {
                cancelAnimationFrame(marqueeFrame.current);
                marqueeFrame.current = null;
            }
            for (const { node } of candidates) node.removeAttribute("data-marquee-hit");
            setSelectionBox(null);
            if (!apply) return;
            if (Math.abs(latest.x - startX) < 5 && Math.abs(latest.y - startY) < 5) {
                if (strategy === "replace") publish(new Set());
                return;
            }
            publish(combine(hits()));
        };
        const move = (pointer: globalThis.PointerEvent) => {
            if (pointer.pointerId !== pointerId) return;
            latest = { x: pointer.clientX, y: pointer.clientY };
            if (marqueeFrame.current === null) marqueeFrame.current = requestAnimationFrame(paint);
        };
        const end = (pointer: globalThis.PointerEvent) => {
            if (pointer.pointerId !== pointerId) return;
            latest = { x: pointer.clientX, y: pointer.clientY };
            finish(pointer.type === "pointerup");
        };
        const cancel = (key: KeyboardEvent) => {
            if (key.key === "Escape") {
                key.preventDefault();
                finish(false);
            }
        };
        selectionCleanup.current?.();
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("keydown", cancel);
        selectionCleanup.current = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            window.removeEventListener("keydown", cancel);
        };
    };
    const addText = (event: PointerEvent<HTMLDivElement>) => {
        if (tool !== "text") {
            setSelectedId(null);
            setSelectedLayerIds(new Set());
            onSelectLayers?.([]);
            if (tool === "select") startMarquee(event);
            return;
        }
        const point = worldPoint(event.clientX, event.clientY);
        const id = createClientUUID();
        commit([...history.present, { id, type: "text", ...point, text: pendingText.current || "电商 Agent", ...pendingTextStyle.current }]);
        pendingText.current = "电商 Agent";
        setSelectedId(id);
        setSelectedLayerIds(new Set([id]));
        onSelectLayers?.([id]);
        onSelectResults?.([]);
        setTool("select");
    };
    const uploadMedia = async (files: FileList | null) => {
        if (!files?.length || uploading) return;
        setUploading(true);
        setUploadError("");
        try {
            const resources = await Promise.all(Array.from(files).map((file) => uploadResourceFile(file, file.type.startsWith("video/") ? "video" : "image", { fileName: file.name })));
            const rect = container.current?.getBoundingClientRect();
            const point = worldPoint((rect?.left || 0) + (rect?.width || 1000) / 2, (rect?.top || 0) + (rect?.height || 700) / 2);
            commit([
                ...history.present,
                ...resources.map((resource, index) => ({ id: createClientUUID(), type: resource.kind === "video" ? ("video" as const) : ("image" as const), x: point.x + index * 28, y: point.y + index * 28, resourceId: resource.id })),
            ]);
            setTool("select");
        } catch (cause) {
            setUploadError(cause instanceof Error ? cause.message : "图片上传失败，请重试");
        } finally {
            setUploading(false);
        }
    };
    const startImageResize = (event: PointerEvent<HTMLButtonElement>, layer: CanvasLayer, handle: ShopImageResizeHandle) => {
        if (event.button !== 0 || tool !== "select") return;
        event.preventDefault();
        event.stopPropagation();
        const node = event.currentTarget.closest<HTMLElement>("[data-node-id]");
        if (!node || !node.offsetWidth || !node.offsetHeight) return;
        const box = { x: layer.x, y: layer.y, width: node.offsetWidth, height: node.offsetHeight };
        const visibleHandle = handle.replace(/[we]/g, (edge) => (layer.flipX ? (edge === "w" ? "e" : "w") : edge)).replace(/[ns]/g, (edge) => (layer.flipY ? (edge === "n" ? "s" : "n") : edge)) as ShopImageResizeHandle;
        const start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, zoom: viewport.k };
        const before = history.present;
        let changed = false;
        const move = (pointer: globalThis.PointerEvent) => {
            if (pointer.pointerId !== start.pointerId) return;
            const dx = (pointer.clientX - start.x) / start.zoom;
            const dy = (pointer.clientY - start.y) / start.zoom;
            if (!changed && Math.hypot(dx, dy) * start.zoom < 2) return;
            changed = true;
            const next = resizeShopImage(box, visibleHandle, dx, dy);
            setHistory((current) => ({ ...current, present: current.present.map((item) => (item.id === layer.id ? { ...item, ...next } : item)) }));
        };
        const finish = (save: boolean) => {
            selectionCleanup.current?.();
            selectionCleanup.current = null;
            if (!changed) return;
            setHistory((current) =>
                save
                    ? { past: [...current.past.slice(-39), before], present: current.present, future: [] }
                    : { ...current, present: current.present.map((item) => (item.id === layer.id ? { ...item, x: layer.x, y: layer.y, width: layer.width, height: layer.height } : item)) },
            );
        };
        const end = (pointer: globalThis.PointerEvent) => {
            if (pointer.pointerId === start.pointerId) finish(pointer.type === "pointerup");
        };
        const cancel = (key: KeyboardEvent) => {
            if (key.key !== "Escape") return;
            key.preventDefault();
            key.stopImmediatePropagation();
            finish(false);
        };
        selectionCleanup.current?.();
        event.currentTarget.setPointerCapture(event.pointerId);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("keydown", cancel, true);
        selectionCleanup.current = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            window.removeEventListener("keydown", cancel, true);
        };
    };
    const startDrag = (event: PointerEvent<HTMLElement>, layer: CanvasLayer, groupId?: string) => {
        if (event.button !== 0 || tool !== "select" || editingId) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const group = graphEnabled && groupId ? history.present.filter((node) => node.groupId === groupId).map((node) => node.id) : [layer.id];
        const moving = groupId && content.current ? Array.from(content.current.querySelectorAll<HTMLElement>("[data-node-id]")).filter((node) => group.includes(node.dataset.nodeId!)) : [event.currentTarget];
        // 按下时记录其他元素的位置，拖动中据此吸附对齐。
        drag.current = {
            id: layer.id,
            groupId: graphEnabled ? groupId : undefined,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            layerX: layer.x,
            layerY: layer.y,
            before: history.present,
            snap: content.current ? measureCommerceSnapScene(content.current, moving, viewport.k) : null,
        };
        setSelectedId(group.length === 1 ? layer.id : null);
        setSelectedLayerIds(new Set(group));
        onSelectLayers?.(group);
        onSelectResults?.([]);
    };
    const moveDrag = (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const dx = (event.clientX - current.startX) / viewport.k;
        const dy = (event.clientY - current.startY) / viewport.k;
        if (Math.hypot(dx, dy) * viewport.k < 4) return;
        current.moved = true;
        // 按住 Ctrl/⌘ 拖动时暂时关闭吸附。
        const snapped = current.snap?.moving && !event.ctrlKey && !event.metaKey ? snapCommerceMove(current.snap.moving, dx, dy, current.snap.targets, COMMERCE_SNAP_THRESHOLD / viewport.k) : { dx, dy, guides: [] };
        paintCommerceSnapGuides(guideLayer.current, snapped.guides, viewport.k);
        const x = gridSnap ? Math.round((current.layerX + snapped.dx) / 20) * 20 : Math.round(current.layerX + snapped.dx);
        const y = gridSnap ? Math.round((current.layerY + snapped.dy) / 20) * 20 : Math.round(current.layerY + snapped.dy);
        setHistory((state) => ({
            ...state,
            present: state.present.map((item) => {
                if (item.id === current.id) return { ...item, x, y };
                if (current.groupId && item.groupId === current.groupId) {
                    const before = current.before.find((n) => n.id === item.id)!;
                    return { ...item, x: before.x + x - current.layerX, y: before.y + y - current.layerY };
                }
                return item;
            }),
        }));
    };
    const endDrag = (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        drag.current = null;
        if (graphEnabled && event.type === "pointerup" && !current.moved && !current.groupId && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) {
            const node = history.present.find((n) => n.id === current.id);
            setSelectedId(current.id);
            setSelectedLayerIds(new Set([current.id]));
            onSelectLayers?.([current.id]);
            if (node) openNode(node);
        }
        paintCommerceSnapGuides(guideLayer.current, [], viewport.k);
        setHistory((state) => (state.present.some((item) => item.id === current.id && (item.x !== current.layerX || item.y !== current.layerY)) ? { past: [...state.past.slice(-39), current.before], present: state.present, future: [] } : state));
    };
    const finishEdit = () => {
        if (!editingId) return;
        const next = history.present.map((item) => (item.id === editingId ? { ...item, text: editingText.trim() || "电商 Agent" } : item));
        if (next.some((item, index) => item.text !== history.present[index]?.text)) commit(next);
        setEditingId(null);
    };
    const handleCanvasContextMenu = (event: MouseEvent) => {
        if (!onCanvasContextMenu) return;
        event.preventDefault();
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-node-id],[data-ecommerce-image-id]") : null;
        if (target?.dataset.nodeId) {
            const layer = history.present.find((item) => item.id === target.dataset.nodeId && item.type !== "result");
            if (layer) {
                // Keep a marquee selection when the context menu is opened on one
                // of its members. This is what makes "download/arrange/delete
                // selection" useful after the user frame-selects nodes. A right
                // click on an unselected node still switches to that single node.
                const keepSelection = selectedLayerIds.has(layer.id) && selectedLayerIds.size > 1;
                const ids = keepSelection ? Array.from(selectedLayerIds) : [layer.id];
                setSelectedId(ids.length === 1 ? layer.id : null);
                setSelectedLayerIds(new Set(ids));
                onSelectLayers?.(ids);
                onSelectResults?.([]);
                onCanvasContextMenu(event, { id: layer.id, type: layer.type });
                return;
            }
        }
        if (target?.dataset.ecommerceImageId) {
            onCanvasContextMenu(event, { id: target.dataset.ecommerceImageId, type: "result" });
            return;
        }
        onCanvasContextMenu(event);
    };
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const flight = useRef<number | null>(null);
    useEffect(
        () => () => {
            if (flight.current !== null) cancelAnimationFrame(flight.current);
        },
        [],
    );
    /**
     * 平滑飞行到目标视口：位置与缩放同步插值，缩放在对数空间插值（视觉上匀速），
     * 远距离时先略微拉远再推近，路径连贯不跳帧。用户中途拖动/缩放会立即接管。
     */
    const flyTo = useCallback(
        (target: ViewportTransform, quick = false) => {
            if (flight.current !== null) cancelAnimationFrame(flight.current);
            const from = viewportRef.current;
            if (reducedMotion) {
                setViewport(target);
                return;
            }
            const frame = container.current?.getBoundingClientRect();
            const span = Math.hypot(target.x - from.x, target.y - from.y) / Math.max(1, Math.hypot(frame?.width || 1200, frame?.height || 800));
            // 缩放按钮/快捷键使用短促的直接过渡，不做先拉远再推近。
            const dip = quick ? 0 : Math.min(0.28, span * 0.35);
            const duration = quick ? 240 : Math.min(820, 460 + span * 260);
            const start = performance.now();
            const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
            const step = (now: number) => {
                const t = Math.min(1, (now - start) / duration);
                const e = ease(t);
                const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e) * (1 - dip * Math.sin(Math.PI * e));
                // 屏幕中心对应的世界点按 e 插值，保证缩放过程中目标始终朝中心移动。
                const cx = (frame?.width || 1200) / 2,
                    cy = (frame?.height || 800) / 2;
                const wx0 = (cx - from.x) / from.k,
                    wy0 = (cy - from.y) / from.k;
                const wx1 = (cx - target.x) / target.k,
                    wy1 = (cy - target.y) / target.k;
                const wx = wx0 + (wx1 - wx0) * e,
                    wy = wy0 + (wy1 - wy0) * e;
                setViewport(t >= 1 ? target : { k, x: cx - wx * k, y: cy - wy * k });
                flight.current = t < 1 ? requestAnimationFrame(step) : null;
            };
            flight.current = requestAnimationFrame(step);
        },
        [reducedMotion],
    );
    const userNavigate = useCallback(
        (next: ViewportTransform) => {
            if (flight.current !== null) {
                cancelAnimationFrame(flight.current);
                flight.current = null;
            }
            navigateViewport(next);
        },
        [navigateViewport],
    );
    /** 以可见画布区域（扣除左侧 Agent 面板）的中心为锚点缩放。 */
    const zoomTo = (resolve: (k: number) => number) => {
        const frame = container.current?.getBoundingClientRect();
        if (!frame) return;
        const current = viewportRef.current;
        const k = clampZoom(resolve(current.k));
        if (Math.abs(k - current.k) < 0.001) return;
        const inset = Number.parseFloat(root.current?.style.getPropertyValue("--commerce-sidebar-width") || "") || 0;
        const cx = (inset + frame.width) / 2,
            cy = frame.height / 2;
        const wx = (cx - current.x) / current.k,
            wy = (cy - current.y) / current.k;
        manuallyNavigated.current = true;
        flyTo({ k, x: cx - wx * k, y: cy - wy * k }, true);
    };
    const zoomIn = () => zoomTo((k) => ZOOM_STOPS.find((stop) => stop > k * 1.01) ?? 2);
    const zoomOut = () => zoomTo((k) => [...ZOOM_STOPS].reverse().find((stop) => stop < k * 0.99) ?? 0.05);
    const zoomReset = () => zoomTo(() => 1);
    /** 手动“适应画布”后恢复自动适配，新图片载入时继续保持全部可见。 */
    const fitAll = () => {
        manuallyNavigated.current = false;
        flyTo(fitTarget());
    };
    const animateLayout = () => {
        if (reducedMotion) return;
        if (arrangeTimer.current !== null) window.clearTimeout(arrangeTimer.current);
        setArranging(true);
        arrangeTimer.current = window.setTimeout(() => {
            arrangeTimer.current = null;
            setArranging(false);
        }, ARRANGE_MOTION_MS);
    };
    const resultOffsets = () => new Map(history.present.filter((item) => item.type === "result").map((item) => [item.id, item]));
    const commitResultOffsets = (positions: Array<{ id: string; x: number; y: number }>) => {
        const moved = new Set(positions.map((item) => item.id));
        commit([...history.present.filter((item) => item.type !== "result" || !moved.has(item.id)), ...positions.map((item) => ({ ...item, type: "result" as const }))]);
    };
    /**
     * 读取选中图片当前的世界坐标框（含已有偏移），计算排布结果后换算回“相对默认套版的偏移量”，
     * 作为一步可撤销操作提交；节点以过渡动画移动到新位置。
     */
    const arrangeSelection = (action: CommerceArrangeAction) => {
        const world = content.current;
        if (!world) return;
        const origin = world.getBoundingClientRect();
        const scale = world.offsetWidth ? origin.width / world.offsetWidth : 1;
        const saved = resultOffsets();
        const boxes = Array.from(world.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]"))
            .filter((node) => selectedResults.has(node.dataset.ecommerceImageId || ""))
            .map((node) => {
                const rect = node.getBoundingClientRect();
                const id = node.dataset.ecommerceImageId!;
                return {
                    id,
                    x: Math.round((rect.left - origin.left) / scale),
                    y: Math.round((rect.top - origin.top) / scale),
                    width: Math.round(rect.width / scale),
                    height: Math.round(rect.height / scale),
                    offsetX: saved.get(id)?.x || 0,
                    offsetY: saved.get(id)?.y || 0,
                };
            });
        if (!boxes.length) return;
        const byId = new Map(boxes.map((box) => [box.id, box]));
        const positions =
            action === "reset"
                ? boxes.map(({ id }) => ({ id, x: 0, y: 0 }))
                : arrangeCommerceBoxes(boxes, action).map((point) => {
                      const box = byId.get(point.id)!;
                      return { id: point.id, x: Math.round(box.offsetX + point.x - box.x), y: Math.round(box.offsetY + point.y - box.y) };
                  });
        if (
            positions.every((point) => {
                const box = byId.get(point.id)!;
                return Math.abs(point.x - box.offsetX) < 0.5 && Math.abs(point.y - box.offsetY) < 0.5;
            })
        )
            return;
        animateLayout();
        commitResultOffsets(positions);
    };
    /** 方向键微移：优先移动选中的文字/上传图层，否则移动选中的生成图片。 */
    const nudgeSelection = (dx: number, dy: number) => {
        if (selectedId) {
            commit(history.present.map((item) => (item.id === selectedId ? { ...item, x: item.x + dx, y: item.y + dy } : item)));
            return true;
        }
        const mounted = new Set(Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]") || []).map((node) => node.dataset.ecommerceImageId || ""));
        const ids = Array.from(selectedResults).filter((id) => mounted.has(id));
        if (!ids.length) return false;
        const saved = resultOffsets();
        commitResultOffsets(ids.map((id) => ({ id, x: (saved.get(id)?.x || 0) + dx, y: (saved.get(id)?.y || 0) + dy })));
        return true;
    };
    const selectAllReady = () => {
        const ids = resultLayers.filter((item) => item.ready).map((item) => item.id);
        const layerIds = onSelectLayers ? history.present.filter((item) => item.type !== "result").map((item) => item.id) : [];
        if (!ids.length && !layerIds.length) return;
        setSelectedId(null);
        setSelectedLayerIds(new Set(layerIds));
        onSelectLayers?.(layerIds);
        onSelectResults?.(ids);
    };
    keyHandler.current = (event: KeyboardEvent) => {
        if (!root.current?.contains(document.activeElement) || (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]"))) return;
        const command = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (command && key === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
        } else if (command && key === "y") {
            event.preventDefault();
            redo();
        } else if (command && key === "a") {
            event.preventDefault();
            selectAllReady();
        } else if (command && !event.altKey && (key === "=" || key === "+")) {
            event.preventDefault();
            zoomIn();
        } else if (command && !event.altKey && key === "-") {
            event.preventDefault();
            zoomOut();
        } else if (command && !event.altKey && key === "0") {
            event.preventDefault();
            zoomReset();
        } else if (event.shiftKey && !command && !event.altKey && event.code === "Digit1") {
            event.preventDefault();
            fitAll();
        } else if (!command && !event.altKey && ["v", "h", "t"].includes(key)) {
            event.preventDefault();
            setTool(({ v: "select", h: "hand", t: "text" } as const)[key as "v" | "h" | "t"]);
        }
        // 框选进行中的 Esc 只取消框选，由框选自身处理。
        else if (event.key === "Escape" && !selectionCleanup.current && (selectedResults.size || selectedLayerIds.size || selectedId)) {
            setSelectedId(null);
            setSelectedLayerIds(new Set());
            onSelectLayers?.([]);
            onSelectResults?.([]);
        } else if (event.key.startsWith("Arrow") && !command && !event.altKey && !(event.target instanceof Element && event.target.closest("[role=slider],[role=listbox],[role=menu],[role=combobox],[role=tablist]"))) {
            const step = event.shiftKey ? 10 : 1;
            const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
            const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
            if ((dx || dy) && nudgeSelection(dx, dy)) event.preventDefault();
        } else if (event.key === "Delete" || event.key === "Backspace") {
            const ids = selectedLayerIds.size ? selectedLayerIds : selectedId ? new Set([selectedId]) : new Set<string>();
            if (!ids.size) return;
            event.preventDefault();
            commit(history.present.filter((item) => !ids.has(item.id)).map((item) => ({ ...item, inputs: item.inputs?.filter((id) => !ids.has(id)), managedInputIds: item.managedInputIds?.filter((id) => !ids.has(id)) })));
            setSelectedId(null);
            setSelectedLayerIds(new Set());
            onSelectLayers?.([]);
        }
    };
    /** 图层单击：只选中这一张，放大并定位到画布中的位置，到达后轻微高亮。 */
    const focusResult = (id: string) => {
        const target = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]") || []).find((item) => item.dataset.ecommerceImageId === id);
        const frame = container.current?.getBoundingClientRect();
        if (!target || !frame) return;
        setSelectedLayerIds(new Set());
        onSelectLayers?.([]);
        onSelectResults?.([id]);
        onInspectResult?.(id);
        manuallyNavigated.current = true;
        const current = viewportRef.current;
        const rect = target.getBoundingClientRect();
        const world = { x: (rect.left - frame.left - current.x) / current.k, y: (rect.top - frame.top - current.y) / current.k, width: rect.width / current.k, height: rect.height / current.k };
        const occupied = overlayPanelInset(root.current);
        const usableLeft = occupied ? occupied + 18 : 12;
        const usableRight = frame.width - (layersOpen && frame.width > 1100 ? 300 : 12);
        const usableTop = 72,
            usableBottom = frame.height - 96;
        const k = Math.max(0.1, Math.min(1.6, ((usableRight - usableLeft) * 0.82) / world.width, ((usableBottom - usableTop) * 0.86) / world.height));
        const centerX = (usableLeft + usableRight) / 2,
            centerY = (usableTop + usableBottom) / 2;
        flyTo({ k, x: centerX - (world.x + world.width / 2) * k, y: centerY - (world.y + world.height / 2) * k });
        target.classList.remove("is-located");
        window.setTimeout(
            () => {
                target.classList.add("is-located");
                window.setTimeout(() => target.classList.remove("is-located"), 1300);
            },
            reducedMotion ? 0 : 520,
        );
    };
    const toolIcon = (name: string, fallback: ReactNode, size = 19) => (graphEnabled ? <ShopCanvasGlyph name={name} size={size} /> : fallback);
    const toolButton = (label: string, hint: string, shortcut: string, icon: ReactNode, action: () => void, active = false, disabled = false) => (
        <Tooltip
            key={label}
            title={
                <span className="commerce-tool-hint">
                    <span>{hint}</span>
                    {shortcut ? <kbd>{shortcut}</kbd> : null}
                </span>
            }
            placement="top"
            mouseEnterDelay={graphEnabled ? 0.22 : 0.12}
            trigger={["hover", "focus"]}
            classNames={graphEnabled ? { root: "sp-canvas-tooltip ms-scope", container: "sp-canvas-tooltip-panel" } : undefined}
        >
            <button type="button" aria-label={label} aria-pressed={["选择", "抓手", "输入文字"].includes(label) ? active : undefined} className={active ? "is-active" : ""} disabled={disabled} onClick={action}>
                {active ? <motion.span className="commerce-canvas-tool-active" layoutId={reducedMotion ? undefined : "commerce-canvas-tool"} transition={{ type: "spring", stiffness: 440, damping: 34 }} aria-hidden="true" /> : null}
                {icon}
            </button>
        </Tooltip>
    );
    const viewportButton = (label: string, hint: string, icon: string, onClick: () => void, pressed?: boolean) => (
        <Tooltip title={hint} trigger={["hover", "focus"]} placement="top" mouseEnterDelay={0.22} classNames={{ root: "sp-canvas-tooltip ms-scope", container: "sp-canvas-tooltip-panel" }}>
            <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}>
                <ShopCanvasGlyph name={icon} size={17} />
            </button>
        </Tooltip>
    );
    const mapNodes = history.present.filter((item) => item.type !== "result");
    const frameWidth = container.current?.clientWidth || 1200;
    const frameHeight = container.current?.clientHeight || 700;
    const visibleWorld = { left: -viewport.x / viewport.k, top: -viewport.y / viewport.k, right: (frameWidth - viewport.x) / viewport.k, bottom: (frameHeight - viewport.y) / viewport.k };
    const mapBounds = {
        left: Math.min(visibleWorld.left, ...mapNodes.map((item) => item.x - 80)),
        top: Math.min(visibleWorld.top, ...mapNodes.map((item) => item.y - 60)),
        right: Math.max(visibleWorld.right, ...mapNodes.map((item) => item.x + 280)),
        bottom: Math.max(visibleWorld.bottom, ...mapNodes.map((item) => item.y + 200)),
    };
    const mapX = (value: number) => `${((value - mapBounds.left) / Math.max(1, mapBounds.right - mapBounds.left)) * 100}%`;
    const mapY = (value: number) => `${((value - mapBounds.top) / Math.max(1, mapBounds.bottom - mapBounds.top)) * 100}%`;
    const openNode = (layer: CanvasLayer) => {
        if (layer.type === "generation") {
            onInspectGeneration?.(layer);
            return;
        }
        if (layer.type !== "draft" && !isCompletedVideoNode(layer)) return;
        onOpenDraft?.(
            layer.id,
            layer.draftKind || (isCompletedVideoNode(layer) ? (layer.videoProjectId ? "video-replace" : "product-video") : "chat"),
            commerceNodeReferences(
                history.present.map((node) => ({ ...node, resourceId: node.resourceId || generations.find((g) => g.key === node.generationKey)?.resourceId })),
                layer.id,
            ),
            layer.config,
            layer,
        );
    };
    const uploadToNode = async (nodeId: string, file?: File) => {
        if (!file) return;
        try {
            const resource = await uploadResourceFile(file, file.type.startsWith("video/") ? "video" : "image", { fileName: file.name });
            setHistory((current) => ({
                past: [...current.past.slice(-39), current.present],
                present: current.present.map((n) => (n.id === nodeId ? { ...n, type: resource.kind === "video" ? "video" : "image", text: file.name, resourceId: resource.id } : n)),
                future: [],
            }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败，请重试");
        }
    };
    const connectionEndpoint = (node: CanvasLayer, side: "input" | "output") => {
        const size = graphSizes.current.get(node.id);
        return { x: node.x + (side === "output" ? size?.width || 240 : 0), y: node.y + (size?.height || 240) / 2 };
    };
    const attachConnection = (source: string, target: string) => {
        const result = connectCommerceNodes(history.present, source, target);
        if (result.error) message.info(result.error);
        else commit(result.nodes);
        setConnecting(null);
    };
    useEffect(() => {
        if (!connecting) return;
        const source = history.present.find((n) => n.id === connecting);
        if (!source) {
            setConnecting(null);
            return;
        }
        const move = (event: globalThis.PointerEvent) => {
            const origin = connectionEndpoint(source, connectionSide.current);
            const pointer = worldPoint(event.clientX, event.clientY);
            connectionPreview.current?.setAttribute("d", connectionSide.current === "output" ? commerceConnectionPath(origin, pointer) : commerceConnectionPath(pointer, origin));
        };
        const end = (event: globalThis.PointerEvent) => {
            const target = document.elementFromPoint(event.clientX, event.clientY);
            const port = target?.closest<HTMLElement>(connectionSide.current === "output" ? "[data-shop-input]" : "[data-shop-output]");
            const id = connectionSide.current === "output" ? port?.dataset.shopInput : port?.dataset.shopOutput;
            if (id && id !== connecting) {
                attachConnection(connectionSide.current === "output" ? connecting : id, connectionSide.current === "output" ? id : connecting);
                return;
            }
            if (Math.hypot(event.clientX - connectionStart.current.x, event.clientY - connectionStart.current.y) < 6) return;
            if (!target?.closest("[data-node-id], [data-canvas-no-zoom]")) onConnectionDrop?.({ x: event.clientX, y: event.clientY, connection: { nodeId: connecting, side: connectionSide.current } });
            setConnecting(null);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setConnecting(null);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", end);
        const cancel = () => setConnecting(null);
        document.addEventListener("pointercancel", cancel);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", end);
            document.removeEventListener("pointercancel", cancel);
            document.removeEventListener("keydown", escape);
        };
    }, [connecting, history.present, viewport]);
    const groupIds = graphEnabled ? [...new Set(history.present.map((n) => n.groupId).filter(Boolean))] : [];
    const noVisibleNodes = mapNodes.length > 0 && mapNodes.every((item) => item.x + 280 < visibleWorld.left || item.x - 80 > visibleWorld.right || item.y + 200 < visibleWorld.top || item.y - 60 > visibleWorld.bottom);
    return (
        <section ref={root} tabIndex={-1} className="commerce-result-canvas" data-connecting={Boolean(connecting) || undefined} data-layers-open={layersOpen} data-canvas-tool={tool} data-arranging={arranging || undefined} aria-label="商品图片画布">
            <CanvasViewport containerRef={container} viewport={viewport} onViewportChange={userNavigate} boxSelectEnabled={tool !== "hand"} panOverNodes={tool === "hand"} onCanvasMouseDown={addText} onContextMenu={handleCanvasContextMenu}>
                <div
                    ref={content}
                    className="commerce-canvas-results"
                    {...resultDrag}
                    onLoadCapture={(event) => {
                        if (!(event.target instanceof HTMLImageElement) || !event.target.closest(".commerce-result-image-shell")) return;
                        if (imageFitFrame.current !== null) cancelAnimationFrame(imageFitFrame.current);
                        imageFitFrame.current = requestAnimationFrame(() => {
                            imageFitFrame.current = null;
                            if (!manuallyNavigated.current) fit();
                        });
                    }}
                    style={{ width: layout.width, "--commerce-columns": layout.columns, position: "relative" } as CSSProperties}
                >
                    {children}
                    {graphEnabled ? (
                        <>
                            {groupIds.map((id) => {
                                const nodes = history.present.filter((n) => n.groupId === id);
                                const left = Math.min(...nodes.map((n) => n.x)) - 24,
                                    top = Math.min(...nodes.map((n) => n.y)) - 64;
                                const right = Math.max(...nodes.map((n) => n.x + (graphSizes.current.get(n.id)?.width || 240))) + 24,
                                    bottom = Math.max(...nodes.map((n) => n.y + (graphSizes.current.get(n.id)?.height || 260))) + 24;
                                return (
                                    <div key={id} className="sp-node-group" style={{ left, top, width: right - left, height: bottom - top }}>
                                        <button
                                            type="button"
                                            className="sp-node-group-handle"
                                            data-canvas-no-zoom
                                            aria-label="移动整个分组"
                                            title="拖动标题移动整组，拖动节点单独调整"
                                            onPointerDown={(event) => startDrag(event, nodes[0], id)}
                                            onPointerMove={moveDrag}
                                            onPointerUp={endDrag}
                                            onPointerCancel={endDrag}
                                            onLostPointerCapture={endDrag}
                                            onClick={(event) => {
                                                if (event.detail !== 0) return;
                                                const ids = nodes.map((node) => node.id);
                                                setSelectedId(null);
                                                setSelectedLayerIds(new Set(ids));
                                                onSelectLayers?.(ids);
                                                onSelectResults?.([]);
                                            }}
                                        >
                                            <ShopCanvasGlyph name="group" size={15} />
                                            节点分组
                                        </button>
                                    </div>
                                );
                            })}
                            <svg className="sp-node-connections" aria-label="节点连接">
                                {history.present.flatMap((target) =>
                                    (target.inputs || []).map((sourceId) => {
                                        const source = history.present.find((n) => n.id === sourceId);
                                        if (!source) return null;
                                        const path = commerceConnectionPath(connectionEndpoint(source, "output"), connectionEndpoint(target, "input"));
                                        const running = source.type === "generation" && generations.some((g) => g.key === source.generationKey && g.status === "running");
                                        return (
                                            <g key={sourceId + target.id} className={running ? "is-running" : ""} data-selected={(selectedEdge?.source === sourceId && selectedEdge.target === target.id) || undefined}>
                                                <path className="sp-connection-line" d={path} />
                                                <path className="sp-connection-shimmer" d={path} />
                                                <path
                                                    className="sp-connection-hit"
                                                    d={path}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label="选择连接线"
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedEdge({ source: sourceId, target: target.id });
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") setSelectedEdge({ source: sourceId, target: target.id });
                                                    }}
                                                >
                                                    <title>点击管理连接 · 上游素材传入下游节点</title>
                                                </path>
                                            </g>
                                        );
                                    }),
                                )}
                                {connecting ? <path ref={connectionPreview} className="sp-connection-line is-preview" /> : null}
                            </svg>
                        </>
                    ) : null}
                    {history.present
                        .filter((layer) => layer.type !== "result")
                        .map((layer) => (
                            <div
                                key={layer.id}
                                data-node-id={layer.id}
                                data-shop-node={graphEnabled ? layer.type : undefined}
                                data-generated-reference={layer.generatedReference || undefined}
                                data-normal-video={(graphEnabled && layer.type === "draft" && layer.draftKind === "product-video") || undefined}
                                data-annotation={layer.annotation || undefined}
                                data-media-sized={graphEnabled && layer.width && layer.height ? true : undefined}
                                tabIndex={graphEnabled && ((layer.type === "draft" && layer.draftKind !== "upload-card") || layer.type === "generation" || isCompletedVideoNode(layer)) ? 0 : undefined}
                                aria-label={layer.type === "generation" || isCompletedVideoNode(layer) ? `${layer.text || (layer.type === "video" ? "生成视频" : "生成图片")}，查看生成配置` : undefined}
                                className={`commerce-canvas-layer${selectedLayerIds.has(layer.id) ? " is-selected" : ""}`}
                                style={{
                                    left: layer.x,
                                    top: layer.y,
                                    ...(graphEnabled && layer.width && layer.height ? { width: layer.width, height: layer.height } : {}),
                                    transform: `scaleX(${layer.flipX ? -1 : 1}) scaleY(${layer.flipY ? -1 : 1})`,
                                    ...(layer.type === "draft" && layer.draftKind === "product-video" ? { ["--sp-video-node-ratio" as string]: aspectRatioOf(layer.normalVideoDraft?.ratio) || 16 / 9 } : {}),
                                    ...(layer.type === "text"
                                        ? {
                                              fontFamily: layer.fontFamily,
                                              fontSize: layer.fontSize ? `${layer.fontSize}px` : undefined,
                                              color: layer.color,
                                              fontWeight: layer.fontWeight,
                                              fontStyle: layer.italic ? "italic" : undefined,
                                              textAlign: layer.textAlign,
                                              letterSpacing: layer.letterSpacing,
                                              lineHeight: layer.lineHeight,
                                          }
                                        : {}),
                                }}
                                onContextMenu={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const keepSelection = selectedLayerIds.has(layer.id) && selectedLayerIds.size > 1;
                                    const ids = keepSelection ? Array.from(selectedLayerIds) : [layer.id];
                                    setSelectedId(ids.length === 1 ? layer.id : null);
                                    setSelectedLayerIds(new Set(ids));
                                    onSelectLayers?.(ids);
                                    onSelectResults?.([]);
                                    onCanvasContextMenu?.(event, { id: layer.id, type: layer.type });
                                }}
                                onPointerDown={(event) => startDrag(event, layer)}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                                onLostPointerCapture={endDrag}
                                onKeyDown={(event) => {
                                    if (!graphEnabled || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ") || (layer.type !== "draft" && layer.type !== "generation" && !isCompletedVideoNode(layer))) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setSelectedId(layer.id);
                                    setSelectedLayerIds(new Set([layer.id]));
                                    onSelectLayers?.([layer.id]);
                                    openNode(layer);
                                }}
                                onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    if (!graphEnabled && layer.type === "draft") openNode(layer);
                                    if (layer.type === "text") {
                                        setEditingId(layer.id);
                                        setEditingText(layer.text || "电商 Agent");
                                    }
                                }}
                            >
                                {graphEnabled && selectedId === layer.id && (layer.type === "image" || (layer.type === "generation" && (layer.resourceId || generations.some((item) => item.key === layer.generationKey && item.resourceId)))) ? (
                                    <div className="sp-node-resize-handles" data-canvas-no-zoom>
                                        {SHOP_IMAGE_RESIZE_HANDLES.map((handle) => (
                                            <button
                                                key={handle}
                                                type="button"
                                                className={`sp-node-resize-handle is-${handle}`}
                                                aria-label={`等比缩放图片 ${handle}`}
                                                tabIndex={-1}
                                                onPointerDown={(event) => startImageResize(event, layer, handle)}
                                                onClick={(event) => event.stopPropagation()}
                                            />
                                        ))}
                                    </div>
                                ) : null}
                                {graphEnabled ? (
                                    <>
                                        {layer.type !== "text" || layer.annotation ? (
                                            <span className="sp-node-caption" title={layer.text}>
                                                {layer.text?.slice(0, 32) || (layer.type === "video" ? "视频素材" : layer.type === "audio" ? "音频素材" : "图片素材")}
                                            </span>
                                        ) : null}
                                        <Tooltip title={connecting ? "连接到此节点：带入上游素材和文案" : "输入端口：接收参考素材"}>
                                            <button
                                                className="sp-node-port is-input"
                                                data-shop-input={layer.id}
                                                aria-label="节点输入端口"
                                                onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    if (connecting && connectionSide.current === "output") {
                                                        attachConnection(connecting, layer.id);
                                                        return;
                                                    }
                                                    connectionSide.current = "input";
                                                    connectionStart.current = { x: e.clientX, y: e.clientY };
                                                    setConnecting(layer.id);
                                                    setSelectedEdge(null);
                                                }}
                                            >
                                                <ShopCanvasGlyph name="plus" size={17} />
                                            </button>
                                        </Tooltip>
                                        <Tooltip title="拖动到另一节点的输入端口，或点击后选择目标">
                                            <button
                                                className="sp-node-port is-output"
                                                data-shop-output={layer.id}
                                                aria-label="节点输出端口"
                                                onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    if (connecting && connectionSide.current === "input") {
                                                        attachConnection(layer.id, connecting);
                                                        return;
                                                    }
                                                    connectionSide.current = "output";
                                                    connectionStart.current = { x: e.clientX, y: e.clientY };
                                                    setConnecting(layer.id);
                                                    setSelectedEdge(null);
                                                }}
                                            >
                                                <ShopCanvasGlyph name="plus" size={17} />
                                            </button>
                                        </Tooltip>
                                    </>
                                ) : null}
                                {layer.type === "draft" && (layer.videoProjectId || layer.videoTaskId) && !layer.videoFailed && !layer.videoResultUnavailable ? (
                                    <div className="commerce-canvas-generation is-creating">
                                        <ShopCreating label="视频创作中" stage={layer.videoStage || "正在生成视频"} />
                                    </div>
                                ) : layer.type === "draft" ? (
                                    <div className="commerce-canvas-generation" role={layer.videoFailed ? "alert" : undefined}>
                                        {graphEnabled ? (
                                            <span className="sp-node-symbol">
                                                <ShopCanvasGlyph name={layer.draftKind || "spark"} size={27} />
                                            </span>
                                        ) : null}
                                        <strong>{layer.text}</strong>
                                        {layer.draftKind === "upload-card" ? (
                                            <label className="sp-upload-node" data-canvas-no-zoom onPointerDown={(e) => e.stopPropagation()}>
                                                选择图片或视频
                                                <input
                                                    type="file"
                                                    accept="image/*,video/*"
                                                    aria-label="上传节点素材"
                                                    onChange={(e) => {
                                                        void uploadToNode(layer.id, e.target.files?.[0]);
                                                        e.target.value = "";
                                                    }}
                                                />
                                            </label>
                                        ) : null}
                                        <span>
                                            {layer.videoProjectId || layer.videoTaskId
                                                ? layer.videoStage || "正在生成视频…"
                                                : graphEnabled
                                                  ? SHOP_CANVAS_TOOLS.find((item) => item.id === layer.draftKind)?.description || "连接素材，选择模型并描述创作需求"
                                                  : "双击配置模型和素材"}
                                        </span>
                                        {!graphEnabled ? (
                                            <button
                                                type="button"
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    openNode(layer);
                                                }}
                                            >
                                                配置生成
                                            </button>
                                        ) : null}
                                    </div>
                                ) : layer.type === "generation" ? (
                                    (() => {
                                        const generated = generations.find((item) => item.key === layer.generationKey);
                                        const resourceId = generated?.resourceId || layer.resourceId;
                                        return resourceId ? (
                                            <img src={resolveResourceVariantUrl(resourceStorageKey(resourceId), "thumbnail")} alt={generated?.label || "生成图片"} draggable={false} />
                                        ) : generated?.status === "running" ? (
                                            <div className="commerce-canvas-generation is-creating">
                                                <ShopCreating label="图片创作中" stage={generated.stage} progress={generated.progress} since={generated.createdAt} />
                                            </div>
                                        ) : (
                                            <div className="commerce-canvas-generation" role={generated?.status === "failed" ? "alert" : "status"}>
                                                <strong>{generated?.label || "商品图片"}</strong>
                                                <span>{generated?.status === "failed" ? generated.error || "生成失败，请在商品图片中查看" : generated?.stage || "正在读取生成任务…"}</span>
                                            </div>
                                        );
                                    })()
                                ) : layer.type === "image" ? (
                                    <img src={resolveResourceVariantUrl(resourceStorageKey(layer.resourceId!), "thumbnail")} alt={layer.text || "画布上传图片"} draggable={false} loading={layer.generatedReference ? "lazy" : undefined} />
                                ) : layer.type === "video" ? (
                                    graphEnabled ? (
                                        <ShopCanvasVideo resourceId={layer.resourceId!} nodeSelectable={isCompletedVideoNode(layer) || layer.generatedReference} />
                                    ) : (
                                        <video src={resolveResourceVariantUrl(resourceStorageKey(layer.resourceId!), "playback")} controls playsInline preload="metadata" aria-label="画布上传视频" onPointerDown={(event) => event.stopPropagation()} />
                                    )
                                ) : layer.type === "audio" ? (
                                    <div className="sp-node-audio">
                                        <audio
                                            src={resolveResourceVariantUrl(resourceStorageKey(layer.resourceId!), "playback")}
                                            controls
                                            preload="none"
                                            aria-label={layer.text || "画布参考音频"}
                                            data-canvas-no-zoom
                                            onPointerDown={(event) => event.stopPropagation()}
                                        />
                                    </div>
                                ) : editingId === layer.id && graphEnabled && !layer.annotation ? (
                                    <div className="sp-canvas-inline-text">
                                        <span aria-hidden="true">
                                            {editingText || " "}
                                            {"\n"}
                                        </span>
                                        <textarea
                                            autoFocus
                                            aria-label="编辑画布文字"
                                            value={editingText}
                                            data-canvas-no-zoom
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onChange={(event) => setEditingText(event.target.value)}
                                            onBlur={finishEdit}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" && !event.shiftKey) {
                                                    event.preventDefault();
                                                    finishEdit();
                                                }
                                            }}
                                        />
                                    </div>
                                ) : editingId === layer.id ? (
                                    <textarea
                                        autoFocus
                                        aria-label="编辑画布文字"
                                        value={editingText}
                                        data-canvas-no-zoom
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onChange={(event) => setEditingText(event.target.value)}
                                        onBlur={finishEdit}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" && !event.shiftKey) {
                                                event.preventDefault();
                                                finishEdit();
                                            }
                                        }}
                                    />
                                ) : (
                                    <span>{layer.text}</span>
                                )}
                                {graphEnabled && selectedId === layer.id && layer.type === "text" ? (
                                    <ShopCanvasTextTools
                                        layer={layer}
                                        onChange={(patch) => commit(history.present.map((n) => (n.id === layer.id ? { ...n, ...patch } : n)))}
                                        onEdit={() => {
                                            setEditingId(layer.id);
                                            setEditingText(layer.text || "");
                                        }}
                                    />
                                ) : null}
                                {graphEnabled && selectedId === layer.id && layer.resourceId && layer.type !== "audio" ? (
                                    <ShopCanvasMediaTools
                                        layer={layer}
                                        onAdd={(nodes) => setHistory((current) => ({ past: [...current.past.slice(-39), current.present], present: [...current.present, ...nodes], future: [] }))}
                                        onCreate={(kind) => {
                                            const node: CanvasLayer = { id: createClientUUID(), type: "draft", draftKind: kind, text: SHOP_CANVAS_TOOLS.find((t) => t.id === kind)?.label || "图片编辑", x: layer.x + 360, y: layer.y, inputs: [layer.id] };
                                            commit([...history.present, node]);
                                            setSelectedId(node.id);
                                            setSelectedLayerIds(new Set([node.id]));
                                            onSelectLayers?.([node.id]);
                                            onOpenDraft?.(node.id, kind, [layer]);
                                        }}
                                    />
                                ) : null}
                                {selectedId === layer.id && editingId !== layer.id && !(graphEnabled && layer.type === "text") ? (
                                    <div className="commerce-canvas-layer-actions" data-canvas-no-zoom>
                                        {layer.type === "text" ? (
                                            <button
                                                type="button"
                                                aria-label="编辑选中文字"
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={() => {
                                                    setEditingId(layer.id);
                                                    setEditingText(layer.text || "电商 Agent");
                                                }}
                                            >
                                                {toolIcon("edit", <Pencil size={13} />, 15)}
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            aria-label="删除选中元素"
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={() => {
                                                applyLayerCommand({ action: "delete", ids: [layer.id], nonce: Date.now() });
                                                setSelectedId(null);
                                                setSelectedLayerIds(new Set());
                                                onSelectLayers?.([]);
                                            }}
                                        >
                                            {toolIcon("delete", <Trash2 size={13} />, 15)}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    {/* 拖动时的对齐参考线，由拖动逻辑直接绘制，不经过 React 渲染。 */}
                    <div ref={guideLayer} className="commerce-snap-guides" aria-hidden="true" />
                </div>
            </CanvasViewport>
            {graphEnabled && selectedEdge ? (
                <div className="sp-connection-menu" data-canvas-no-zoom>
                    <span>素材连接</span>
                    <button
                        onClick={() => {
                            commit(
                                history.present.map((node) =>
                                    node.id === selectedEdge.target ? { ...node, inputs: node.inputs?.filter((id) => id !== selectedEdge.source), managedInputIds: node.managedInputIds?.filter((id) => id !== selectedEdge.source) } : node,
                                ),
                            );
                            setSelectedEdge(null);
                        }}
                    >
                        断开连接
                    </button>
                    <button onClick={() => setSelectedEdge(null)}>关闭</button>
                </div>
            ) : null}
            {selectionBox ? <div className="commerce-canvas-selection-box" aria-hidden="true" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} /> : null}
            {groupBounds ? (
                <div className="commerce-canvas-group-outline" aria-hidden="true" style={{ left: groupBounds.x, top: groupBounds.y, width: groupBounds.width, height: groupBounds.height }}>
                    <span className="top-left" />
                    <span className="top-center" />
                    <span className="top-right" />
                    <span className="middle-left" />
                    <span className="middle-right" />
                    <span className="bottom-left" />
                    <span className="bottom-center" />
                    <span className="bottom-right" />
                </div>
            ) : null}
            {groupBounds && selectedResults.size > 1 ? (
                <CommerceArrangeMenu
                    bounds={groupBounds}
                    frame={{ width: groupBounds.frameWidth, height: groupBounds.frameHeight }}
                    leftInset={groupBounds.inset}
                    rightInset={layersOpen ? 266 : 0}
                    count={selectedResults.size}
                    onArrange={arrangeSelection}
                    onDownload={onExportSelection}
                    onClear={() => onSelectResults?.([])}
                />
            ) : null}

            {emptyState ? (
                <div className="commerce-canvas-empty-overlay" aria-live="polite">
                    {emptyState}
                </div>
            ) : null}
            <div className="commerce-canvas-actions" data-canvas-no-zoom>
                {actions}
            </div>
            <aside className="commerce-canvas-layers" aria-label="画布图层" aria-hidden={!layersOpen} inert={!layersOpen} data-canvas-no-zoom data-canvas-wheel-scroll>
                <header>
                    <strong>
                        {toolIcon("layers", <LayersIcon size={16} />, 17)}
                        图层
                        {resultLayers.length ? (
                            <span className="commerce-count-badge is-neutral" aria-label={`共 ${resultLayers.length} 张`}>
                                {resultLayers.length}
                            </span>
                        ) : null}
                    </strong>
                    <button type="button" onClick={graphEnabled ? selectAllReady : onSelectAll} disabled={!resultLayers.some((item) => item.ready) && !(graphEnabled && history.present.length)}>
                        全选
                    </button>
                </header>
                <div className="commerce-canvas-layer-list">
                    {resultLayers.length ? (
                        resultLayers.map((item) => (
                            <button type="button" key={item.id} className={selectedResults.has(item.id) ? "is-selected" : ""} onClick={() => focusResult(item.id)}>
                                <span className="commerce-canvas-layer-check" aria-hidden="true">
                                    {selectedResults.has(item.id) ? toolIcon("done", <Check size={11} strokeWidth={3} />, 13) : null}
                                </span>
                                {item.src ? <img src={item.src} alt="" /> : <span className="commerce-canvas-layer-thumb" />}
                                <span className="commerce-canvas-layer-name">{item.label}</span>
                                {toolIcon("eye", <Eye size={15} />, 16)}
                            </button>
                        ))
                    ) : (
                        <p>生成后的图片会显示在这里</p>
                    )}
                    {history.present
                        .filter((item) => item.type !== "result")
                        .map((item) => (
                            <button
                                type="button"
                                key={item.id}
                                className={selectedLayerIds.has(item.id) ? "is-selected" : ""}
                                onClick={() => {
                                    setSelectedId(item.id);
                                    setSelectedLayerIds(new Set([item.id]));
                                    onSelectLayers?.([item.id]);
                                    onSelectResults?.([]);
                                    setTool("select");
                                }}
                            >
                                {item.type === "image" ? toolIcon("image", <ImagePlusIcon size={17} />, 17) : item.type === "video" ? toolIcon("video", <Video size={17} />, 17) : toolIcon("text", <TextToolIcon size={17} />, 17)}
                                <span className="commerce-canvas-layer-name">{item.type === "text" ? item.text : item.type === "video" ? "上传视频" : "上传图片"}</span>
                            </button>
                        ))}
                </div>
            </aside>
            {storageKey.startsWith("shop-canvas:") ? (
                <>
                    {noVisibleNodes ? (
                        <div className="sp-canvas-return-nodes" data-canvas-no-zoom role="status">
                            当前视窗没有节点{" "}
                            <button type="button" onClick={fitAll}>
                                回到节点
                            </button>
                        </div>
                    ) : null}
                    <div className="sp-canvas-viewport-tools" data-canvas-no-zoom role="toolbar" aria-label="画布视图">
                        {viewportButton("整理画布", "让全部节点进入视野", "fit", fitAll)}
                        {viewportButton("网格吸附", gridSnap ? "关闭网格吸附" : "拖动节点时对齐网格", "grid", () => setGridSnap((value) => !value), gridSnap)}
                        {viewportButton("显示或隐藏小地图", showMiniMap ? "隐藏小地图" : "显示小地图", "minimap", () => setShowMiniMap((value) => !value), showMiniMap)}
                        {viewportButton("缩小画布", "缩小画布", "minus", zoomOut)}
                        <Tooltip title="恢复到 100% 缩放" placement="top" trigger={["hover", "focus"]} mouseEnterDelay={0.22} classNames={{ root: "sp-canvas-tooltip ms-scope", container: "sp-canvas-tooltip-panel" }}>
                            <button type="button" onClick={zoomReset}>
                                {Math.round(viewport.k * 100)}%
                            </button>
                        </Tooltip>
                        {viewportButton("放大画布", "放大画布", "plus", zoomIn)}
                    </div>
                    {showMiniMap ? (
                        <div className="sp-canvas-minimap" data-canvas-no-zoom aria-label="电商画布小地图">
                            <div className="sp-canvas-minimap-head">
                                <span>画布概览</span>
                                <small>{mapNodes.length} 个节点</small>
                            </div>
                            <div
                                className="sp-canvas-minimap-scene"
                                onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    const bounds = { ...mapBounds };
                                    const move = (e: globalThis.PointerEvent | typeof event) => {
                                        const x = bounds.left + ((e.clientX - rect.left) / rect.width) * (bounds.right - bounds.left);
                                        const y = bounds.top + ((e.clientY - rect.top) / rect.height) * (bounds.bottom - bounds.top);
                                        navigateViewport({ ...viewport, x: frameWidth / 2 - x * viewport.k, y: frameHeight / 2 - y * viewport.k });
                                    };
                                    const end = () => {
                                        window.removeEventListener("pointermove", move);
                                        window.removeEventListener("pointerup", end);
                                        window.removeEventListener("pointercancel", end);
                                    };
                                    selectionCleanup.current?.();
                                    selectionCleanup.current = end;
                                    move(event);
                                    window.addEventListener("pointermove", move);
                                    window.addEventListener("pointerup", end);
                                    window.addEventListener("pointercancel", end);
                                }}
                            >
                                <span
                                    className="sp-canvas-minimap-viewport"
                                    style={{
                                        left: mapX(visibleWorld.left),
                                        top: mapY(visibleWorld.top),
                                        width: `${((visibleWorld.right - visibleWorld.left) / Math.max(1, mapBounds.right - mapBounds.left)) * 100}%`,
                                        height: `${((visibleWorld.bottom - visibleWorld.top) / Math.max(1, mapBounds.bottom - mapBounds.top)) * 100}%`,
                                    }}
                                />
                                {mapNodes.map((item) => (
                                    <i key={item.id} className={item.type === "image" ? "is-image" : "is-text"} style={{ left: mapX(item.x), top: mapY(item.y) }} />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </>
            ) : null}
            {!graphEnabled ? (
                <div ref={layerToggleRef} className="commerce-canvas-layer-toggle" data-canvas-no-zoom>
                    <button type="button" aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}>
                        {toolIcon("layers", <LayersIcon size={16} />, 17)}
                        图层
                    </button>
                    <Tooltip
                        title={
                            <span className="commerce-tool-hint">
                                <span>{graphEnabled ? "全选画布节点" : "全选已完成的图片"}</span>
                                <kbd>Ctrl A</kbd>
                            </span>
                        }
                        placement="top"
                        mouseEnterDelay={0.12}
                    >
                        <button type="button" onClick={graphEnabled ? selectAllReady : onSelectAll} disabled={!resultLayers.some((item) => item.ready) && !(graphEnabled && history.present.length)}>
                            全选
                        </button>
                    </Tooltip>
                </div>
            ) : null}
            <input
                ref={uploadInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
                multiple
                className="commerce-canvas-file-input"
                aria-label="上传图片到画布"
                onChange={(event) => {
                    void uploadMedia(event.target.files);
                    event.target.value = "";
                }}
            />
            <div ref={toolbarRef} className="commerce-canvas-toolbar" role="toolbar" aria-label="画布操作" data-canvas-no-zoom>
                {toolButton("选择", "选择并移动节点，按住 Ctrl 可临时关闭吸附", "V", toolIcon("select", <PointerIcon size={19} />), () => setTool("select"), tool === "select")}
                {toolButton("抓手", "拖动画布，查看其他区域", "H", toolIcon("hand", <HandIcon size={19} />), () => setTool("hand"), tool === "hand")}
                {toolButton("上传图片", "添加图片", "", toolIcon("insert-media", <ImagePlusIcon size={19} />), () => uploadInput.current?.click(), false, uploading)}
                {toolButton("输入文字", "点击画布添加文字", "T", toolIcon("text", <TextToolIcon size={19} />), () => setTool("text"), tool === "text")}
                <i className="commerce-canvas-tool-divider" aria-hidden="true" />
                {toolButton("撤回画布操作", "撤回上一步", "Ctrl Z", toolIcon("undo", <UndoIcon size={19} />), undo, false, !history.past.length)}
                {toolButton("前进画布操作", "重做上一步", "Ctrl Shift Z", toolIcon("redo", <RedoIcon size={19} />), redo, false, !history.future.length)}
            </div>
            {uploadError ? (
                <div className="commerce-canvas-upload-error" role="alert">
                    {uploadError}
                </div>
            ) : null}
        </section>
    );
}
