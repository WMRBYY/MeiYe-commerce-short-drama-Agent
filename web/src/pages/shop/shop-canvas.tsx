import { App, Tooltip } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { WorkspaceTopBar } from "@/components/layout/workspace-top-bar";
import { ShopCanvasPanels } from "./shop-canvas-panels";
import { ShopCanvasComposer, ShopCanvasRunDetails } from "./shop-canvas-composer";
import { shopCanvasVideoSubmissionKey } from "./shop-canvas-normal-video-state";
import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { SHOP_CANVAS_TOOLS } from "./shop-canvas-catalog";
import { WorkbenchAssetPicker } from "@/pages/workbench/workbench-asset-picker";
import type { CanvasLayer, CanvasLayerSummary } from "@/pages/ecommerce/result-canvas";
import { commerceNodeReferences, reconcileCommerceLinks, type CommerceGraphNode, type ShopCanvasReferenceInput } from "./shop-canvas-graph";
import { canvasNodeMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import {
    persistableCanvasChat,
    rebindShopCanvasImageMentions,
    resolveShopCanvasTextMentions,
    shopCanvasDefaultImagePrompt,
    shopCanvasImageReferences,
    shopCanvasMentionReferences,
    shopCanvasTextInputs,
    type ShopCanvasImageReference,
} from "./shop-canvas-image-inputs";
import { tryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { FeedbackModal } from "@/components/feedback/feedback-modal";
import { defaultTryOnDraft, usesAiModel, type TryOnDraft } from "@/pages/ecommerce/tryon/tryon-plan";
import { tryOnState } from "@/pages/ecommerce/tryon/tryon-runtime";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { readShopCanvasProjects, saveShopCanvasProjects } from "./shop-canvas-projects";

import {
    EcommerceResultCanvas,
    type EcommerceCanvasContextTarget,
    type EcommerceCanvasDraftRequest,
    type EcommerceCanvasGenerationRequest,
    type EcommerceCanvasLayerCommandRequest,
    type EcommerceCanvasLayerSelectionRequest,
} from "@/pages/ecommerce/result-canvas";
import { ShopCanvasContextMenu, type ShopCanvasArrangeAction, type ShopCanvasContextMenuState } from "./shop-canvas-context-menu";
import { AppModal } from "@/components/ui/product/app-modal";
import { importResourceFromUrl, resourceStorageKey, resourceVariantUrl } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";
import { useTryOn } from "@/pages/ecommerce/tryon/use-tryon";
import { isTryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { ShopComposer } from "./shop-composer";
import { SHOP_MARKET, useShopFunction, useShopScope } from "./shop-context";
import { addChatResources, CHAT_MAX_REFS, updateChatDraft, useChatDraft, useShopEdits, type ChatDraft } from "./shop-edits";
import { useShopItems } from "./shop-items";
import { startEcommerceDownload } from "@/pages/ecommerce/export";
import type { EcommercePlanImage } from "@/services/api/ecommerce";
import { downloadBrowserMedia } from "@/services/browser-download";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { createClientUUID } from "@/lib/client-id";
import { modelDisplayName } from "@/stores/use-config-store";

import "@/pages/ecommerce/agent-theme.css";
import "@/pages/ecommerce/interaction.css";
import "@/pages/ecommerce/studio.css";
import "./shop-canvas.css";
import "./shop-canvas-workspace.css";
import "@/themes/yunhe-xianguan/fonts.css";
import "@/themes/longying-ink/fonts.css";

type RailKey = "nodes" | "workflows" | "assets" | "history";
type LinkImportKind = "image" | "video";
type ImageNodeDraft = { image: TryOnDraft; chat: ChatDraft; links: string; autoPrompt?: string };
const NODE_ITEMS = SHOP_CANVAS_TOOLS;
const ShopCanvasNormalVideo = lazy(() => import("./shop-canvas-normal-video").then((module) => ({ default: module.ShopCanvasNormalVideo })));

const RAIL_ITEMS: Array<{ key: RailKey; label: string; hint: string }> = [
    { key: "nodes", label: "添加节点", hint: "选择图片、视频、文字或其他工具" },
    { key: "workflows", label: "工作流", hint: "插入工作流或保存当前画布" },
    { key: "assets", label: "素材", hint: "查看素材并定位到画布" },
    { key: "history", label: "历史", hint: "查看本项目的创作结果" },
];

/** 电商专属画布。它只复用电商结果画布，独立挂在 /shop/canvas，不进入通用 /canvas/:id。 */
export default function ShopCanvas() {
    const navigate = useNavigate();
    const { projectId } = useParams();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const videoWorkbenchEnabled = useUserStore((state) => state.features.videoWorkbenchEnabled);
    const userId = user?.id || "guest";
    const canvasStorageKey = `shop-canvas:${userId}:${projectId}`;
    const scope = useShopScope();
    const { fn, mode, allowed, pick } = useShopFunction();
    const [canvasItems, setCanvasItems] = useState<CanvasLayerSummary[]>([]);
    const generationKeys = useMemo(() => new Set(canvasItems.flatMap((item) => (item.generationKey ? [item.generationKey] : []))), [canvasItems]);
    const watchedBatchIds = useMemo(() => new Set([...generationKeys].filter((key) => key.startsWith("t:")).map((key) => key.split(":")[1])), [generationKeys]);
    const watchedEditIds = useMemo(() => new Set([...generationKeys].filter((key) => key.startsWith("e:")).map((key) => key.slice(2))), [generationKeys]);
    const imageState = useTryOn({ scope, fn, market: SHOP_MARKET, canvasProjectId: projectId, watchedBatchIds });
    const edits = useShopEdits(scope, projectId, watchedEditIds);
    const shopItems = useShopItems(imageState, edits.records, edits.tasks);
    const generationItems = useMemo(() => shopItems.filter((item) => (projectId && item.canvasProjectId === projectId) || generationKeys.has(item.key)), [generationKeys, projectId, shopItems]);
    const generations = useMemo(
        () =>
            generationItems.flatMap((item) =>
                item.status === "loading" ? [] : [{ key: item.key, status: item.status, resourceId: item.resourceId, label: item.label, stage: item.stage, error: item.error, progress: item.progress, createdAt: item.createdAt }],
            ),
        [generationItems],
    );
    const [composerOpen, setComposerOpen] = useState(false);
    const [generationRequest, setGenerationRequest] = useState<EcommerceCanvasGenerationRequest>();
    const [referenceRequest, setReferenceRequest] = useState<{ nodeId: string; references: ShopCanvasReferenceInput[]; nonce: number; append?: boolean }>();
    const referenceNonce = useRef(0);
    const [draftRequest, setDraftRequest] = useState<EcommerceCanvasDraftRequest>();
    const [nodeAnchor, setNodeAnchor] = useState<{ x: number; y: number; connection?: { nodeId: string; side: "input" | "output" } }>();
    const [activeDraftId, setActiveDraftId] = useState<string>();
    const [editorError, setEditorError] = useState<string>();
    const [inspectedNode, setInspectedNode] = useState<CanvasLayer | null>(null);
    const openImageDraft = useRef({ open: composerOpen, id: activeDraftId });
    openImageDraft.current = { open: composerOpen, id: activeDraftId };
    const [videoNode, setVideoNode] = useState<{ id: string; kind: "normal" | "replication"; references: CommerceGraphNode[] } | null>(null);
    const handleLayerSelection = useCallback((ids: string[]) => {
        setSelectedLayerIds(ids);
        const editing = openImageDraft.current;
        if (!ids.length || (editing.id && (ids.length !== 1 || ids[0] !== editing.id))) {
            setComposerOpen(false);
            setPendingReferences(null);
        }
        setVideoNode((current) => (ids.length === 1 && ids[0] === current?.id ? current : null));
        setInspectedNode((current) => (ids.length === 1 && ids[0] === current?.id ? current : null));
    }, []);
    const [updateNodeRequest, setUpdateNodeRequest] = useState<{ id: string; patch: Partial<CanvasLayer>; nonce: number }>();
    const chatDraft = useChatDraft();
    const nodeDrafts = useRef(new Map<string, ImageNodeDraft>());
    const activeLinks = useRef("");
    const activeAutoPrompt = useRef<string | undefined>(undefined);
    const preferredSourceIds = useRef(new Map<string, string>());
    const previousPromptRefs = useRef<ShopCanvasImageReference[] | undefined>(undefined);
    const lastImageGraphRequest = useRef("");
    const [draftsReady, setDraftsReady] = useState(false);
    const draftWrites = useRef<Promise<unknown>>(Promise.resolve());
    const draftStorageKey = `shop-canvas-drafts:${projectId}`;
    useEffect(() => {
        let alive = true;
        setDraftsReady(false);
        nodeDrafts.current = new Map();
        void Promise.resolve(localForageStorageForScope(scope).getItem(draftStorageKey))
            .then((raw) => {
                if (!alive) return;
                const entries = raw ? JSON.parse(String(raw)) : [];
                if (Array.isArray(entries)) nodeDrafts.current = new Map(entries);
                setDraftsReady(true);
            })
            .catch(() => {
                if (alive) message.error("节点配置读取失败，请刷新后重试");
            });
        return () => {
            alive = false;
        };
    }, [scope, draftStorageKey]);
    const saveNodeDraft = (id: string) => {
        if (!draftsReady) return;
        nodeDrafts.current.set(id, { image: imageState.draft, chat: chatDraft, links: activeLinks.current, autoPrompt: activeAutoPrompt.current });
        const value = JSON.stringify([...nodeDrafts.current].map(([nodeId, draft]) => [nodeId, { ...draft, chat: persistableCanvasChat(draft.chat) }]));
        draftWrites.current = draftWrites.current
            .catch(() => undefined)
            .then(() => localForageStorageForScope(scope).setItem(draftStorageKey, value))
            .catch(() => message.error({ content: "节点配置未能保存，请检查本机存储空间", key: "shop-node-save" }));
    };
    const [supportOpen, setSupportOpen] = useState(false);
    const titleStorageUser = useRef(userId);
    const [activeRail, setActiveRail] = useState<RailKey | null>(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [helpTab, setHelpTab] = useState<"tutorial" | "shortcuts" | null>(null);
    const [workflowRequest, setWorkflowRequest] = useState<{ nodes: CanvasLayer[]; nonce: number }>();
    const snapshot = useRef<CanvasLayer[]>([]);
    const [graphLayers, setGraphLayers] = useState<CanvasLayer[]>([]);
    const onSnapshotChange = useCallback((nodes: CanvasLayer[]) => {
        snapshot.current = nodes;
        setGraphLayers(nodes);
        setVideoNode((active) => {
            if (!active) return active;
            if (!nodes.some((node) => node.id === active.id)) return null;
            const references = commerceNodeReferences(nodes, active.id);
            const unchanged =
                references.length === active.references.length &&
                references.every((node, index) => {
                    const previous = active.references[index];
                    return node.id === previous.id && node.type === previous.type && node.resourceId === previous.resourceId && node.text === previous.text && node.materialCategory === previous.materialCategory;
                });
            return unchanged ? active : { ...active, references };
        });
    }, []);
    const graphWithMedia = useMemo(() => {
        const resources = new Map(generations.map((item) => [item.key, item.resourceId]));
        return graphLayers.map((node) => (node.generationKey && !node.resourceId ? { ...node, resourceId: resources.get(node.generationKey) || undefined } : node));
    }, [graphLayers, generations]);
    const reduced = useReducedMotion();
    const [pendingReferences, setPendingReferences] = useState<{ kind: string; references: CommerceGraphNode[] } | null>(null);
    const [uploadRequest, setUploadRequest] = useState<number>();
    const [toolRequest, setToolRequest] = useState<{
        tool: "select" | "hand" | "text";
        nonce: number;
        text?: string;
        fontFamily?: string;
        fontSize?: number;
        color?: string;
        position?: { x: number; y: number };
        connection?: { nodeId: string; side: "input" | "output" };
        annotation?: boolean;
    }>();
    const [focusLayerRequest, setFocusLayerRequest] = useState<{
        id: string;
        nonce: number;
    }>();
    const [historyRequest, setHistoryRequest] = useState<{
        action: "undo" | "redo";
        nonce: number;
    }>();
    const [resourceRequest, setResourceRequest] = useState<{
        resourceId: string;
        kind?: "image" | "video";
        nonce: number;
    }>();
    const [canvasTitle, setCanvasTitle] = useState(() => {
        try {
            return readShopCanvasProjects(userId).find((item) => item.id === projectId)?.name || "未命名画布";
        } catch {
            return "未命名画布";
        }
    });
    const [titleReady, setTitleReady] = useState(false);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState(canvasTitle);
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [linkKind, setLinkKind] = useState<LinkImportKind>("image");
    const [linkDialogUrl, setLinkDialogUrl] = useState("");
    const [linkDialogError, setLinkDialogError] = useState("");
    const [linkDialogBusy, setLinkDialogBusy] = useState(false);
    const [historyState, setHistoryState] = useState({
        canUndo: false,
        canRedo: false,
        pastCount: 0,
    });
    const [contextMenu, setContextMenu] = useState<ShopCanvasContextMenuState | null>(null);
    const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
    const [selectLayersRequest, setSelectLayersRequest] = useState<EcommerceCanvasLayerSelectionRequest>();
    const [layerCommandRequest, setLayerCommandRequest] = useState<EcommerceCanvasLayerCommandRequest>();
    const clipboardIds = useRef<string[]>([]);
    const handleCanvasItemsChange = useCallback((items: typeof canvasItems) => {
        setCanvasItems((current) =>
            current.length === items.length &&
            current.every((item, index) => {
                const next = items[index];
                return (
                    item.id === next.id &&
                    item.type === next.type &&
                    item.label === next.label &&
                    item.resourceId === next.resourceId &&
                    item.draftKind === next.draftKind &&
                    item.generationKey === next.generationKey &&
                    item.videoProjectId === next.videoProjectId &&
                    item.videoTaskId === next.videoTaskId
                );
            })
                ? current
                : items,
        );
    }, []);
    const historyItems = useMemo(() => {
        const items = new Map(generationItems.map((item) => [item.key, { id: item.key, label: item.label, type: "image" as "image" | "video", resourceId: item.resourceId || undefined }]));
        for (const item of canvasItems) {
            if (item.generationKey && item.resourceId && !items.get(item.generationKey)?.resourceId) {
                items.set(item.generationKey, { id: item.generationKey, label: item.label, type: "image", resourceId: item.resourceId });
            }
            if ((item.videoProjectId || item.videoTaskId) && item.type === "video" && item.resourceId) {
                const id = `v:${item.videoProjectId || item.videoTaskId}`;
                items.set(id, { id, label: item.label, type: "video", resourceId: item.resourceId });
            }
        }
        return [...items.values()];
    }, [canvasItems, generationItems]);
    useEffect(() => {
        if (!titleReady || titleStorageUser.current !== userId) return;
        try {
            const projects = readShopCanvasProjects(userId);
            saveShopCanvasProjects(
                userId,
                projects.map((item) => (item.id === projectId ? { ...item, name: canvasTitle.trim() || "未命名画布", updatedAt: new Date().toISOString() } : item)),
            );
        } catch {
            // 私有浏览器存储不可用时，标题仍保留在当前画布会话中。
        }
    }, [canvasTitle, titleReady, userId, projectId]);
    useEffect(() => {
        try {
            const saved = readShopCanvasProjects(userId).find((item) => item.id === projectId)?.name || "未命名画布";
            titleStorageUser.current = userId;
            setCanvasTitle(saved);
            setTitleDraft(saved);
            setTitleReady(true);
        } catch {
            titleStorageUser.current = userId;
            setCanvasTitle("未命名画布");
            setTitleDraft("未命名画布");
            setTitleReady(true);
        }
    }, [userId, projectId]);
    const onRailClick = (key: RailKey) => {
        const next = activeRail === key ? null : key;
        if (key === "nodes") setNodeAnchor(undefined);
        setActiveRail(next);
    };

    const requestUpload = () => setUploadRequest((value) => (value || 0) + 1);

    const triggerNode = (action: (typeof NODE_ITEMS)[number]["action"], nodeId?: string) => {
        if (nodeId === "product-video" && !videoWorkbenchEnabled) {
            message.info("当前账号暂未开放视频生成");
            return;
        }
        if (action === "group") {
            if (selectedLayerIds.length < 2) {
                message.info("先框选至少两个节点，再创建分组");
                return;
            }
            setLayerCommandRequest({ action: "group", ids: selectedLayerIds, nonce: Date.now() });
        } else if (action === "text") setToolRequest({ tool: "text", nonce: Date.now(), text: nodeId === "annotation" ? "商品备注" : "输入文案", annotation: nodeId === "annotation", position: nodeAnchor, connection: nodeAnchor?.connection });
        else if (action === "workflow") setActiveRail("workflows");
        else setDraftRequest({ kind: nodeId || "chat", label: NODE_ITEMS.find((item) => item.id === nodeId)?.label || "对话生图", nonce: Date.now(), position: nodeAnchor, connection: nodeAnchor?.connection });
        if (action !== "workflow") setActiveRail(null);
    };
    const openDraft = (id: string, kind: string, references: CommerceGraphNode[] = [], config?: unknown) => {
        if (!draftsReady) {
            message.info("正在读取节点配置，请稍候");
            return;
        }
        if (kind === "inpaint") {
            message.info("画布局部重绘 · 敬请期待");
            return;
        }
        if (kind === "upload-card") return;
        if (kind === "product-video") {
            if (!videoWorkbenchEnabled) {
                message.info("当前账号暂未开放视频生成");
                return;
            }
            setInspectedNode(null);
            setVideoNode({ id, kind: "normal", references });
            setComposerOpen(false);
            setActiveRail(null);
            return;
        }
        setInspectedNode(null);
        
        setVideoNode(null);
        const next = isTryOnFunction(kind) ? kind : "chat";
        if (isTryOnFunction(next) && !allowed.includes(next)) {
            message.warning("该电商功能暂未开放");
            return;
        }
        const copiedConfig = config ?? snapshot.current.find((n) => n.id === id)?.config;
        if (copiedConfig && !nodeDrafts.current.has(id)) nodeDrafts.current.set(id, copiedConfig as ImageNodeDraft);
        if (activeDraftId === id && composerOpen) return;
        if (activeDraftId && composerOpen && !pendingReferences) saveNodeDraft(activeDraftId);
        setActiveDraftId(id);
        setEditorError(undefined);
        pick(next);
        setPendingReferences({ kind, references });
        setComposerOpen(true);
        setActiveRail(null);
    };
    const inspectGeneration = (node: CanvasLayer) => {
        if (activeDraftId === node.id && composerOpen) return;
        setComposerOpen(false);
        setActiveDraftId(undefined);
        setPendingReferences(null);
        setVideoNode(null);
        setActiveRail(null);
        setInspectedNode(node);
    };
    useEffect(() => {
        if (!pendingReferences) return;
        const { kind, references } = pendingReferences;
        const next = isTryOnFunction(kind) ? kind : "chat";
        if (mode !== next || (next !== "chat" && imageState.draft.fn !== next)) return;
        const saved = activeDraftId ? nodeDrafts.current.get(activeDraftId) : undefined;
        const links = JSON.stringify(references.map((r) => [r.id, r.resourceId, r.type === "text" ? r.text : null]));
        activeLinks.current = links;
        activeAutoPrompt.current = saved?.autoPrompt;
        preferredSourceIds.current = new Map(references.flatMap((node) => (node.resourceId ? [[node.resourceId, node.id] as const] : [])));
        previousPromptRefs.current = undefined;
        lastImageGraphRequest.current = "";
        imageState.update({ ...defaultTryOnDraft(), imageModel: imageState.imageModel, ratio: imageState.ratio, resolution: imageState.resolution, ...saved?.image, fn: imageState.draft.fn });
        if (saved?.chat && saved.links === links) {
            updateChatDraft(() => saved.chat);
            setPendingReferences(null);
            return;
        }
        const images = references.filter((r) => r.resourceId && r.type !== "video" && r.type !== "audio");
        const templatePrompt = snapshot.current.find((node) => node.id === activeDraftId)?.prompt;
        const savedPrompt = next === "chat" ? saved?.chat.text : saved?.image.notes;
        const startingPrompt = savedPrompt ?? templatePrompt ?? "";
        const linked = reconcileCommerceLinks(
            saved?.links,
            references.filter((node) => !startingPrompt.includes(canvasNodeMentionToken(node.id))),
            startingPrompt,
        );
        if (!saved && !templatePrompt && !linked.text) activeAutoPrompt.current = "";
        const incomingResourceIds = new Set(images.map((ref) => ref.resourceId));
        const keep = (resourceId: string) => !linked.previousResourceIds.has(resourceId) || incomingResourceIds.has(resourceId);
        if (next === "chat") {
            updateChatDraft(() => ({ count: saved?.chat.count || 1, text: linked.text, refs: (saved?.chat.refs || []).filter((ref) => keep(ref.resourceId)) }));
            addChatResources(images.map((r) => ({ resourceId: r.resourceId!, name: r.text || "画布参考图" })));
        } else {
            const slots = tryOnFunction(next).slots;
            const retained = (saved?.image.images?.[next] || []).filter((ref) => keep(ref.resourceId));
            const imageMap: typeof imageState.draft.images = { ...saved?.image.images, [next]: retained };
            imageState.update({ images: imageMap, notes: linked.text });
            const incoming = images.filter((image) => !retained.some((ref) => ref.resourceId === image.resourceId));
            let index = 0;
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                const occupied = retained.filter((ref) => ref.slot === slot.key).length;
                const remainingMinimum = slots.slice(i + 1).reduce((sum, s) => sum + Math.max(0, s.min - retained.filter((ref) => ref.slot === s.key).length), 0);
                const take = Math.min(Math.max(0, slot.max - occupied), Math.max(slot.min - occupied, incoming.length - index - remainingMinimum));
                const picked = incoming.slice(index, index + take);
                if (picked.length)
                    imageState.addResources(
                        slot.key,
                        picked.map((r) => ({ resourceId: r.resourceId!, name: r.text || slot.label })),
                    );
                index += picked.length;
            }
        }
        setPendingReferences(null);
    }, [pendingReferences, mode, imageState.draft.fn]);

    const editingLayer = graphLayers.find((node) => node.id === activeDraftId);
    const promptText = mode === "chat" ? chatDraft.text : imageState.draft.notes;
    const imageReferences = useMemo(() => shopCanvasImageReferences(mode, imageState.draft, chatDraft), [mode, imageState.draft, chatDraft.refs]);
    const imageMentionReferences = useMemo(
        () => shopCanvasMentionReferences(graphWithMedia, activeDraftId).flatMap((ref) => (ref.kind === "image" || ref.kind === "text" ? [{ ...ref, active: ref.kind === "text" && promptText.includes(ref.mentionToken || "") }] : [])),
        [graphWithMedia, activeDraftId, promptText],
    );
    const videoMentionReferences = useMemo(() => shopCanvasMentionReferences(graphWithMedia, videoNode?.id), [graphWithMedia, videoNode?.id]);
    const currentImageInputs = (): ShopCanvasReferenceInput[] => [
        ...imageReferences.map((ref): ShopCanvasReferenceInput => ({
            kind: "image",
            nodeId: preferredSourceIds.current.get(ref.resourceId),
            resourceId: ref.resourceId,
            name: ref.name,
        })),
        ...shopCanvasTextInputs(promptText, graphWithMedia),
    ];

    useEffect(() => {
        if (!composerOpen || !activeDraftId || pendingReferences || !editingLayer) return;
        const suggested = shopCanvasDefaultImagePrompt(editingLayer.draftKind || mode, imageReferences);
        const previous = previousPromptRefs.current;
        const automatic = activeAutoPrompt.current !== undefined && promptText === activeAutoPrompt.current;
        const nextPrompt = automatic ? suggested : previous ? rebindShopCanvasImageMentions(promptText, previous, imageReferences) : promptText;
        previousPromptRefs.current = imageReferences;
        if (automatic) activeAutoPrompt.current = suggested;
        if (nextPrompt === promptText) return;
        if (mode === "chat") updateChatDraft((draft) => ({ ...draft, text: nextPrompt }));
        else imageState.update({ notes: nextPrompt });
    }, [composerOpen, activeDraftId, pendingReferences, editingLayer, mode, imageReferences, promptText]);

    useEffect(() => {
        if (!composerOpen || !activeDraftId || pendingReferences || editingLayer?.type !== "draft") return;
        const references = currentImageInputs();
        const signature = JSON.stringify([activeDraftId, references]);
        if (lastImageGraphRequest.current === signature) return;
        lastImageGraphRequest.current = signature;
        setReferenceRequest({ nodeId: activeDraftId, references, nonce: ++referenceNonce.current });
    }, [composerOpen, activeDraftId, pendingReferences, editingLayer?.type, imageReferences, promptText, graphWithMedia]);

    const selectImageMention = (ref: CanvasResourceReference): CanvasResourceReference | undefined => {
        if (ref.kind === "text") return { ...ref, active: true };
        const source = graphWithMedia.find((node) => node.id === ref.nodeId);
        const resourceId = source?.resourceId;
        if (!source || !resourceId) return undefined;
        const bound = imageReferences.find((item) => item.resourceId === resourceId);
        if (bound) {
            preferredSourceIds.current.set(resourceId, source.id);
            return { ...ref, active: true, label: bound.label, mentionToken: `@${bound.label}` };
        }
        let label: string | undefined;
        if (mode === "chat") {
            if (chatDraft.refs.length >= CHAT_MAX_REFS) {
                message.info(`最多添加 ${CHAT_MAX_REFS} 张参考图，可先移除一张再引用`);
                return undefined;
            }
            addChatResources([{ resourceId, name: ref.label }]);
            label = `图${imageReferences.length + 1}`;
        } else {
            const slots = tryOnFunction(mode).slots.filter((slot) => slot.key !== "model" || !usesAiModel(imageState.draft));
            const free = slots.filter((slot) => imageState.slotImages(slot.key).length < slot.max);
            const slot = free.find((item) => item.key === source.materialCategory) || free.find((item) => imageState.slotImages(item.key).length < item.min) || free[0];
            if (!slot) {
                message.info("参考图已满，可先移除一张再引用");
                return undefined;
            }
            imageState.addResources(slot.key, [{ resourceId, name: ref.label }]);
            const updated = shopCanvasImageReferences(mode, tryOnState(scope).draft, chatDraft);
            label = updated.find((item) => item.resourceId === resourceId)?.label;
        }
        if (!label) return undefined;
        preferredSourceIds.current.set(resourceId, source.id);
        return { ...ref, active: true, label, mentionToken: `@${label}` };
    };

    const activeVideoLayer = graphLayers.find((node) => node.id === videoNode?.id);
    const videoRunStatus = activeVideoLayer && !activeVideoLayer.videoFailed && (activeVideoLayer.videoTaskId || activeVideoLayer.videoProjectId) ? (activeVideoLayer.resourceId ? "视频已完成" : activeVideoLayer.videoStage || "视频正在生成") : undefined;
    const videoDraftRefs = useRef<{ id: string; media: ShopCanvasReferenceInput[]; text: ShopCanvasReferenceInput[] } | undefined>(undefined);
    const updateVideoReferences = (id: string, references: ShopCanvasReferenceInput[], appendText = false) => {
        const target = snapshot.current.find((node) => node.id === id);
        if (!target || target.type !== "draft") return;
        if (videoDraftRefs.current?.id !== id) {
            const text =
                target.draftKind === "video-replace" ? (target.managedInputIds || []).flatMap((nodeId): ShopCanvasReferenceInput[] => (snapshot.current.some((node) => node.id === nodeId && node.type === "text") ? [{ kind: "text", nodeId }] : [])) : [];
            videoDraftRefs.current = { id, media: [], text };
        }
        const draft = videoDraftRefs.current;
        if (appendText) draft.text = [...draft.text.filter((ref) => ref.nodeId !== references[0]?.nodeId), ...references];
        else draft.media = references;
        setReferenceRequest({ nodeId: id, references: [...draft.media, ...draft.text], nonce: ++referenceNonce.current });
    };
    const reuseVideo = () => {
        if (!activeVideoLayer?.resourceId || !videoNode) return;
        const kind = "product-video";
        const config = undefined;
        setDraftRequest({ kind, label: NODE_ITEMS.find((item) => item.id === kind)?.label || "视频生成", reuse: { sourceId: activeVideoLayer.id, config }, nonce: Date.now() });
    };
    useEffect(() => {
        if (activeDraftId && composerOpen && !pendingReferences) saveNodeDraft(activeDraftId);
    }, [activeDraftId, composerOpen, pendingReferences, imageState.draft, chatDraft]);
    useEffect(() => {
        const close = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || (event.target instanceof Element && event.target.closest(".ant-modal, .ant-drawer, [role='dialog']"))) return;
            setActiveRail(null);
            setComposerOpen(false);
            setPendingReferences(null);
            setVideoNode(null);
            setInspectedNode(null);
            setHelpTab(null);
            setLinkDialogOpen(false);
        };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, []);

    const finishTitleEdit = () => {
        const next = titleDraft.trim() || "未命名画布";
        setCanvasTitle(next);
        setTitleDraft(next);
        setTitleEditing(false);
    };

    const selectedItems = canvasItems.filter((item) => selectedLayerIds.includes(item.id));
    const downloadableCount = selectedItems.filter((item) => (item.type === "image" || item.type === "video") && item.resourceId).length;
    const inspectedItem = inspectedNode?.generationKey ? generationItems.find((item) => item.key === inspectedNode.generationKey) : undefined;
    const inspectedKind = inspectedItem?.tryOnFn || inspectedNode?.draftKind || "chat";
    const inspectedBatch = inspectedItem?.batchId ? imageState.batches.find((batch) => batch.id === inspectedItem.batchId) : undefined;
    const inspectedDraft = inspectedNode ? nodeDrafts.current.get(inspectedNode.id) || (inspectedNode.config as ImageNodeDraft | undefined) : undefined;
    const inspectedImage = inspectedBatch?.source || inspectedDraft?.image;
    const inspectedRefs =
        (inspectedItem?.references.length ? inspectedItem.references : undefined) ||
        (inspectedKind === "chat" ? inspectedDraft?.chat.refs.map((ref) => ref.resourceId) : isTryOnFunction(inspectedKind) ? inspectedImage?.images?.[inspectedKind]?.map((ref) => ref.resourceId) : []) ||
        [];
    const inspectedOutput = inspectedItem?.resourceId || canvasItems.find((item) => item.id === inspectedNode?.id)?.resourceId || inspectedNode?.resourceId;
    const inspectedStatus = inspectedOutput ? "done" : inspectedItem?.status;
    useEffect(() => {
        if (!inspectedNode || !draftsReady || (inspectedStatus !== "done" && inspectedStatus !== "failed")) return;
        const kind = isTryOnFunction(inspectedKind) && !allowed.includes(inspectedKind) ? "chat" : inspectedKind;
        const config: ImageNodeDraft = inspectedDraft || {
            image: {
                ...(inspectedImage ?? defaultTryOnDraft()),
                imageModel: inspectedImage?.imageModel || inspectedItem?.model || "",
                ratio: inspectedImage?.ratio || inspectedItem?.ratio || "",
                resolution: inspectedImage?.resolution || inspectedItem?.resolution || "",
            },
            chat: {
                count: 1,
                text: inspectedItem?.text || "",
                refs: inspectedRefs.map((resourceId) => ({ id: createClientUUID(), resourceId, name: "参考图", previewUrl: resourceVariantUrl(resourceId, "thumbnail") })),
            },
            links: "[]",
        };
        const references = commerceNodeReferences(graphWithMedia, inspectedNode.id);
        // Older results can have task materials without persisted graph inputs.
        const known = new Set(references.map((ref) => ref.resourceId));
        const restored = inspectedRefs.filter((id) => !known.has(id)).map((id) => ({ id: `reference-${id}`, type: "image", resourceId: id, text: "参考图" }));
        openDraft(inspectedNode.id, kind, [...references, ...restored], config);
        if (inspectedStatus === "failed") setEditorError(inspectedItem?.error || "图片生成失败，请调整后重试");
    }, [inspectedNode, inspectedStatus, draftsReady]);
    const openContextMenu = (event: ReactMouseEvent, target?: EcommerceCanvasContextTarget) => {
        event.preventDefault();
        if (target?.type === "result") {
            setContextMenu({ scope: "node", x: event.clientX, y: event.clientY, selectedCount: 1, downloadableCount: 1, canGenerate: true, canUndo: historyState.canUndo, canRedo: historyState.canRedo });
            return;
        }
        const ids = !target ? [] : !selectedLayerIds.includes(target.id) ? [target.id] : selectedLayerIds;
        if (!target) {
            setSelectedLayerIds([]);
            setSelectLayersRequest({ ids: [], nonce: Date.now() });
        }
        if (target && !selectedLayerIds.includes(target.id)) {
            setSelectedLayerIds(ids);
            setSelectLayersRequest({ ids, nonce: Date.now() });
        }
        const items = canvasItems.filter((item) => ids.includes(item.id));
        setContextMenu({
            scope: ids.length > 1 ? "selection" : target ? "node" : "canvas",
            x: event.clientX,
            y: event.clientY,
            selectedCount: ids.length,
            downloadableCount: items.filter((item) => (item.type === "image" || item.type === "video") && item.resourceId).length,
            canGenerate: items.some((item) => item.type === "draft" || (item.type === "image" && item.resourceId)),
            canPaste: clipboardIds.current.length > 0,
            canUndo: historyState.canUndo,
            canRedo: historyState.canRedo,
        });
    };
    useEffect(() => {
        const failed = (event: Event) => {
            const detail = (event as CustomEvent<{ owner: string; message: string }>).detail;
            if (detail?.owner === scope && getActiveUserScope() === scope) message.error(detail.message);
        };
        window.addEventListener("commerce-download-error", failed);
        return () => window.removeEventListener("commerce-download-error", failed);
    }, [message, scope]);
    const downloadSelected = () => {
        const images = [...new Set(selectedItems.filter((item) => item.type === "image" && item.resourceId).map((item) => item.resourceId!))];
        const videos = [...new Set(selectedItems.filter((item) => item.type === "video" && item.resourceId).map((item) => item.resourceId!))];
        if (images.length > 500) {
            message.warning("每次最多下载 500 张图片，请分批选择");
            return;
        }
        if (images.length) startEcommerceDownload(images.map((resourceId, index) => ({ image: { imageType: "single" } as EcommercePlanImage, assetId: "", index, resourceId })));
        void Promise.all(videos.map((id, index) => downloadBrowserMedia({ storageKey: resourceStorageKey(id), fileName: `电商视频-${index + 1}.mp4` }))).catch((error) => message.error(error instanceof Error ? error.message : "视频下载失败，请重试"));
    };
    const copySelected = () => {
        clipboardIds.current = [...selectedLayerIds];
        message.success(`已复制 ${selectedLayerIds.length} 个电商节点`);
    };
    const deleteSelected = () => {
        setLayerCommandRequest({ action: "delete", ids: selectedLayerIds, nonce: Date.now() });
        setSelectedLayerIds([]);
        message.info("已删除选中节点");
    };
    const duplicateSelected = () => {
        setLayerCommandRequest({ action: "duplicate", ids: selectedLayerIds, nonce: Date.now() });
        message.success("已复制节点");
    };
    const arrangeSelected = (action: ShopCanvasArrangeAction) => {
        setLayerCommandRequest({ action: "arrange", ids: selectedLayerIds, arrangeAction: action, nonce: Date.now() });
    };
    const bringSelectedToFront = () => {
        setLayerCommandRequest({ action: "bring-front", ids: selectedLayerIds, nonce: Date.now() });
    };
    const sendSelectedToBack = () => {
        setLayerCommandRequest({ action: "send-back", ids: selectedLayerIds, nonce: Date.now() });
    };
    const generateSelected = () => {
        const draftNode = selectedItems.find((item) => item.type === "draft");
        if (draftNode) {
            openDraft(draftNode.id, draftNode.draftKind || "chat", commerceNodeReferences(snapshot.current, draftNode.id));
            return;
        }
        const refs = selectedItems.filter((item) => item.type === "image" && item.resourceId).map((item) => `primary:${item.resourceId}`);
        if (!refs.length) {
            message.info("请先框选至少一张商品图片");
            return;
        }
        setActiveDraftId(undefined);
        setInspectedNode(null);
        pick("chat");
        updateChatDraft((draft) => ({ ...draft, text: "使用画布框选素材生成电商商品视觉", refs: [] }));
        addChatResources(refs.map((value) => ({ resourceId: value.slice("primary:".length), name: "画布素材" })));
        if (refs.length > 6) message.info("对话生图最多使用 6 张参考图，已带入前 6 张");
        setComposerOpen(true);
    };
    const pasteSelected = () => {
        if (clipboardIds.current.length) setLayerCommandRequest({ action: "duplicate", ids: clipboardIds.current, nonce: Date.now() });
    };
    const openCreator = () => generateSelected();
    const flipSelected = (axis: "flip-horizontal" | "flip-vertical") => setLayerCommandRequest({ action: axis, ids: selectedLayerIds, nonce: Date.now() });
    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(selectedItems.map((item) => item.label).join("\n"));
            message.success("节点名称已复制到剪贴板");
        } catch {
            message.info("当前浏览器不允许访问剪贴板");
        }
    };

    const importCanvasLink = async () => {
        const url = linkDialogUrl.trim();
        if (!url) {
            setLinkDialogError(`请粘贴${linkKind === "video" ? "视频" : "图片"}链接`);
            return;
        }
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            setLinkDialogError("请输入完整的 http 或 https 链接");
            return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            setLinkDialogError("只支持 http 或 https 链接");
            return;
        }
        setLinkDialogBusy(true);
        setLinkDialogError("");
        try {
            const resource = await importResourceFromUrl(parsed.toString(), linkKind);
            if (linkKind === "image") {
                setResourceRequest({ resourceId: resource.id, kind: "image", nonce: Date.now() });
                message.success("图片已解析并放入画布");
            } else {
                setResourceRequest({ resourceId: resource.id, kind: "video", nonce: Date.now() });
                message.success("视频已解析并放入画布");
            }
            setLinkDialogUrl("");
            setLinkDialogOpen(false);
        } catch (error) {
            setLinkDialogError(error instanceof Error ? error.message || "解析失败，请检查链接后重试" : "解析失败，请检查链接后重试");
        } finally {
            setLinkDialogBusy(false);
        }
    };

    const linkDialog = (
        <AppModal open={linkDialogOpen} onCancel={() => setLinkDialogOpen(false)} flush footer={null} width={600} closable={false}>
            <section className="sp-canvas-link-dialog ms-scope" aria-labelledby="sp-canvas-link-dialog-title" data-canvas-no-zoom>
                <header>
                    <div>
                        <small>导入电商素材</small>
                        <h2 id="sp-canvas-link-dialog-title">解析链接上传</h2>
                    </div>
                    <button type="button" onClick={() => setLinkDialogOpen(false)} aria-label="关闭解析链接弹窗">
                        <ShopCanvasGlyph name="close" size={18} />
                    </button>
                </header>
                <p>支持商品图片链接和抖音、快手、小红书、视频号分享链接。解析成功后，素材会进入电商画布或视频素材库。</p>
                <div className="sp-canvas-link-dialog-tabs" role="tablist" aria-label="素材类型">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={linkKind === "image"}
                        data-active={linkKind === "image" || undefined}
                        onClick={() => {
                            setLinkKind("image");
                            setLinkDialogError("");
                        }}
                    >
                        图片链接
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={linkKind === "video"}
                        data-active={linkKind === "video" || undefined}
                        onClick={() => {
                            setLinkKind("video");
                            setLinkDialogError("");
                        }}
                    >
                        视频链接
                    </button>
                </div>
                <label className="sp-canvas-link-dialog-input">
                    <span>{linkKind === "video" ? "视频分享链接" : "商品图片链接"}</span>
                    <input
                        value={linkDialogUrl}
                        onChange={(event) => {
                            setLinkDialogUrl(event.target.value);
                            if (linkDialogError) setLinkDialogError("");
                        }}
                        placeholder={linkKind === "video" ? "粘贴视频链接或分享文案" : "https://example.com/product.jpg"}
                        autoFocus
                    />
                </label>
                {linkDialogError ? (
                    <p className="sp-canvas-link-dialog-error" role="alert">
                        {linkDialogError}
                    </p>
                ) : null}
                <footer>
                    <button type="button" className="sp-canvas-link-dialog-cancel" onClick={() => setLinkDialogOpen(false)}>
                        取消
                    </button>
                    <button type="button" className="sp-canvas-link-dialog-confirm" disabled={linkDialogBusy || !linkDialogUrl.trim()} onClick={() => void importCanvasLink()}>
                        {linkDialogBusy ? "解析中…" : "确定并上传"}
                    </button>
                </footer>
            </section>
        </AppModal>
    );

    return (
        <main className="sp-canvas-page ms-scope" aria-label="电商画布">
            <header className="sp-canvas-topbar">
                <div className="sp-canvas-title-group" data-canvas-no-zoom>
                    <button type="button" className="sp-canvas-back" onClick={() => navigate("/shop/canvas")} aria-label="返回电商画布项目" title="返回电商画布项目">
                        <ShopCanvasGlyph name="back" size={17} />
                    </button>
                    <div className="sp-canvas-title-edit-wrap">
                        {titleEditing ? (
                            <input
                                className="sp-canvas-title-input"
                                value={titleDraft}
                                autoFocus
                                aria-label="画布名称"
                                onChange={(event) => setTitleDraft(event.target.value)}
                                onBlur={finishTitleEdit}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") finishTitleEdit();
                                    if (event.key === "Escape") {
                                        setTitleDraft(canvasTitle);
                                        setTitleEditing(false);
                                    }
                                }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="sp-canvas-title-button"
                                onClick={() => {
                                    setTitleDraft(canvasTitle);
                                    setTitleEditing(true);
                                }}
                                aria-label="修改画布名称"
                                title={canvasTitle}
                            >
                                <strong>{canvasTitle}</strong>
                                <ShopCanvasGlyph name="edit" size={14} />
                            </button>
                        )}
                        <span>电商画布 · 本机工作区</span>
                    </div>
                </div>
                <WorkspaceTopBar floating sidebarOpen={false} onToggleSidebar={() => {}} />
            </header>
            <div className="sp-canvas-shell">
                <nav className="sp-canvas-rail" aria-label="画布工具" data-canvas-no-zoom data-canvas-wheel-scroll>
                    <div className="sp-canvas-rail-items">
                        {RAIL_ITEMS.map(({ key, label, hint }) => (
                            <Tooltip key={key} title={activeRail === key ? undefined : hint} placement="right" trigger={["hover", "focus"]} mouseEnterDelay={0.22} classNames={{ root: "sp-canvas-tooltip ms-scope", container: "sp-canvas-tooltip-panel" }}>
                                <motion.button
                                    type="button"
                                    className="sp-canvas-rail-item"
                                    data-active={activeRail === key || undefined}
                                    onClick={() => onRailClick(key)}
                                    aria-label={label}
                                    aria-pressed={activeRail === key}
                                    whileTap={reduced ? undefined : { scale: 0.97 }}
                                >
                                    <ShopCanvasGlyph name={key} />
                                    <span>{label}</span>
                                </motion.button>
                            </Tooltip>
                        ))}
                    </div>
                    <div className="sp-canvas-rail-divider" />
                    <Tooltip title="帮助中心 · 使用教程与快捷键" placement="right">
                        <button className="sp-canvas-rail-item" onClick={() => setHelpTab("tutorial")} aria-label="帮助中心">
                            <ShopCanvasGlyph name="help" />
                            <span>帮助</span>
                        </button>
                    </Tooltip>
                    <Tooltip title="联系支持 · 打开反馈窗口" placement="right">
                        <button className="sp-canvas-rail-item" onClick={() => setSupportOpen(true)} aria-label="联系客服">
                            <ShopCanvasGlyph name="support" />
                            <span>客服</span>
                        </button>
                    </Tooltip>
                </nav>
                <div className="sp-canvas-workspace">
                    <ShopCanvasPanels
                        panel={activeRail}
                        anchor={nodeAnchor}
                        connectionNode={snapshot.current.find((node) => node.id === nodeAnchor?.connection?.nodeId)}
                        projectName={canvasTitle}
                        onClose={() => setActiveRail(null)}
                        onAdd={(item) => triggerNode(item.action, item.id)}
                        onUpload={requestUpload}
                        onLibrary={() => setLibraryOpen(true)}
                        items={canvasItems}
                        historyItems={historyItems}
                        onUseHistory={(item) => {
                            if (item.resourceId) setResourceRequest({ resourceId: item.resourceId, kind: item.type === "video" ? "video" : "image", nonce: Date.now() });
                            else message.info("生成结果尚未就绪，请稍后查看");
                        }}
                        onFocus={(id) => {
                            setFocusLayerRequest({ id, nonce: Date.now() });
                            setActiveRail(null);
                        }}
                        scope={scope}
                        onSave={() => snapshot.current.map((n) => ({ ...n, config: nodeDrafts.current.get(n.id) || n.config }))}
                        onInsert={(nodes) => {
                            setWorkflowRequest({ nodes, nonce: Date.now() });
                            setActiveRail(null);
                        }}
                    />
                    <EcommerceResultCanvas
                        key={canvasStorageKey}
                        children={null}
                        count={0}
                        ratio="1:1"
                        storageKey={canvasStorageKey}
                        persistenceScope={scope}
                        updateNodeRequest={updateNodeRequest}
                        toolRequest={toolRequest}
                        uploadRequest={uploadRequest}
                        focusLayerRequest={focusLayerRequest}
                        resourceRequest={resourceRequest}
                        onCanvasContextMenu={openContextMenu}
                        onSelectLayers={handleLayerSelection}
                        selectLayersRequest={selectLayersRequest}
                        layerCommandRequest={layerCommandRequest}
                        onCanvasItemsChange={handleCanvasItemsChange}
                        historyRequest={historyRequest}
                        onHistoryStateChange={setHistoryState}
                        generationRequest={generationRequest}
                        referenceRequest={referenceRequest}
                        generations={generations}
                        draftRequest={draftRequest}
                        onOpenDraft={openDraft}
                        onInspectGeneration={inspectGeneration}
                        onConnectionDrop={(anchor) => {
                            setNodeAnchor(anchor);
                            setActiveRail("nodes");
                        }}
                        actions={null}
                        graphEnabled
                        workflowRequest={workflowRequest}
                        onSnapshotChange={onSnapshotChange}
                    />
                    {selectedLayerIds.length > 1 ? (
                        <div className="sp-canvas-selection-actions" data-canvas-no-zoom>
                            <span>已选 {selectedLayerIds.length} 个节点</span>
                            <button type="button" disabled={!downloadableCount} onClick={downloadSelected}>
                                下载素材
                            </button>
                            <button type="button" disabled={!selectedItems.some((item) => item.type === "draft" || (item.type === "image" && item.resourceId))} onClick={generateSelected}>
                                生成图片
                            </button>
                            <button type="button" onClick={() => setLayerCommandRequest({ action: "group", ids: selectedLayerIds, nonce: Date.now() })}>
                                分组
                            </button>
                            <button type="button" onClick={() => setLayerCommandRequest({ action: "ungroup", ids: selectedLayerIds, nonce: Date.now() })}>
                                取消分组
                            </button>
                            <button type="button" onClick={() => arrangeSelected("grid")}>
                                网格排列
                            </button>
                            <button type="button" onClick={() => arrangeSelected("row")}>
                                横向排列
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>
            <ShopCanvasContextMenu
                menu={contextMenu}
                onClose={() => setContextMenu(null)}
                onUpload={requestUpload}
                onParseLinkUpload={() => {
                    setLinkKind("image");
                    setLinkDialogUrl("");
                    setLinkDialogError("");
                    setLinkDialogOpen(true);
                }}
                onAddNode={() => {
                    setNodeAnchor(contextMenu ? { x: contextMenu.x, y: contextMenu.y } : undefined);
                    setActiveRail("nodes");
                }}
                onAddNote={() => setToolRequest({ tool: "text", nonce: Date.now(), text: "商品备注", annotation: true, position: contextMenu || undefined })}
                onAddCopy={() => setToolRequest({ tool: "text", nonce: Date.now(), text: "商品卖点文案", fontSize: 32, position: contextMenu || undefined })}
                onUndo={() => setHistoryRequest({ action: "undo", nonce: Date.now() })}
                onRedo={() => setHistoryRequest({ action: "redo", nonce: Date.now() })}
                onPaste={pasteSelected}
                onDownload={downloadSelected}
                onGenerate={generateSelected}
                onArrange={arrangeSelected}
                onBringToFront={bringSelectedToFront}
                onSendToBack={sendSelectedToBack}
                onCopy={duplicateSelected}
                onGroupCopy={duplicateSelected}
                onOpenCreator={openCreator}
                onFlipHorizontal={() => flipSelected("flip-horizontal")}
                onFlipVertical={() => flipSelected("flip-vertical")}
                onCopyToClipboard={() => void copyToClipboard()}
                onDelete={deleteSelected}
            />
            <ShopCanvasComposer
                editor="image"
                open={composerOpen}
                nodeId={activeDraftId}
                title={canvasItems.find((i) => i.id === activeDraftId)?.label || "对话生图"}
                onClose={() => {
                    if (activeDraftId && !pendingReferences) saveNodeDraft(activeDraftId);
                    setComposerOpen(false);
                    setPendingReferences(null);
                    setActiveDraftId(undefined);
                }}
            >
                {editorError ? (
                    <p className="sp-canvas-editor-error" role="alert">
                        {editorError}
                    </p>
                ) : null}
                {edits.loaded && !pendingReferences ? (
                    <ShopComposer
                        key={activeDraftId || "unbound"}
                        managed
                        modelBoundCount
                        canvasProjectId={projectId}
                        variant="dock"
                        canvasReferences={imageMentionReferences}
                        onCanvasReferenceSelect={selectImageMention}
                        resolveCanvasPrompt={(prompt) => resolveShopCanvasTextMentions(prompt, graphWithMedia)}
                        state={imageState}
                        allowed={allowed}
                        mode={mode}
                        onPickFunction={pick}
                        onSubmitted={(keys) => {
                            setGenerationRequest({
                                keys,
                                nonce: Date.now(),
                                targetId: activeDraftId,
                                references: currentImageInputs(),
                                submitted: {
                                    draftKind: mode,
                                    text: editingLayer?.text || (mode === "chat" ? "对话生图" : tryOnFunction(mode).label),
                                    config: {
                                        image: mode === "chat" ? imageState.draft : { ...imageState.draft, imageModel: imageState.imageModel, ratio: imageState.ratio, resolution: imageState.resolution, count: imageState.count },
                                        chat: persistableCanvasChat(chatDraft),
                                        links: activeLinks.current,
                                        autoPrompt: activeAutoPrompt.current,
                                    } satisfies ImageNodeDraft,
                                },
                            });
                            if (openImageDraft.current.id === activeDraftId) {
                                setComposerOpen(false);
                                setActiveDraftId(undefined);
                            }
                        }}
                    />
                ) : (
                    <p role="status">正在读取节点配置…</p>
                )}
            </ShopCanvasComposer>
            <ShopCanvasComposer inspect open={Boolean(inspectedNode)} nodeId={inspectedNode?.id} title={inspectedItem?.label || inspectedNode?.text || "图片生成配置"} onClose={() => setInspectedNode(null)}>
                {inspectedNode ? (
                    <ShopCanvasRunDetails
                        status={inspectedStatus}
                        stage={inspectedItem?.stage}
                        error={inspectedItem?.error}
                        progress={inspectedItem?.progress}
                        prompt={inspectedKind === "chat" ? (inspectedItem?.text ?? inspectedDraft?.chat.text) : (inspectedImage?.notes ?? inspectedItem?.text)}
                        modelLabel={inspectedItem?.modelLabel || (inspectedImage?.imageModel ? modelDisplayName(imageState.config, inspectedImage.imageModel) : undefined)}
                        ratio={inspectedItem?.ratio || inspectedImage?.ratio}
                        resolution={inspectedItem?.resolution || inspectedImage?.resolution}
                        references={inspectedRefs}
                    />
                ) : null}
            </ShopCanvasComposer>
            <ShopCanvasComposer inspect={videoNode?.kind === "normal"} open={Boolean(videoNode)} nodeId={videoNode?.id} title={videoNode?.kind === "normal" ? "视频生成" : "模特 / 商品替换"} onClose={() => setVideoNode(null)}>
                {videoNode?.kind === "normal" ? (
                    <Suspense fallback={<p role="status">正在打开视频配置…</p>}>
                        <ShopCanvasNormalVideo
                            key={videoNode.id}
                            scope={scope}
                            submissionKey={shopCanvasVideoSubmissionKey(canvasStorageKey, videoNode.id)}
                            draft={snapshot.current.find((node) => node.id === videoNode.id)?.normalVideoDraft}
                            linkSignature={snapshot.current.find((node) => node.id === videoNode.id)?.normalVideoLinks}
                            prompt={snapshot.current.find((node) => node.id === videoNode.id)?.prompt}
                            references={videoNode.references}
                            canvasReferences={videoMentionReferences}
                            onReferenceChange={(refs) => updateVideoReferences(videoNode.id, refs)}
                            runStatus={videoRunStatus}
                            onReuse={activeVideoLayer?.resourceId ? reuseVideo : undefined}
                            failedTaskId={snapshot.current.find((node) => node.id === videoNode.id && node.videoFailed)?.videoTaskId}
                            onDraftChange={(draft, links) => setUpdateNodeRequest({ id: videoNode.id, patch: { normalVideoDraft: draft, normalVideoLinks: links }, nonce: Date.now() })}
                            onSubmitted={(taskId, draft) => {
                                setUpdateNodeRequest({ id: videoNode.id, patch: { normalVideoDraft: draft, videoTaskId: taskId, videoStage: "正在等待视频生成", videoFailed: false, videoResultUnavailable: false }, nonce: Date.now() });
                                setVideoNode((current) => (current?.id === videoNode.id ? null : current));
                            }}
                        />
                    </Suspense>
                ) : null}
            </ShopCanvasComposer>
            <WorkbenchAssetPicker
                open={libraryOpen}
                accept={["image", "video"]}
                maxCount={1}
                onClose={() => setLibraryOpen(false)}
                onPick={(assets) => {
                    const asset = assets[0];
                    if (asset) setResourceRequest({ resourceId: asset.resourceId, kind: asset.kind === "video" ? "video" : "image", nonce: Date.now() });
                }}
            />
            <AppModal open={Boolean(helpTab)} onCancel={() => setHelpTab(null)} title="帮助中心" footer={null} width={800}>
                <div className="sp-canvas-help">
                    <div className="sp-canvas-segments">
                        <button aria-pressed={helpTab === "tutorial"} onClick={() => setHelpTab("tutorial")}>
                            使用教程
                        </button>
                        <button aria-pressed={helpTab === "shortcuts"} onClick={() => setHelpTab("shortcuts")}>
                            快捷键
                        </button>
                    </div>
                    {helpTab === "tutorial" ? (
                        <ol>
                            <li>点击左侧 + 创建节点，或从素材库导入商品图片和视频。</li>
                            <li>从节点右侧 + 拖到其他节点左侧 +，将素材或文案传给下游。</li>
                            <li>点击节点的配置入口，选择模型、比例、分辨率与张数，再确认生成。</li>
                            <li>右键操作节点；框选多个节点后可整理、分组与批量下载。</li>
                            <li>按 Esc 收起面板；画布内容保存在当前浏览器。</li>
                        </ol>
                    ) : (
                        <div className="sp-canvas-shortcuts">
                            {[
                                ["移动画布", "Space + 拖动"],
                                ["缩放画布", "Ctrl + 滚轮"],
                                ["选择 / 抓手", "V / H"],
                                ["文字节点", "T"],
                                ["撤销 / 重做", "Ctrl Z / Ctrl Shift Z"],
                                ["删除节点", "Delete"],
                                ["关闭面板", "Esc"],
                            ].map(([name, key]) => (
                                <div key={name}>
                                    <span>{name}</span>
                                    <kbd>{key}</kbd>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </AppModal>
            <FeedbackModal open={supportOpen} onClose={() => setSupportOpen(false)} />
            {linkDialog}
        </main>
    );
}
