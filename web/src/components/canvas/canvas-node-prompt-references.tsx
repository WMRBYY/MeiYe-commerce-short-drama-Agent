// 节点提示词面板的参考素材区：已连接参考的缩略图货架、自动 @ 引用工具与拖拽排序。

import { Image as AntImage, Popover } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AtSign, FileText, GripVertical, ImageIcon, Link2, Maximize2, Music2, Pencil, Plus, SlidersHorizontal, UserRound, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { splitMentionText } from "./canvas-mention-editable";
import { getResourceAccess, resolveResourceAccessURL } from "@/services/api/resources";
import { resolveVideoMediaUrl } from "@/services/file-storage";
import { useEffect, useState } from "react";
import { usePopoverAnchorAlign } from "@/hooks/use-popover-anchor-align";
import { CanvasNodeType } from "@/types/canvas";
import { hydrateCanvasVideoPreview } from "@/services/canvas-video-preview";
import type { CanvasTheme } from "./canvas-node-prompt-panel";

export function ReferenceToolsPopover({
    canAutoMention,
    autoLinkEnabled,
    onAutoMention,
    onAutoLinkEnabledChange,
    accent,
    compact,
}: {
    canAutoMention: boolean;
    autoLinkEnabled: boolean;
    onAutoMention: () => void;
    onAutoLinkEnabledChange: (enabled: boolean) => void;
    accent: string;
    compact: boolean;
}) {
    const [open, setOpen] = useState(false);
    const popoverRef = usePopoverAnchorAlign(open);
    return (
        <Popover
            ref={popoverRef}
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="topRight"
            rootClassName="canvas-reference-tools-popover"
            arrow={false}
            align={{ offset: [0, -8] }}
            styles={{ root: { width: "min(280px, calc(100vw - 24px))" }, container: { width: "100%" }, content: { width: "100%", padding: 12 } }}
            content={
                <div className="space-y-2">
                    <div>
                        <div className="text-sm font-medium leading-5">智能引用</div>
                        <div className="mt-0.5 text-xs leading-4 text-black/50 dark:text-white/50">输入素材序号或名称后按 Tab，可快速引用</div>
                    </div>
                    <div className="flex min-h-6 items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm">
                            <Link2 className="size-3.5" />
                            AutoLink
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={autoLinkEnabled}
                            aria-label={autoLinkEnabled ? "关闭 AutoLink" : "开启 AutoLink"}
                            className="canvas-reference-autolink-switch relative inline-flex h-5 w-9 items-center rounded-full border transition-colors"
                            style={{ background: autoLinkEnabled ? `${accent}14` : "transparent", borderColor: autoLinkEnabled ? accent : "color-mix(in srgb, currentColor 22%, transparent)", color: accent }}
                            onClick={() => onAutoLinkEnabledChange(!autoLinkEnabled)}
                        >
                            <span className={`size-3.5 rounded-full shadow-sm transition-transform ${autoLinkEnabled ? "translate-x-[18px]" : "translate-x-0.5"}`} style={{ background: autoLinkEnabled ? accent : "currentColor" }} />
                        </button>
                    </div>
                    <button
                        type="button"
                        className="canvas-reference-tools-mention-button flex h-7 w-full items-center justify-center gap-2 rounded-md border px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                        style={{ borderColor: accent, color: accent, background: "transparent" }}
                        disabled={!canAutoMention}
                        onClick={onAutoMention}
                    >
                        <AtSign className="size-3.5" />
                        一键引用全文
                    </button>
                </div>
            }
        >
            <button type="button" className={`canvas-node-composer-settings-trigger canvas-node-composer-reference-tools-trigger inline-flex shrink-0 items-center gap-1 ${compact ? "is-compact" : ""}`} aria-label="打开智能引用" title="智能引用">
                <SlidersHorizontal className="size-3.5" />
                {!compact ? <span>引用</span> : null}
            </button>
        </Popover>
    );
}

export function referenceShelfHeading(references: CanvasResourceReference[]) {
    const label = references.every((reference) => reference.kind === "image" || reference.kind === "character") ? "参考图" : "参考素材";
    return `${label} · ${references.length}`;
}

export function ConnectedReferenceShelf({
    targetNodeId,
    references,
    prompt,
    theme,
    onInsert,
    onPick,
    onRemove,
    onReorder,
    onReplaceReference,
    onReplaceReferenceFiles,
}: {
    targetNodeId?: string;
    references: CanvasResourceReference[];
    prompt: string;
    theme: CanvasTheme;
    onInsert: (reference: CanvasResourceReference) => void;
    onPick?: () => void;
    onRemove?: (reference: CanvasResourceReference) => void;
    onReorder?: (orderedNodeIds: string[]) => void;
    onReplaceReference?: (oldReference: CanvasResourceReference, sourceNodeId: string) => void;
    onReplaceReferenceFiles?: (oldReference: CanvasResourceReference, files: File[]) => void;
}) {
    const { t } = useTranslation();
    const activeReferences = references.filter((item) => item.active && item.kind !== "skill" && item.kind !== "tool");
    const mentionedIds = new Set(splitMentionText(prompt, activeReferences).flatMap((part) => (part.type === "mention" ? [part.reference.id] : [])));
    const [imagePreview, setImagePreview] = useState<CanvasResourceReference | null>(null);
    const [videoPreview, setVideoPreview] = useState<CanvasResourceReference | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState("");
    useEffect(() => {
        const reference = imagePreview;
        if (!reference) return;
        const storageKey = reference.kind === "video" ? reference.previewStorageKey : reference.storageKey;
        let cancelled = false;
        setImagePreviewUrl(storageKey ? "" : reference.previewUrl || "");
        if (storageKey?.startsWith("resource:")) {
            void getResourceAccess(storageKey, "display", "original")
                .then((access) => {
                    if (!cancelled) setImagePreviewUrl(resolveResourceAccessURL(access.url));
                })
                .catch(() => {
                    if (!cancelled) setImagePreviewUrl("");
                });
        }
        return () => {
            cancelled = true;
        };
    }, [imagePreview]);
    const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null);
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    if (!activeReferences.length && !onPick) return null;

    const moveReference = (sourceId: string, targetId: string) => {
        if (!onReorder || sourceId === targetId) return;
        const sourceIndex = activeReferences.findIndex((reference) => reference.nodeId === sourceId);
        const targetIndex = activeReferences.findIndex((reference) => reference.nodeId === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const ordered = [...activeReferences];
        const [moved] = ordered.splice(sourceIndex, 1);
        ordered.splice(targetIndex, 0, moved);
        onReorder(ordered.map((reference) => reference.nodeId));
    };

    const moveReferenceByOffset = (sourceId: string, offset: -1 | 1) => {
        const sourceIndex = activeReferences.findIndex((reference) => reference.nodeId === sourceId);
        const target = activeReferences[sourceIndex + offset];
        if (!target) return;
        moveReference(sourceId, target.nodeId);
    };

    return (
        <>
            <div className="canvas-node-composer-references" role="group" aria-label="已连接素材">
                <div className="canvas-node-composer-reference-status">已连接的素材参与生成；“文中已引用”表示提示词明确提到该图。点击缩略图可放大。</div>
                <div className="canvas-node-composer-references-track thin-scrollbar">
                    {activeReferences.map((reference, index) => {
                        const canPreview =
                            (reference.kind === "image" || reference.kind === "character" || reference.kind === "video") &&
                            Boolean(reference.previewUrl || (reference.kind === "video" ? reference.previewStorageKey || reference.mediaUrl || reference.storageKey : reference.storageKey));
                        const isDropTarget = dropTargetReferenceId === reference.id;
                        return (
                            <span
                                key={reference.id}
                                className="canvas-node-reference-chip relative"
                                data-reference-chip="true"
                                data-reference-id={reference.id}
                                data-reference-node-id={reference.nodeId}
                                data-reference-label={reference.label}
                                data-reference-title={reference.title || reference.label}
                                data-target-node-id={targetNodeId}
                                data-dragging={draggedReferenceId === reference.nodeId || undefined}
                                data-drop-target={isDropTarget ? "true" : undefined}
                                onDragOver={(event) => {
                                    if (draggedReferenceId) {
                                        if (!onReorder) return;
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "move";
                                        return;
                                    }
                                    const hasImageNode = event.dataTransfer.types.includes("application/x-canvas-image-node-id");
                                    const hasFiles = event.dataTransfer.types.includes("Files");
                                    if (hasImageNode || hasFiles) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        event.dataTransfer.dropEffect = "copy";
                                        if (dropTargetReferenceId !== reference.id) {
                                            setDropTargetReferenceId(reference.id);
                                        }
                                    }
                                }}
                                onDragLeave={(event) => {
                                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                        if (dropTargetReferenceId === reference.id) {
                                            setDropTargetReferenceId(null);
                                        }
                                    }
                                }}
                                onDrop={(event) => {
                                    if (dropTargetReferenceId === reference.id) {
                                        setDropTargetReferenceId(null);
                                    }
                                    if (draggedReferenceId) {
                                        event.preventDefault();
                                        const sourceId = draggedReferenceId || event.dataTransfer.getData("text/plain");
                                        setDraggedReferenceId(null);
                                        moveReference(sourceId, reference.nodeId);
                                        return;
                                    }
                                    const sourceNodeId = event.dataTransfer.getData("application/x-canvas-image-node-id");
                                    if (sourceNodeId && sourceNodeId !== reference.nodeId && onReplaceReference) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onReplaceReference(reference, sourceNodeId);
                                        return;
                                    }
                                    const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
                                    if (files.length && onReplaceReferenceFiles) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onReplaceReferenceFiles(reference, files);
                                        return;
                                    }
                                }}
                            >
                                {onReorder ? (
                                    <button
                                        type="button"
                                        className="canvas-node-reference-drag-handle"
                                        draggable
                                        title={`拖动调整 ${reference.label} 的顺序`}
                                        aria-label={`调整 ${reference.label} 的顺序；使用左右方向键也可移动`}
                                        onDragStart={(event) => {
                                            setDraggedReferenceId(reference.nodeId);
                                            event.dataTransfer.effectAllowed = "move";
                                            event.dataTransfer.setData("text/plain", reference.nodeId);
                                        }}
                                        onDragEnd={() => setDraggedReferenceId(null)}
                                        onKeyDown={(event) => {
                                            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                            event.preventDefault();
                                            moveReferenceByOffset(reference.nodeId, event.key === "ArrowLeft" ? -1 : 1);
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                    >
                                        <GripVertical className="size-3" />
                                    </button>
                                ) : null}
                                <span className="canvas-node-reference-order" aria-hidden>
                                    {index + 1}
                                </span>
                                <button
                                    type="button"
                                    className="canvas-node-reference-preview"
                                    style={{ background: theme.toolbar.itemHover, color: theme.node.text, outlineColor: theme.node.activeStroke }}
                                    title={canPreview ? `放大 ${reference.label} · ${reference.title}` : `插入 @${reference.label}`}
                                    aria-label={canPreview ? `预览 ${reference.title}` : `插入 @${reference.label}`}
                                    onClick={() => (canPreview ? (reference.kind === "video" ? setVideoPreview(reference) : setImagePreview(reference)) : onInsert(reference))}
                                >
                                    <ReferenceThumbnail reference={reference} />
                                    {canPreview ? (
                                        <span className="canvas-node-reference-preview-hint" aria-hidden="true">
                                            <Maximize2 className="size-3" />
                                        </span>
                                    ) : null}
                                </button>
                                <button type="button" className="canvas-node-reference-label" aria-label={`插入 @${reference.label}`} title={`插入 @${reference.label} · ${reference.title}`} onClick={() => onInsert(reference)}>
                                    <span className="truncate">
                                        <span className="opacity-55">@</span>
                                        {reference.label}
                                    </span>
                                    <span className="canvas-node-reference-state">{mentionedIds.has(reference.id) ? "文中已引用" : "已连接"}</span>
                                </button>
                                {onRemove ? (
                                    <button
                                        type="button"
                                        className="canvas-node-reference-remove"
                                        style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                                        title="移除参考并删除连接"
                                        aria-label={`移除参考 ${reference.label}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onRemove(reference);
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </span>
                        );
                    })}
                    {onPick ? (
                        <button type="button" className="canvas-node-reference-add" aria-label={t("canvasB.mention.searchLabel")} title={t("canvasB.mention.searchLabel")} onMouseDown={(event) => event.preventDefault()} onClick={onPick}>
                            <Plus aria-hidden />
                        </button>
                    ) : null}
                </div>
            </div>
            {imagePreview && imagePreviewUrl ? (
                <AntImage
                    src={imagePreviewUrl}
                    alt={imagePreview.title || imagePreview.label}
                    style={{ display: "none" }}
                    preview={{
                        open: true,
                        movable: true,
                        minScale: 0.5,
                        maxScale: 12,
                        scaleStep: 0.25,
                        onOpenChange: (open) => !open && setImagePreview(null),
                    }}
                />
            ) : null}
            <AppModal open={Boolean(videoPreview)} title={videoPreview?.title || "视频预览"} width={640} footer={null} onCancel={() => setVideoPreview(null)} destroyOnHidden>
                {videoPreview ? <VideoReferenceFrame reference={videoPreview} controls className="w-full max-h-[75vh] bg-black object-contain" /> : null}
            </AppModal>
        </>
    );
}

export function ReferenceThumbnail({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && (reference.previewUrl || reference.storageKey)) return <CachedResourceImage src={reference.previewUrl} storageKey={reference.storageKey} variant="thumbnail-small" alt="" className="size-full object-cover" />;
    if (reference.kind === "video") {
        const fallback = <VideoReferenceFrame reference={reference} className="size-full bg-black object-cover" />;
        return reference.previewUrl || reference.previewStorageKey ? (
            <CachedResourceImage
                src={reference.previewUrl}
                storageKey={reference.previewStorageKey}
                variant="thumbnail-small"
                alt=""
                className="size-full bg-black object-cover"
                loading="lazy"
                decoding="async"
                fallback={fallback}
                loadingFallback={<VideoReferenceIcon />}
            />
        ) : (
            fallback
        );
    }
    if (reference.kind === "character" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full bg-black/5 object-contain" />;

    const Icon = reference.sourceType === CanvasNodeType.Drawing ? Pencil : reference.kind === "character" ? UserRound : reference.kind === "audio" ? Music2 : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-full place-items-center bg-black/10 text-current dark:bg-white/10">
            <Icon className="size-3.5 opacity-75" />
        </span>
    );
}

function VideoReferenceIcon() {
    return (
        <span className="grid size-full place-items-center bg-black/10 text-current dark:bg-white/10">
            <Video className="size-3.5 opacity-75" />
        </span>
    );
}

function VideoReferenceFrame({ reference, controls = false, className }: { reference: CanvasResourceReference; controls?: boolean; className: string }) {
    return controls ? <VideoReferencePlayer reference={reference} className={className} /> : <VideoReferencePoster reference={reference} className={className} />;
}

function VideoReferencePoster({ reference, className }: { reference: CanvasResourceReference; className: string }) {
    const [poster, setPoster] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        let localUrl = "";
        setPoster("");
        void hydrateCanvasVideoPreview({ id: reference.nodeId, metadata: { storageKey: reference.storageKey, content: reference.mediaUrl } }, controller.signal)
            .then((result) => {
                if (!result) return;
                localUrl = result.localUrl;
                if (controller.signal.aborted) URL.revokeObjectURL(localUrl);
                else setPoster(localUrl);
            })
            .catch(() => undefined);
        return () => {
            controller.abort();
            if (localUrl) URL.revokeObjectURL(localUrl);
        };
    }, [reference.nodeId, reference.mediaUrl, reference.storageKey]);
    return poster ? <img src={poster} alt="" className={className} /> : <VideoReferenceIcon />;
}

function VideoReferencePlayer({ reference, className }: { reference: CanvasResourceReference; className: string }) {
    const [source, setSource] = useState("");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setSource("");
        setFailed(false);
        void resolveVideoMediaUrl(reference.storageKey, reference.mediaUrl || "")
            .then((url) => {
                if (!cancelled) setSource(url);
            })
            .catch(() => {
                if (!cancelled) setSource(reference.mediaUrl || "");
            });
        return () => {
            cancelled = true;
        };
    }, [reference.mediaUrl, reference.storageKey]);
    if (!source || failed) return <VideoReferenceIcon />;
    return <video src={source} controls playsInline preload="metadata" aria-label={reference.title || "参考视频"} className={className} onError={() => setFailed(true)} />;
}
