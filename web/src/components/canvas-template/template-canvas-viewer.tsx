import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App } from "antd";
import { Clapperboard, Copy, Image as ImageIcon, LockKeyhole, Maximize, Minus, Plus, Type, Video, X } from "lucide-react";

import { ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasBatchTableNodeContent } from "@/components/canvas/canvas-batch-table-node";
import { CanvasViewport } from "@/components/canvas/canvas-viewport";
import { canvasAppearanceForTheme, DEFAULT_CANVAS_BACKGROUND_MODE, resolveCanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { canvasThemes } from "@/lib/canvas-theme";
import { FOLDER_COLLAPSED_HEIGHT, FOLDER_COLLAPSED_WIDTH, isCanvasFolderNode, isFrameNode, isNodeHiddenByCollapsedFrame, resolveFrameConnection } from "@/lib/canvas/canvas-frame";
import { ensureMediaNodeMinimumSize } from "@/lib/canvas/canvas-node-size";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import { buildCanvasResourceReferences } from "@/lib/canvas/canvas-resource-references";
import { canvasTemplateMediaUrl, type CanvasTemplateProject } from "@/services/api/canvas-templates";
import { useCanvasThemeScope, useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

const NODE_TYPE_LABELS: Record<string, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
    text: "文本",
    config: "生成配置",
    script: "分镜脚本",
    frame: "分组",
    "batch-table": "批量表格",
};

const noop = () => undefined;

/** 媒体地址统一经 canvasTemplateMediaUrl 改写，前端与 API 分域部署时仍指向 API 源。 */
function normalizeTemplateNode(node: CanvasNodeData): CanvasNodeData {
    const metadata = node.metadata;
    if (!metadata) return ensureMediaNodeMinimumSize(node);
    const next = { ...metadata } as NonNullable<CanvasNodeData["metadata"]>;
    if (typeof next.content === "string" && next.content.startsWith("/api/")) next.content = canvasTemplateMediaUrl(next.content);
    if (typeof next.previewContent === "string" && next.previewContent.startsWith("/api/")) next.previewContent = canvasTemplateMediaUrl(next.previewContent);
    if (next.videoPreview?.content?.startsWith("/api/")) next.videoPreview = { ...next.videoPreview, content: canvasTemplateMediaUrl(next.videoPreview.content) };
    return ensureMediaNodeMinimumSize({ ...node, metadata: next });
}

export function templateNodeThumbnail(node?: CanvasNodeData | null) {
    if (!node) return "";
    if (node.type === CanvasNodeType.Image) return node.metadata?.previewContent || node.metadata?.content || "";
    if (node.type === CanvasNodeType.Video) return node.metadata?.videoPreview?.content || "";
    return "";
}

function fitViewport(nodes: CanvasNodeData[], width: number, height: number): ViewportTransform {
    if (!nodes.length || !width || !height) return { x: 0, y: 0, k: 1 };
    const left = Math.min(...nodes.map((node) => node.position.x));
    const top = Math.min(...nodes.map((node) => node.position.y));
    const right = Math.max(...nodes.map((node) => node.position.x + node.width));
    const bottom = Math.max(...nodes.map((node) => node.position.y + node.height));
    const scale = Math.min(1, Math.max(0.05, Math.min((width - 120) / Math.max(right - left, 1), (height - 160) / Math.max(bottom - top, 1))));
    return { x: width / 2 - ((left + right) / 2) * scale, y: height / 2 - ((top + bottom) / 2) * scale, k: scale };
}

/**
 * 模版画布只读查看器：平移缩放、点开节点看缩略图和提示词，不能拖动、编辑或生成。
 * 注意不要放进 antd Modal 或 role="dialog" 容器里，画布视口会忽略这些容器内的滚轮与指针事件。
 */
export function TemplateCanvasViewer({ project, className = "", bottomOffset = 20 }: { project: CanvasTemplateProject; className?: string; bottomOffset?: number }) {
    useCanvasThemeScope();
    const colorTheme = useCanvasThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [nodes, setNodes] = useState<CanvasNodeData[]>(() => (project.nodes || []).map(normalizeTemplateNode));
    const connections = useMemo<CanvasConnection[]>(() => project.connections || [], [project.connections]);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const appearance = useMemo(() => canvasAppearanceForTheme(colorTheme), [colorTheme]);

    // 作品页统一按深色画布展示，离开后恢复用户原来的画布主题。
    useEffect(() => {
        const previous = useCanvasThemeStore.getState().theme;
        useCanvasThemeStore.getState().setTheme("dark");
        return () => {
            if (useCanvasThemeStore.getState().theme === "dark") useCanvasThemeStore.getState().setTheme(previous);
        };
    }, []);

    useEffect(() => {
        setNodes((project.nodes || []).map(normalizeTemplateNode));
        setSelectedNodeId(null);
    }, [project]);

    const onViewportChange = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        setViewport(next);
    }, []);

    // 用布局尺寸而不是 getBoundingClientRect：外层展开动画带缩放时，后者会算出偏小的适配比例。
    const fitContent = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        onViewportChange(fitViewport(nodes, container.clientWidth, container.clientHeight - bottomOffset));
    }, [bottomOffset, nodes, onViewportChange]);

    useLayoutEffect(() => {
        const frame = requestAnimationFrame(fitContent);
        return () => cancelAnimationFrame(frame);
        // 只在画布内容变化时自动适配，手动缩放后不打断。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nodes.length, project]);

    const setZoom = (scale: number) => {
        const container = containerRef.current;
        if (!container) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        const current = viewportRef.current;
        const k = Math.min(4, Math.max(0.05, scale));
        onViewportChange({ x: width / 2 - ((width / 2 - current.x) / current.k) * k, y: height / 2 - ((height / 2 - current.y) / current.k) * k, k });
    };

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const frameChildrenById = useMemo(() => {
        const result = new Map<string, CanvasNodeData[]>();
        nodes.forEach((node) => {
            if (!node.parentId) return;
            const children = result.get(node.parentId) || [];
            children.push(node);
            result.set(node.parentId, children);
        });
        return result;
    }, [nodes]);
    const visibleNodes = useMemo(() => nodes.filter((node) => !isNodeHiddenByCollapsedFrame(node, nodes)), [nodes]);
    const visibleConnections = useMemo(
        () =>
            connections.flatMap((connection) => {
                const resolved = resolveFrameConnection(connection, nodes);
                return resolved ? [{ connection, ...resolved }] : [];
            }),
        [connections, nodes],
    );
    const connectionBounds = useMemo(() => {
        if (!nodes.length) return { left: -1, top: -1, width: 2, height: 2 };
        const padding = 320;
        const left = Math.min(...nodes.map((node) => node.position.x)) - padding;
        const top = Math.min(...nodes.map((node) => node.position.y)) - padding;
        const right = Math.max(...nodes.map((node) => node.position.x + node.width)) + padding;
        const bottom = Math.max(...nodes.map((node) => node.position.y + node.height)) + padding;
        return { left, top, width: right - left, height: bottom - top };
    }, [nodes]);

    const toggleFrame = (nodeId: string) =>
        setNodes((current) =>
            current.map((node) => {
                if (node.id !== nodeId || !isFrameNode(node)) return node;
                const collapsed = !node.metadata?.frame?.collapsed;
                const frame = node.metadata?.frame;
                return {
                    ...node,
                    width: collapsed ? (isCanvasFolderNode(node) ? FOLDER_COLLAPSED_WIDTH : 240) : frame?.expandedWidth || node.width,
                    height: collapsed ? (isCanvasFolderNode(node) ? FOLDER_COLLAPSED_HEIGHT : 144) : frame?.expandedHeight || node.height,
                    metadata: { ...node.metadata, frame: { collapsed, expandedWidth: collapsed ? node.width : frame?.expandedWidth || node.width, expandedHeight: collapsed ? node.height : frame?.expandedHeight || node.height } },
                };
            }),
        );

    const renderNode = useCallback(
        (node: CanvasNodeData): ReactNode => {
            if (node.type === CanvasNodeType.Script) return <ReadOnlyScriptNode node={node} />;
            if (node.type === CanvasNodeType.BatchTable)
                return (
                    <CanvasBatchTableNodeContent
                        node={node}
                        nodes={nodes}
                        connections={connections}
                        batch={node.metadata?.generationBatches?.at(-1)}
                        theme={theme}
                        readOnly
                        onPatchTable={noop}
                        onAddRow={noop}
                        onRemoveRow={noop}
                        onUpdateRow={noop}
                        onFillRows={noop}
                        onGenerate={noop}
                        onRetryItem={noop}
                        onAddReferenceColumn={noop}
                        onReorderReferenceColumns={noop}
                        onMoveReferenceCell={noop}
                        onUploadReference={noop}
                        onConnectStart={noop}
                    />
                );
            return <ReadOnlyConfigNode node={node} />;
        },
        [connections, nodes, theme],
    );

    const selectNode = (nodeId: string) => setSelectedNodeId(nodeId);
    const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) || null : null;
    const background = resolveCanvasAppearance(appearance, colorTheme).background;

    return (
        <div className={`relative size-full overflow-hidden ${className}`} style={{ background, color: theme.node.text }}>
            <CanvasViewport
                containerRef={containerRef}
                viewport={viewport}
                appearance={appearance}
                backgroundMode={project.backgroundMode || DEFAULT_CANVAS_BACKGROUND_MODE}
                onViewportChange={onViewportChange}
                onViewportPreviewChange={(next) => {
                    viewportRef.current = next;
                }}
                onCanvasDeselect={() => setSelectedNodeId(null)}
                onContextMenu={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
            >
                <svg
                    className="absolute overflow-visible"
                    viewBox={`${connectionBounds.left} ${connectionBounds.top} ${connectionBounds.width} ${connectionBounds.height}`}
                    style={{ left: connectionBounds.left, top: connectionBounds.top, width: connectionBounds.width, height: connectionBounds.height, pointerEvents: "none", zIndex: 0 }}
                >
                    {visibleConnections.map(({ connection, from, to }) => (
                        <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={selectedNodeId === to.id || selectedNodeId === from.id} onSelect={() => selectNode(to.id)} />
                    ))}
                </svg>
                {visibleNodes.map((node) =>
                    isFrameNode(node) ? (
                        <CanvasFrameNode
                            key={node.id}
                            data={node}
                            childNodes={frameChildrenById.get(node.id) || []}
                            scale={viewport.k}
                            isSelected={selectedNodeId === node.id}
                            isDropTarget={false}
                            readOnly
                            onMouseDown={(event) => {
                                event.stopPropagation();
                            }}
                            onResize={noop}
                            onToggleCollapsed={toggleFrame}
                            onFolderStyleChange={noop}
                            onTitleChange={noop}
                            onHoverStart={noop}
                            onHoverEnd={noop}
                            onContextMenu={(event) => event.preventDefault()}
                        />
                    ) : (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeId === node.id}
                            isRelated={false}
                            isFocusRelated={false}
                            isConnectionTarget={false}
                            showImageInfo={false}
                            seamlessImage={node.type === CanvasNodeType.Image && Boolean(node.parentId && nodeById.get(node.parentId)?.metadata?.imageAssembly === "vertical")}
                            readOnly
                            renderNodeContent={renderNode}
                            onMouseDown={(event, nodeId) => {
                                event.stopPropagation();
                                if (event.button === 0) selectNode(nodeId);
                            }}
                            onHoverStart={noop}
                            onHoverEnd={noop}
                            onConnectStart={noop}
                            onResize={noop}
                            onContentChange={noop}
                            onRetry={noop}
                            onOpenTaskDetails={noop}
                            onViewImage={(target) => selectNode(target.id)}
                            onContextMenu={(event) => event.preventDefault()}
                        />
                    ),
                )}
            </CanvasViewport>

            <div data-canvas-no-zoom className="absolute left-4 z-[var(--z-panel-floating)] flex items-center gap-1 rounded-xl border px-1.5 py-1 text-xs backdrop-blur" style={{ bottom: bottomOffset, background: `${theme.toolbar.panel}e6`, borderColor: theme.toolbar.border }}>
                <ViewerButton label="适配画布" onClick={fitContent}>
                    <Maximize className="size-3.5" />
                </ViewerButton>
                <ViewerButton label="缩小" onClick={() => setZoom(viewport.k / 1.25)}>
                    <Minus className="size-3.5" />
                </ViewerButton>
                <span className="w-11 text-center tabular-nums" style={{ color: theme.node.muted }}>
                    {Math.round(viewport.k * 100)}%
                </span>
                <ViewerButton label="放大" onClick={() => setZoom(viewport.k * 1.25)}>
                    <Plus className="size-3.5" />
                </ViewerButton>
            </div>

            {selectedNode ? <TemplateNodeDetailPanel node={selectedNode} nodes={nodes} connections={connections} bottomOffset={bottomOffset} onClose={() => setSelectedNodeId(null)} /> : null}
        </div>
    );
}

function ViewerButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" title={label} aria-label={label} className="grid size-7 place-items-center rounded-lg transition hover:bg-white/10" onClick={onClick}>
            {children}
        </button>
    );
}

function decodeLabel(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把提示词里的引用渲染成只读标签：@[node:ID]、@[tool:...] 等令牌，以及编辑器写回的 @图片1 / @文本1 这类引用名
 * （引用名与编辑器同样由 buildCanvasResourceReferences 计算）。其余文字原样显示。
 */
function PromptText({ prompt, nodeById, labelToNodeId }: { prompt: string; nodeById: Map<string, CanvasNodeData>; labelToNodeId: Map<string, string> }) {
    const labels = [...labelToNodeId.keys()].sort((left, right) => right.length - left.length).map(escapeRegExp);
    const pattern = new RegExp(`@\\[(node|asset|skill|tool|attachment):([^\\]]+)\\]${labels.length ? `|@(${labels.join("|")})(?![A-Za-z0-9_])` : ""}`, "gu");
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const match of prompt.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > cursor) parts.push(prompt.slice(cursor, index));
        const [token, kind, value, referenceLabel] = match;
        let label = kind === "asset" ? "素材" : kind === "skill" ? "技能" : kind === "attachment" ? "附件" : "引用";
        let thumb = "";
        if (kind === "node" || referenceLabel) {
            const target = nodeById.get(kind === "node" ? value : labelToNodeId.get(referenceLabel) || "");
            label = target?.title || referenceLabel || "节点";
            thumb = templateNodeThumbnail(target);
        } else if (kind === "tool") {
            const [, , rawLabel] = value.split(":");
            label = rawLabel ? decodeLabel(rawLabel) : "工具";
        }
        parts.push(
            <span key={`${index}-${token}`} className="mx-0.5 inline-flex max-w-[220px] items-center gap-1 rounded-md bg-white/10 px-1.5 py-px align-middle text-[12px] text-white/80">
                {thumb ? <img src={thumb} alt="" className="size-4 shrink-0 rounded object-cover" /> : null}
                <span className="truncate">{label}</span>
            </span>,
        );
        cursor = index + token.length;
    }
    if (cursor < prompt.length) parts.push(prompt.slice(cursor));
    return <>{parts}</>;
}

/** 节点只读详情：上游参考缩略图、提示词和生成参数，样式对齐画布的提示词面板。 */
export function TemplateNodeDetailPanel({ node, nodes, connections, onClose, bottomOffset = 20 }: { node: CanvasNodeData; nodes: CanvasNodeData[]; connections: CanvasConnection[]; onClose: () => void; bottomOffset?: number }) {
    const { message } = App.useApp();
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const references = useMemo(
        () =>
            connections
                .filter((connection) => connection.toNodeId === node.id)
                .map((connection) => nodeById.get(connection.fromNodeId))
                .filter((item): item is CanvasNodeData => Boolean(item)),
        [connections, node.id, nodeById],
    );
    const labelToNodeId = useMemo(() => {
        const map = new Map<string, string>();
        for (const reference of buildCanvasResourceReferences(nodes, connections, node.id)) {
            if (reference.nodeId && reference.label && !map.has(reference.label)) map.set(reference.label, reference.nodeId);
        }
        return map;
    }, [connections, node.id, nodes]);
    const prompt = nodeGenerationPrompt(node) || (node.type === CanvasNodeType.Text ? String(node.metadata?.content || "") : "");
    const metadata = node.metadata || {};
    const chips = [
        NODE_TYPE_LABELS[node.type] || node.type,
        typeof metadata.model === "string" ? metadata.model : "",
        typeof metadata.size === "string" ? metadata.size : "",
        metadata.seconds ? `${metadata.seconds}s` : "",
        typeof metadata.quality === "string" ? metadata.quality : "",
        metadata.count && Number(metadata.count) > 1 ? `×${metadata.count}` : "",
    ].filter(Boolean);
    const mediaUrl = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video ? String(metadata.content || "") : "";

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success("提示词已复制");
        } catch {
            message.error("复制失败，请手动选择文本复制");
        }
    };

    return (
        <div
            data-canvas-no-zoom
            className="template-node-panel absolute left-1/2 z-[var(--z-panel-floating)] w-[min(760px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#262626]/95 p-4 text-white shadow-2xl backdrop-blur-xl"
            style={{ bottom: bottomOffset + 44 }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <div className="mb-3 flex items-start gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
                    {references.length ? (
                        references.map((item) => {
                            const thumb = templateNodeThumbnail(item);
                            return (
                                <span key={item.id} title={item.title} className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10">
                                    {thumb ? <img src={thumb} alt={item.title} className="size-full object-cover" /> : item.type === CanvasNodeType.Video ? <Video className="size-4 text-white/50" /> : item.type === CanvasNodeType.Image ? <ImageIcon className="size-4 text-white/50" /> : <Type className="size-4 text-white/50" />}
                                </span>
                            );
                        })
                    ) : (
                        <span className="truncate text-sm font-medium text-white/85">{node.title || NODE_TYPE_LABELS[node.type] || "节点"}</span>
                    )}
                </div>
                {prompt ? (
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white" title="复制提示词" aria-label="复制提示词" onClick={() => void copyPrompt()}>
                        <Copy className="size-4" />
                    </button>
                ) : null}
                <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white" title="关闭" aria-label="关闭节点详情" onClick={onClose}>
                    <X className="size-4" />
                </button>
            </div>
            {mediaUrl && !prompt ? (
                <div className="mb-3 overflow-hidden rounded-xl bg-black/40">
                    {node.type === CanvasNodeType.Video ? (
                        <video src={mediaUrl} poster={metadata.videoPreview?.content} controls playsInline className="max-h-[36vh] w-full object-contain" />
                    ) : (
                        <img src={mediaUrl} alt={node.title} className="max-h-[36vh] w-full object-contain" />
                    )}
                </div>
            ) : null}
            <div data-canvas-wheel-scroll className="max-h-[32vh] min-h-[48px] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-6 text-white/85" onWheel={(event) => event.stopPropagation()}>
                {prompt ? <PromptText prompt={prompt} nodeById={nodeById} labelToNodeId={labelToNodeId} /> : <span className="text-white/45">{mediaUrl ? "该节点是上传的素材，没有提示词。" : "该节点没有提示词。"}</span>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {chips.map((chip) => (
                    <span key={chip} className="max-w-[240px] truncate rounded-md bg-white/[0.08] px-2 py-1 text-[11px] text-white/65">
                        {chip}
                    </span>
                ))}
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-white/45">
                    <LockKeyhole className="size-3" />
                    只读
                </span>
            </div>
        </div>
    );
}

function ReadOnlyConfigNode({ node }: { node: CanvasNodeData }) {
    const theme = canvasThemes[useCanvasThemeStore((state) => state.theme)];
    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-[var(--panel-radius)]">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                <ImageIcon className="size-4" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-words p-4 text-sm leading-6" style={{ color: theme.node.muted }}>
                {nodeGenerationPrompt(node) || "未填写提示词"}
            </div>
        </div>
    );
}

function ReadOnlyScriptNode({ node }: { node: CanvasNodeData }) {
    const theme = canvasThemes[useCanvasThemeStore((state) => state.theme)];
    const rows = node.metadata?.storyboard?.rows || [];
    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-[var(--panel-radius)]">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                <Clapperboard className="size-4" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title}</span>
                <span className="text-xs" style={{ color: theme.node.muted }}>
                    {rows.length} 镜
                </span>
            </div>
            <div data-canvas-wheel-scroll className="min-h-0 flex-1 overflow-y-auto" onWheel={(event) => event.stopPropagation()}>
                {rows.length ? (
                    rows.map((row) => (
                        <div key={row.id} className="grid grid-cols-[52px_72px_minmax(180px,1fr)_minmax(150px,.8fr)] border-b text-xs leading-5" style={{ minHeight: 48, borderColor: theme.node.stroke }}>
                            <span className="grid place-items-center border-r" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                                #{row.shotNumber}
                            </span>
                            <span className="grid place-items-center border-r" style={{ borderColor: theme.node.stroke }}>
                                {row.durationSeconds}s
                            </span>
                            <span className="border-r px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                                {row.plotDescription || "-"}
                            </span>
                            <span className="px-3 py-2" style={{ color: theme.node.muted }}>
                                {row.dialogue || "-"}
                            </span>
                        </div>
                    ))
                ) : (
                    <div className="grid h-full place-items-center text-sm" style={{ color: theme.node.muted }}>
                        暂无分镜
                    </div>
                )}
            </div>
        </div>
    );
}
