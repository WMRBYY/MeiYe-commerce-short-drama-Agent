import { CANVAS_CONNECTION_STROKE_WIDTH, canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import React, { useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardTableHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { batchReferenceHandleY } from "@/lib/canvas/canvas-batch-table";
import { batchCellAnchor, parseBatchCellHandle, type BatchScroll } from "@/lib/canvas/canvas-batch-references";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";
import { useCanvasVisualNode } from "./canvas-node-resize-motion";
import "./canvas-connection-stream.css";

export const CANVAS_CONNECTION_ACTIVE_COLOR = "#82c6ff";
export const CANVAS_CONNECTION_IDLE_WIDTH = 1.5;
export const CANVAS_CONNECTION_ACTIVE_WIDTH = 2;
export const CANVAS_CONNECTION_IDLE_OPACITY = 0.72;
export const CANVAS_CONNECTION_ACTIVE_OPACITY = 0.95;
// 选中节点后，与它相连的连线都播放流光；超过上限的仍高亮但不动画，避免大图卡顿。
export const MAX_ANIMATED_CANVAS_CONNECTIONS = 40;

export const ConnectionPath = React.memo(function ConnectionPath({
    connection,
    from: sourceFrom,
    to: sourceTo,
    fromScrollTop = 0,
    toScrollTop = 0,
    fromBatchScroll,
    toBatchScroll,
    active,
    visualMode = "full",
    hideVisual = false,
    animate = true,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    fromScrollTop?: number;
    toScrollTop?: number;
    fromBatchScroll?: BatchScroll;
    toBatchScroll?: BatchScroll;
    active: boolean;
    visualMode?: "full" | "hover-only";
    hideVisual?: boolean;
    animate?: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const from = useCanvasVisualNode(sourceFrom);
    const to = useCanvasVisualNode(sourceTo);
    const [hovered, setHovered] = useState(false);
    const { pathD, startX, startY, endX, endY } = canvasConnectionPath(connection, from, to, fromScrollTop, toScrollTop, fromBatchScroll, toBatchScroll);
    const targetCell = batchCellAnchor(to, connection.toHandleId, toBatchScroll);
    const emphasized = active || hovered;
    const show = !hideVisual && (visualMode === "full" || emphasized);
    const gradientId = `canvas-flow-${connection.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    if (!pathD) return null;
    return (
        <g>
            {targetCell ? <title>{targetCell.clipped ? t("canvasA.connections.clippedHint", { label: targetCell.label }) : targetCell.label}</title> : null}
            {targetCell?.clipped && !hideVisual && emphasized ? <text x={endX + 8} y={endY - 8} fill={theme.node.text} fontSize={12} style={{ pointerEvents: "none" }}>{t("canvasA.connections.scrollToView", { label: targetCell.label })}</text> : null}
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                vectorEffect="non-scaling-stroke"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
                onClick={(event) => { event.stopPropagation(); onSelect(); }}
                onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu?.(event); }} />
            {show ? <path d={pathD} stroke={emphasized ? CANVAS_CONNECTION_ACTIVE_COLOR : "currentColor"} strokeWidth={emphasized ? CANVAS_CONNECTION_ACTIVE_WIDTH : CANVAS_CONNECTION_IDLE_WIDTH}
                vectorEffect="non-scaling-stroke" strokeOpacity={emphasized ? CANVAS_CONNECTION_ACTIVE_OPACITY : CANVAS_CONNECTION_IDLE_OPACITY} fill="none" strokeLinecap="round" style={{ pointerEvents: "none" }} /> : null}
            {show && emphasized && (animate || hovered) ? <CanvasConnectionStream pathD={pathD} /> : show && emphasized ? <g data-connection-beam>
                <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={startX} y1={startY} x2={endX} y2={endY}>
                    <stop offset="0%" stopColor={CANVAS_CONNECTION_ACTIVE_COLOR} stopOpacity="0" />
                    <stop offset="50%" stopColor={CANVAS_CONNECTION_ACTIVE_COLOR} stopOpacity="1" />
                    <stop offset="100%" stopColor={CANVAS_CONNECTION_ACTIVE_COLOR} stopOpacity="0.15" />
                </linearGradient></defs>
                <path d={pathD} stroke={`url(#${gradientId})`} strokeWidth="1.4" vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round" style={{ pointerEvents: "none" }} />
            </g> : null}
        </g>
    );
}, (previous, next) => previous.connection === next.connection && previous.from === next.from && previous.to === next.to && previous.active === next.active && previous.animate === next.animate && previous.visualMode === next.visualMode && previous.hideVisual === next.hideVisual && previous.fromScrollTop === next.fromScrollTop && previous.toScrollTop === next.toScrollTop && previous.fromBatchScroll?.top === next.fromBatchScroll?.top && previous.fromBatchScroll?.left === next.fromBatchScroll?.left && previous.toBatchScroll?.top === next.toBatchScroll?.top && previous.toBatchScroll?.left === next.toBatchScroll?.left);

/**
 * 选中节点后相关连线上的蓝黄流光：外层蓝色光晕、中层亮蓝、内芯黄到暖白，
 * 每层同一段虚线、内层更短并居中，叠出「蓝边黄芯」的光束；两束光错开相位沿源→目标流动。
 * pathLength=100 让每条线一个周期跑完全程，长线短线观感一致。
 */
const STREAM_LAYERS = [
    { color: "#1677ff", width: 7, length: 12, opacity: 0.2 },
    { color: "#2fb4ff", width: 3.2, length: 10, opacity: 0.85 },
    { color: "#ffc93d", width: 1.7, length: 6, opacity: 0.95 },
    { color: "#fff4cf", width: 0.8, length: 3, opacity: 0.9 },
];
const STREAM_PHASES = [0, -1.05];

export function CanvasConnectionStream({ pathD }: { pathD: string }) {
    return <g data-connection-beam aria-hidden="true" style={{ pointerEvents: "none" }}>
        {STREAM_PHASES.map((delay) => STREAM_LAYERS.map(({ color, width, length, opacity }) => {
            // 内层比外层短，向前缘方向居中对齐，形成蓝色包裹黄色光芯的形状。
            const offset = -(STREAM_LAYERS[0].length - length) / 2;
            return <path
                key={`${delay}:${length}`}
                className="canvas-connection-stream"
                d={pathD}
                pathLength={100}
                stroke={color}
                strokeWidth={width}
                strokeOpacity={opacity}
                strokeDasharray={`${length} ${100 - length}`}
                strokeLinecap="round"
                fill="none"
                // 不用 non-scaling-stroke：它会让部分浏览器忽略 pathLength。线宽按画布缩放换算，屏幕上粗细不变。
                style={{ "--canvas-stream-offset": `${offset}px`, animationDelay: `${delay}s`, strokeWidth: `calc(${width}px / var(--canvas-committed-scale, 1))` } as CSSProperties}
            />;
        }))}
    </g>;
}

export function ConnectionDraft({ path }: { path: string }) {
    return <g aria-hidden="true" style={{ pointerEvents: "none" }}>
        <path d={path} stroke={CANVAS_CONNECTION_ACTIVE_COLOR} strokeWidth={CANVAS_CONNECTION_ACTIVE_WIDTH} strokeOpacity={CANVAS_CONNECTION_ACTIVE_OPACITY} fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <path className="canvas-connection-comet" d={path} stroke={CANVAS_CONNECTION_ACTIVE_COLOR} strokeWidth="1.5" strokeOpacity="0.9"
            strokeDasharray="16 118" fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </g>;
}

const BEAM_LAYERS = [0.35, 0.6, 0.9, 1.2, CANVAS_CONNECTION_STROKE_WIDTH, 1.65, 1.9, 2.1].map((width, index) => ({
    length: 36 - index * 4,
    offset: -index * 4,
    width,
    opacity: 0.14 + index * 0.07,
}));

export function CanvasConnectionBeam({ pathD, color }: { pathD: string; color: string }) {
    // 前缘对齐，靠近头部的短层逐渐加宽、加深，形成圆头细尾的水滴轮廓。
    // 各层都沿原曲线行进，转弯时尾部自然贴线，底线宽度不受影响。
    // 统一周期为路径的三分之一，循环无跳帧；动画由 CSS 驱动，不逐帧更新 React。
    return <g data-connection-beam aria-hidden="true" style={{ pointerEvents: "none" }}>
        {BEAM_LAYERS.map(({ length, offset, width, opacity }) => <path
            key={length}
            className="canvas-connection-comet"
            d={pathD}
            pathLength={300}
            stroke={color}
            strokeWidth={width}
            strokeOpacity={opacity}
            strokeDasharray={`${length} ${100 - length}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="none"
            style={{ "--canvas-beam-offset": `${offset}px`, strokeWidth: `calc(${width}px / var(--canvas-committed-scale, 1))` } as CSSProperties}
        />)}
    </g>;
}

export function canvasConnectionPath(connection: CanvasConnection, from: CanvasNodeData, to: CanvasNodeData, fromScrollTop = 0, toScrollTop = 0, fromBatchScroll?: BatchScroll, toBatchScroll?: BatchScroll) {
    const fromCell = batchCellAnchor(from, connection.fromHandleId, fromBatchScroll);
    const toCell = batchCellAnchor(to, connection.toHandleId, toBatchScroll);
    if ((parseBatchCellHandle(connection.fromHandleId) && !fromCell) || (parseBatchCellHandle(connection.toHandleId) && !toCell)) return { pathD: "", startX: 0, startY: 0, endX: 0, endY: 0 };
    const startX = fromCell?.x ?? from.position.x + from.width;
    const startY = fromCell?.y ?? connectionHandleY(from, connection.fromHandleId, fromScrollTop);
    const endX = toCell?.x ?? to.position.x;
    const endY = toCell?.y ?? connectionHandleY(to, connection.toHandleId, toScrollTop);
    const controlOffset = connectionCurveControlOffset(startX, endX);
    return { pathD: `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`, startX, startY, endX, endY };
}

function connectionCurveControlOffset(startX: number, endX: number) {
    const distance = Math.abs(endX - startX);
    const direction = endX < startX ? -1 : 1;
    return direction * Math.max(distance * 0.5, 50);
}

export function activeConnectionPath(node: CanvasNodeData | undefined, handle: ConnectionHandle, mouseWorld: Position, nodeScrollTop = 0, nodeBatchScroll?: BatchScroll) {
    if (!node) return "";
    const nodeCell = batchCellAnchor(node, handle.handleId, nodeBatchScroll);
    if (parseBatchCellHandle(handle.handleId) && !nodeCell) return "";
    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? connectionHandleY(node, handle.handleId, nodeScrollTop) : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : nodeCell?.x ?? node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : nodeCell?.y ?? connectionHandleY(node, handle.handleId, nodeScrollTop);
    // 悬停目标由卡片反馈；松手前的自由端始终跟随指针。
    const controlOffset = connectionCurveControlOffset(startX, endX);
    return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
}

/**
 * 连线在节点上的接入 Y。
 *
 * 单端口的一侧（左右各一个出入口，除分镜脚本外都是）**永远取边的正中**：
 * 之前按鼠标落点比例取 Y，多条线接同一个端口就会沿着边散开，视觉上像节点有很多端口。
 * 真正的多端口只存在于分镜脚本的 `row:` 句柄；普通节点始终连接到边缘
 * 垂直中心，避免同一个节点因鼠标落点产生漂移的“伪端口”。
 */
export function connectionHandleY(node: CanvasNodeData, handleId?: string, scrollTop = 0) {
    const batchY = batchReferenceHandleY(node, handleId);
    if (batchY !== undefined) return batchY;
    if (handleId === "storyboard:context") return node.position.y + node.height - (node.metadata?.storyboardComposerHeight || 104) / 2;
    if (!handleId?.startsWith("row:")) return node.position.y + node.height / 2;
    const rowId = handleId.slice(4);
    const index = (node.metadata?.storyboard?.rows || []).findIndex((row) => row.id === rowId);
    if (index < 0) return node.position.y + node.height / 2;
    const tableHeight = storyboardTableHeight(node.height, node.metadata?.storyboardComposerHeight);
    const localY = Math.min(Math.max(index * STORYBOARD_ROW_HEIGHT + STORYBOARD_ROW_HEIGHT / 2 - scrollTop, 4), tableHeight - 4);
    return node.position.y + STORYBOARD_HEADER_HEIGHT + localY;
}
