import { App, Button } from "antd";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Ban, Grid2X2, Image, LoaderCircle, Plus, Rows3, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { ModelPicker } from "@/components/model-picker";
import { RollingCreditAmount } from "@/components/rolling-credit-text";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { CreditStar } from "@/components/ui/credit-star";
import { ReferencePromptTextarea } from "@/components/ui/reference-prompt-textarea";
import { createClientUUID } from "@/lib/client-id";
import { generationErrorMessage } from "@/lib/generation-error";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCommerceAdminModels, useCommerceDisplayConfig } from "@/pages/ecommerce/admin-models";
import { formatCommerceCredits } from "@/pages/ecommerce/catalog";
import { COMMERCE_IMAGE_ACCEPT, importCommerceImageTransfer, mightContainCommerceImage, readCommerceImageTransfer, type CommerceImageTransfer } from "@/pages/ecommerce/image-transfer";
import { commerceInputSignature } from "@/pages/ecommerce/planner";
import { ecommerceHistoryCovers } from "@/pages/ecommerce/project-history";
import { deleteEcommerceProjects, emptyEcommerceDraft, listEcommerceProjects, projectDraft, type EcommerceDraft, type EcommercePackageProduct, type EcommercePackageSlot, type EcommerceProject, type EcommerceReference } from "@/services/api/ecommerce";
import { ApiError } from "@/services/api/request";
import { resourceStorageKey, resourceVariantUrl } from "@/services/api/resources";
import { subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { logicalModelIDForConfig, resolveModelChannel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { detailProjectCache } from "./detail-project-cache";

import {
    detailPromptReferences,
    hasDetailLongReference,
    packageModelOptions,
    packageProduct,
    packageReferenceCapacity,
    packageSlots,
    PACKAGE_OUTPUT_LIMIT,
    PACKAGE_PRODUCT_LIMIT,
    PACKAGE_RECOGNITION_CREDITS,
    PACKAGE_REFERENCE_LIMIT,
    readPackageRecognition,
    submitDetailExecution,
    submitPackageRecognition,
    updateDetailPromptReferences,
    usePackageGenerationQuote,
    withPackageProduct,
} from "./detail-execution";
import { useDetailRuns } from "./detail-runs";
import { ResizablePanes } from "./resizable-panes";
import { ImagePopover } from "./image-popover";
import { PackageFooterControls, PackageOutputControls, PackageProductInfoModal, packageProductFieldCount } from "./shop-auto-package-fields";
import { ShopDetailWorks } from "./shop-detail-works";

import "@/pages/ecommerce/agent-theme.css";
import "./shop-detail.css";
import "./shop-detail-params.css";
import "./shop-auto-package.css";

const SCENES = [
    { id: "main", label: "主图", summary: "生成 1 张商品列表首图", icon: Image },
    { id: "set", label: "自动套餐", summary: "一次生成主图和详情图", icon: Grid2X2 },
    { id: "detail", label: "详情图", summary: "参考版式，自定出图张数", icon: Rows3 },
] as const;
type PackageScene = (typeof SCENES)[number];
type SceneSettings = Partial<Record<PackageScene["id"], Pick<EcommerceDraft, "imageModel" | "resolution" | "autoPackage" | "detailScreenCount">>>;
type UploadKind = "product" | "layout";
type RecognitionRequest = { id: string; source: EcommerceDraft; inputSignature: string; settingsSignature: string };
type ProductEditor = { product: EcommercePackageProduct; outline: EcommercePackageSlot[]; recognized: boolean };

const newDraft = (): EcommerceDraft => ({ ...emptyEcommerceDraft(), imageType: "detail", platform: "taobao", language: "zh-CN", count: 10, style: "", ratio: "", resolution: "" });
const stripOutline = (slots: EcommercePackageSlot[]) => slots.map(({ kind, ratio }) => ({ kind, ratio }));
const refLimit = { product: PACKAGE_PRODUCT_LIMIT, layout: PACKAGE_REFERENCE_LIMIT };
const PACKAGE_DRAFT_KEY = "shop-auto-package-draft";
const isRunning = (project: EcommerceProject) => /generat|planning|running|queued|submitting/i.test(project.status);
const clearSubmissionError = (error: unknown) => error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status) && !error.retryable;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

function restoreDraft(draft: EcommerceDraft) {
    const mode = draft.imageType === "main" || draft.imageType === "single" || draft.imageType === "white" ? "main" : draft.imageType === "detail" ? "detail" : "set";
    const detailScreenCount = mode === "detail" && hasDetailLongReference(draft.layoutReferences || []) ? (draft.detailScreenCount ?? (draft.autoPackage?.slots.filter((slot) => slot.kind === "detail").length || 0)) : undefined;
    return {
        ...newDraft(),
        ...draft,
        imageType: mode,
        detailScreenCount,
        referenceMode: (draft.layoutReferences?.length ? "style" : "product") as EcommerceDraft["referenceMode"],
        style: "",
        modelEnabled: false,
        noText: false,
        typeOptions: undefined,
        creativeOptions: undefined,
        cloneOptions: undefined,
        creativeRecommendationId: undefined,
        creativeDirectionId: undefined,
        execution: undefined,
        planningTaskId: undefined,
        directionsTaskId: undefined,
    };
}

function Thumbs({ items, onRemove }: { items: EcommerceReference[]; onRemove: (resourceId: string) => void }) {
    const [previewId, setPreviewId] = useState<string | null>(null);
    const previewIndex = items.findIndex((item) => item.resourceId === previewId);
    const preview = items[previewIndex];
    return (
        <>
            {items.map((item, index) => (
                <span key={item.resourceId} className="sdx-thumb" data-long={hasDetailLongReference([item]) || undefined}>
                    <button type="button" className="sdx-thumb-preview" aria-label={`放大查看${item.name || `参考图 ${index + 1}`}`} onClick={() => setPreviewId(item.resourceId)}>
                        <img src={resourceVariantUrl(item.resourceId, "thumbnail")} alt="" draggable={false} />
                    </button>
                    <button type="button" className="sdx-thumb-remove" aria-label={`移除${item.name || `图片 ${index + 1}`}`} onClick={() => onRemove(item.resourceId)}>
                        <X className="size-3" />
                    </button>
                </span>
            ))}
            {preview ? (
                <CanvasImagePreview
                    storageKey={resourceStorageKey(preview.resourceId)}
                    previewSrc={resourceVariantUrl(preview.resourceId, "thumbnail")}
                    alt={preview.name || `参考图 ${previewIndex + 1}`}
                    navigation={{
                        index: previewIndex,
                        total: items.length,
                        onPrevious: () => setPreviewId(items[(previewIndex - 1 + items.length) % items.length].resourceId),
                        onNext: () => setPreviewId(items[(previewIndex + 1) % items.length].resourceId),
                    }}
                    onClose={() => setPreviewId(null)}
                />
            ) : null}
        </>
    );
}

function UploadTile({ label, hint, busy, big, onTransfer }: { label: string; hint?: string; busy: boolean; big?: boolean; onTransfer: (transfer: CommerceImageTransfer) => void }) {
    const input = useRef<HTMLInputElement>(null);
    const [drag, setDrag] = useState(false);
    return (
        <div className="sdx-upload-tile">
            <input
                ref={input}
                type="file"
                accept={COMMERCE_IMAGE_ACCEPT}
                multiple
                hidden
                aria-label={label}
                onChange={(event) => {
                    onTransfer({ files: Array.from(event.target.files || []) });
                    event.target.value = "";
                }}
            />
            <button
                type="button"
                className="sdx-add"
                data-big={big || undefined}
                data-drag={drag || undefined}
                disabled={busy}
                onClick={() => input.current?.click()}
                onDragOver={(event) => {
                    if (!mightContainCommerceImage(event.dataTransfer)) return;
                    event.preventDefault();
                    if (!busy) setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDrag(false);
                    if (!busy) onTransfer(readCommerceImageTransfer(event.dataTransfer));
                }}
            >
                {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Plus className="size-5" strokeWidth={1.6} />}
                <strong>{label}</strong>
                {hint ? <small>{hint}</small> : null}
            </button>
        </div>
    );
}

/** 历史项目弹窗：搜索、打开、删除电商出图项目。 */
function HistoryModal({ open, projects, onOpen, onDeleted, onClose }: { open: boolean; projects: EcommerceProject[]; onOpen: (project: EcommerceProject) => void; onDeleted: (ids: string[]) => void; onClose: () => void }) {
    const { modal, message } = App.useApp();
    const reduced = useReducedMotion();
    const [query, setQuery] = useState("");
    const shown = projects.filter((project) => !query.trim() || (project.name || "").includes(query.trim()));
    const remove = (project: EcommerceProject) =>
        modal.confirm({
            title: "删除这个项目？",
            content: `「${project.name || "未命名详情图"}」会从历史项目移除，已生成的图片仍在作品与素材里。`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteEcommerceProjects({ ids: [project.id], expectedTotal: 1 });
                    onDeleted([project.id]);
                    message.success("已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                }
            },
        });
    if (typeof document === "undefined") return null;
    return createPortal(
        <AnimatePresence>
            {open ? (
                <motion.div className="sdx-modal-backdrop ms-scope" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
                    <motion.div className="sdx-modal sdx-history" initial={reduced ? false : { opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
                        <header>
                            <h3>
                                历史项目 <small>{projects.length}</small>
                            </h3>
                            <label className="sdx-search">
                                <Search className="size-3.5" />
                                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称" />
                            </label>
                            <button type="button" className="sdx-icon" aria-label="关闭" onClick={onClose}>
                                <X className="size-4" />
                            </button>
                        </header>
                        <div className="sdx-history-grid">
                            {shown.length ? (
                                shown.map((project, index) => {
                                    const cover = ecommerceHistoryCovers(project, {})[0];
                                    return (
                                        <motion.div key={project.id} className="sdx-history-card" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 16) * 0.02 }}>
                                            <button type="button" className="sdx-history-open" onClick={() => onOpen(project)}>
                                                <span className="sdx-work-cover">{cover ? <img src={cover} alt="" loading="lazy" /> : <i>{(project.name || "详").slice(0, 1)}</i>}</span>
                                                <strong>{project.name || "未命名详情图"}</strong>
                                                <small>{new Date(project.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
                                            </button>
                                            <button type="button" className="sdx-history-delete" aria-label="删除项目" onClick={() => remove(project)}>
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </motion.div>
                                    );
                                })
                            ) : (
                                <p className="sdx-works-empty">{query ? "没有匹配的项目" : "还没有历史项目"}</p>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>,
        document.body,
    );
}

export default function ShopDetail() {
    const userId = useUserStore((state) => state.user?.id);
    const scope = userId ? getActiveUserScope() : undefined;
    return <ShopDetailWorkspace key={scope || "guest"} scope={scope} userId={userId} />;
}

function ShopDetailWorkspace({ scope, userId }: { scope?: string; userId?: string }) {
    const { message, modal } = App.useApp();
    const reduced = useReducedMotion();
    const config = useCommerceDisplayConfig(useEffectiveConfig());
    const adminModels = useCommerceAdminModels(config, true);
    const [draft, setDraft] = useState(newDraft);
    const [sceneSettings, setSceneSettings] = useState<SceneSettings>({});
    const [draftReady, setDraftReady] = useState(false);
    const [uploading, setUploading] = useState<UploadKind>();
    const uploadLock = useRef(false);
    const [editor, setEditor] = useState<ProductEditor>();
    const [recognitionBusy, setRecognitionBusy] = useState(false);
    const [recognitionError, setRecognitionError] = useState("");
    const [recognitionTask, setRecognitionTask] = useState<GenerationTask>();
    const recognitionRequest = useRef<RecognitionRequest>(undefined);
    const recognitionLock = useRef(false);
    const [generating, setGenerating] = useState(false);
    const [generationError, setGenerationError] = useState("");
    const generationLock = useRef(false);
    const generationRequest = useRef<{ id: string; signature: string }>(undefined);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [mobileView, setMobileView] = useState<"compose" | "works">("compose");
    const [status, setStatus] = useState<"all" | "running" | "done">("all");
    const [order, setOrder] = useState<"new" | "old">("new");
    const [projects, setProjects] = useState<EcommerceProject[] | null>(() => (scope ? detailProjectCache.read(scope) : null));
    const [focusProject, setFocusProject] = useState<{ id: string; at: number } | null>(null);
    const deletedProjects = useRef(new Set<string>());

    useEffect(() => {
        if (!scope) return;
        let active = true;
        const storage = localForageStorageForScope(scope);
        void Promise.resolve(storage.getItem(PACKAGE_DRAFT_KEY))
            .then(async (saved) => {
                // The previous page can remain open during deployment or rollback.
                // Read its draft once without replacing the legacy storage entry.
                const raw = saved ?? (await storage.getItem("shop-detail-draft"));
                if (!active || !raw) return;
                const cached = JSON.parse(String(raw)) as { draft?: EcommerceDraft; sceneSettings?: SceneSettings };
                const previous = cached.draft;
                if (previous?.references && (saved || previous.references.length || previous.layoutReferences?.length || previous.productName || previous.instruction || previous.imageModel)) {
                    setDraft(restoreDraft(previous));
                    if (saved && cached.sceneSettings) setSceneSettings(cached.sceneSettings);
                }
            })
            .catch(() => active && message.warning("草稿读取失败，可从历史项目继续"))
            .finally(() => active && setDraftReady(true));
        return () => {
            active = false;
        };
    }, [message, scope]);

    useEffect(() => {
        if (!scope || !draftReady) return;
        void Promise.resolve(localForageStorageForScope(scope).setItem(PACKAGE_DRAFT_KEY, JSON.stringify({ draft, sceneSettings }))).catch(() => undefined);
    }, [scope, draftReady, draft, sceneSettings]);

    const runs = useDetailRuns((state) => state.runs);
    const savedByRuns = useDetailRuns((state) => state.saved);
    const forgetSaved = useDetailRuns((state) => state.forget);
    const onProjectsDeleted = (ids: string[]) => {
        ids.forEach((id) => deletedProjects.current.add(id));
        if (scope) detailProjectCache.forget(scope, ids);
        forgetSaved(ids);
        setProjects((list) => (list || []).filter((project) => !deletedProjects.current.has(project.id)));
    };
    useEffect(() => {
        const entries = Object.values(savedByRuns).filter((project) => !project.userId || project.userId === userId);
        if (!entries.length) return;
        setProjects((current) => {
            const list = [...(current || [])];
            for (const project of entries) {
                if (deletedProjects.current.has(project.id)) continue;
                const index = list.findIndex((item) => item.id === project.id);
                if (index < 0) list.unshift(project);
                else if (Date.parse(project.updatedAt) >= Date.parse(list[index].updatedAt)) list[index] = project;
            }
            return list;
        });
    }, [savedByRuns, userId]);

    useEffect(() => {
        if (!scope) return;
        let cancelled = false;
        let receivedServer = false;
        const savedAtRequest = useDetailRuns.getState().saved;
        void detailProjectCache.load(scope).then((cached) => {
            if (!cancelled && !receivedServer && getActiveUserScope() === scope && cached) setProjects((current) => current || cached);
        });
        listEcommerceProjects()
            .then((list) => {
                if (cancelled || getActiveUserScope() !== scope) return;
                receivedServer = true;
                const createdDuringRequest = Object.values(useDetailRuns.getState().saved).filter((project) => savedAtRequest[project.id] !== project && (!project.userId || project.userId === userId));
                const incoming = [...list, ...createdDuringRequest].filter((project) => !deletedProjects.current.has(project.id));
                setProjects(detailProjectCache.remember(scope, incoming, true));
            })
            .catch(async () => {
                const cached = await detailProjectCache.load(scope);
                if (!cancelled && getActiveUserScope() === scope) setProjects((current) => current || cached || []);
            });
        return () => {
            cancelled = true;
        };
    }, [scope, userId]);

    useEffect(() => {
        if (scope && projects && getActiveUserScope() === scope) detailProjectCache.remember(scope, projects);
    }, [projects, scope]);

    const scene = SCENES.find((item) => item.id === draft.imageType) || SCENES[1];
    const imageModels = useMemo(() => selectableModelsByCapability(config, "image").filter((model) => Boolean(logicalModelIDForConfig({ ...config, model })) || resolveModelChannel(config, model).scope === "system"), [config]);
    const imageModel = imageModels.includes(draft.imageModel) ? draft.imageModel : imageModels[0] || "";
    const profile = imageModel ? modelCapabilityConfigFor(config, imageModel).image : undefined;
    const { sizes: ratioValues, defaultSize, resolutions: resolutionChoices, resolution } = packageModelOptions(profile, draft.resolution);
    const slots = packageSlots(draft, ratioValues, defaultSize);
    const product = packageProduct(draft);
    const infoCount = packageProductFieldCount(product);
    const layoutReferences = draft.layoutReferences || [];
    const longReference = scene.id === "detail" && hasDetailLongReference(layoutReferences);
    const autoScreens = longReference && !draft.detailScreenCount;
    const source: EcommerceDraft = {
        ...draft,
        imageModel,
        resolution,
        ratio: slots[0]?.ratio || defaultSize,
        autoPackage: { slots },
        agentModel: adminModels.planningModel,
        count: slots.length,
        referenceMode: longReference ? "detail" : layoutReferences.length ? "style" : "product",
        detailScreenCount: longReference ? (autoScreens ? 0 : slots.length) : undefined,
    };
    const sourceSignature = commerceInputSignature(source);
    const currentSignature = useRef(sourceSignature);
    currentSignature.current = sourceSignature;
    const creditsEnabled = useUserStore((store) => store.features.creditsEnabled);
    const generationQuote = usePackageGenerationQuote(config, source, draftReady && creditsEnabled);
    const recognitionCost = creditsEnabled ? PACKAGE_RECOGNITION_CREDITS : null;
    const generationCost = creditsEnabled ? (generationQuote.data ?? null) : null;
    const referenceCount = draft.references.length + layoutReferences.length;
    const missingSetup = !adminModels.loaded && !adminModels.problem ? "正在读取 Agent 配置…" : adminModels.problem;
    const referenceLimitError = draft.references.length > PACKAGE_PRODUCT_LIMIT || layoutReferences.length > PACKAGE_REFERENCE_LIMIT ? "请移除超过上限的图片" : "";
    const commonReason = !draftReady ? "正在读取草稿…" : uploading ? "图片正在上传…" : !draft.references.length ? "请先上传商品图" : referenceLimitError;
    const recognitionReason = commonReason || (!adminModels.visionModel ? missingSetup || "后台识别模型不可用" : "") || packageReferenceCapacity(config, adminModels.visionModel, referenceCount);
    const imageReferenceCount = longReference ? draft.references.length + 1 : referenceCount;
    const missingItems = [!draft.references.length && "上传商品图", scene.id === "detail" && !layoutReferences.length && "上传至少 1 张参考图", !infoCount && "手动填写或自动识别商品信息"].filter(Boolean) as string[];
    const preparationReason = !draftReady
        ? "正在读取草稿…"
        : uploading
          ? "图片正在上传…"
          : recognitionBusy
            ? "正在识别商品信息…"
            : referenceLimitError ||
              (!profile ? "没有可用的图片模型" : "") ||
              (profile && profile.references.maxImages < imageReferenceCount ? `所选图片模型最多接收 ${profile.references.maxImages} 张图` : "") ||
              (!adminModels.planningModel ? missingSetup || "后台策划模型不可用" : "") ||
              packageReferenceCapacity(config, adminModels.planningModel, referenceCount) ||
              (creditsEnabled && generationCost === null ? (generationQuote.isFetching ? "图片报价中…" : "暂未取得图片报价") : "");
    const generationDisabled = generating || Boolean(preparationReason) || missingItems.length > 0;
    const displayCount = scene.id === "detail" && !layoutReferences.length ? 0 : slots.length;

    const update = (patch: Partial<EcommerceDraft>) => setDraft((current) => ({ ...current, ...patch }));
    const chooseScene = (item: PackageScene) => {
        if (!draftReady || item.id === scene.id) return;
        setRecognitionError("");
        setGenerationError("");
        setSceneSettings((current) => ({
            ...current,
            [scene.id]: { imageModel, resolution, autoPackage: draft.autoPackage ? { slots: stripOutline(slots) } : undefined, detailScreenCount: draft.detailScreenCount },
        }));
        const previous = sceneSettings[item.id];
        const detailScreenCount = item.id === "detail" && hasDetailLongReference(layoutReferences) ? (previous?.detailScreenCount ?? (previous?.autoPackage?.slots.filter((slot) => slot.kind === "detail").length || 0)) : previous?.detailScreenCount;
        update({ imageType: item.id, imageModel: previous?.imageModel || imageModel, resolution: previous?.resolution || "", autoPackage: previous?.autoPackage, detailScreenCount });
    };
    const changeSlots = (kind: EcommercePackageSlot["kind"], ratios: string[]) => {
        const previous = slots.filter((slot) => slot.kind === kind);
        const replacement = ratios.map((ratio, index) => ({ ...previous[index], kind, ratio }));
        const ordered = kind === "main" ? [...replacement, ...slots.filter((slot) => slot.kind === "detail")] : [...slots.filter((slot) => slot.kind === "main"), ...replacement];
        update({
            autoPackage: { slots: previous.length !== ratios.length ? stripOutline(ordered) : ordered },
            detailScreenCount: longReference ? ratios.length : undefined,
        });
    };
    const changeModel = (model: string) => {
        setGenerationError("");
        update({ imageModel: model });
    };

    const changeImages = (current: EcommerceDraft, references: EcommerceReference[], layout: EcommerceReference[]) =>
        updateDetailPromptReferences(current, {
            ...current,
            references,
            layoutReferences: layout,
            referenceMode: layout.length ? "style" : "product",
            detailScreenCount: current.imageType === "detail" && hasDetailLongReference(layout) ? (current.detailScreenCount ?? 0) : current.detailScreenCount,
            autoPackage: current.autoPackage ? { slots: stripOutline(current.autoPackage.slots) } : undefined,
        });
    const clearProduct = (current: EcommerceDraft) => {
        const empty = newDraft();
        const { description, colors, dimensions, pricePosition, lockedDetails, skus } = empty;
        return withPackageProduct({ ...current, description, colors, dimensions, pricePosition, lockedDetails, skus }, packageProduct(empty));
    };
    const importImages = async (transfer: CommerceImageTransfer, kind: UploadKind) => {
        if ((!transfer.files.length && !transfer.resourceId && !transfer.url) || !scope || !draftReady || uploadLock.current) return;
        const existing = kind === "product" ? draft.references : layoutReferences;
        if (existing.length >= refLimit[kind]) return;
        uploadLock.current = true;
        setUploading(kind);
        setRecognitionError("");
        setGenerationError("");
        try {
            const result = await importCommerceImageTransfer(transfer, kind === "product" ? (existing.length ? "detail" : "primary") : "style", {
                existingResourceIds: [...draft.references, ...layoutReferences].map((item) => item.resourceId),
                maxReferences: refLimit[kind] - existing.length,
            });
            if (getActiveUserScope() !== scope) return;
            if (result.references.length) {
                setDraft((current) => {
                    const layout = current.layoutReferences || [];
                    if (kind === "layout") return changeImages(current, current.references, [...layout, ...result.references]);
                    const references = [...current.references, ...result.references].map((item, index) => ({ ...item, role: index === 0 ? ("primary" as const) : ("detail" as const) }));
                    return changeImages(current, references, layout);
                });
            }
            if (result.errors.length) message.error(result.errors.join("；"));
        } catch (error) {
            if (getActiveUserScope() === scope) message.error(errorText(error, "图片上传失败，请重试"));
        } finally {
            uploadLock.current = false;
            setUploading(undefined);
        }
    };
    const removeImage = (id: string, kind: UploadKind) => {
        if (uploadLock.current || recognitionLock.current) return;
        if (kind === "layout") {
            setDraft((current) =>
                changeImages(
                    current,
                    current.references,
                    (current.layoutReferences || []).filter((item) => item.resourceId !== id),
                ),
            );
            return;
        }
        modal.confirm({
            title: "移除这张商品图？",
            content: "移除后，本次填写或识别的商品信息会一并清空。",
            okText: "移除并清空",
            cancelText: "保留商品图",
            okButtonProps: { danger: true },
            onOk: () => {
                setRecognitionError("");
                setGenerationError("");
                recognitionRequest.current = undefined;
                setDraft((current) => {
                    const references = current.references.filter((item) => item.resourceId !== id).map((item, index) => ({ ...item, role: index === 0 ? ("primary" as const) : item.role === "primary" ? ("detail" as const) : item.role }));
                    return clearProduct(changeImages(current, references, current.layoutReferences || []));
                });
            },
        });
    };
    const pasteImages = (event: ClipboardEvent, kind: UploadKind) => {
        const transfer = readCommerceImageTransfer(event.clipboardData);
        const editable = event.target instanceof HTMLElement && event.target.closest("input,textarea,[contenteditable]");
        if (!transfer.files.length && (editable || (!transfer.resourceId && !transfer.url))) return;
        event.preventDefault();
        event.stopPropagation();
        void importImages(transfer, kind);
    };
    const pasteUnfocused = useEffectEvent((event: globalThis.ClipboardEvent) => {
        if (event.defaultPrevented || event.target !== document.body || editor || historyOpen || mobileView === "works" || !event.clipboardData) return;
        const transfer = readCommerceImageTransfer(event.clipboardData);
        if (!transfer.files.length && !transfer.resourceId && !transfer.url) return;
        event.preventDefault();
        void importImages(transfer, "product");
    });
    useEffect(() => {
        if (!scope) return;
        const onPaste = (event: globalThis.ClipboardEvent) => pasteUnfocused(event);
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, [scope]);

    const openEditor = () => setEditor({ product, outline: slots, recognized: false });
    const recognize = async (editedProduct = product, editedOutline = slots) => {
        if (!scope || recognitionLock.current || recognitionReason) return;
        recognitionLock.current = true;
        setRecognitionBusy(true);
        setRecognitionError("");
        const input = withPackageProduct({ ...source, autoPackage: { slots: editedOutline.length === slots.length ? editedOutline : slots } }, editedProduct);
        const inputSignature = commerceInputSignature(input);
        const previous = recognitionRequest.current;
        const request = previous?.inputSignature === inputSignature ? previous : { id: createClientUUID(), source: input, inputSignature, settingsSignature: sourceSignature };
        recognitionRequest.current = request;
        try {
            const task = await submitPackageRecognition(scope, request.id, config, request.source, adminModels.visionModel);
            if (getActiveUserScope() === scope) setRecognitionTask(task);
        } catch (error) {
            if (clearSubmissionError(error)) recognitionRequest.current = undefined;
            if (getActiveUserScope() === scope) setRecognitionError(errorText(error, "识别提交失败，请重试"));
            recognitionLock.current = false;
            setRecognitionBusy(false);
        }
    };
    useEffect(() => {
        if (!scope || !recognitionTask) return;
        let finished = false;
        const receive = (task: GenerationTask) => {
            if (finished || getActiveUserScope() !== scope || !["succeeded", "failed", "cancelled"].includes(task.status)) return;
            finished = true;
            const request = recognitionRequest.current;
            recognitionRequest.current = undefined;
            recognitionLock.current = false;
            setRecognitionTask(undefined);
            setRecognitionBusy(false);
            if (!request) return;
            try {
                if (task.status !== "succeeded") throw new Error(generationErrorMessage(task.error || "商品识别没有完成，请重新识别"));
                if (currentSignature.current !== request.settingsSignature) throw new Error("识别期间素材或参数已变化，请重新识别");
                const result = readPackageRecognition(task, request.source);
                setEditor({ ...result, recognized: true });
            } catch (error) {
                setRecognitionError(errorText(error, "未能读取识别结果，请重新识别"));
            }
        };
        receive(recognitionTask);
        if (!finished) return subscribeGenerationTasks([recognitionTask.id], receive);
    }, [recognitionTask, scope]);

    const start = async () => {
        if (!scope || generationDisabled || generationLock.current || recognitionLock.current) return;
        const next = source;
        const key = commerceInputSignature(next);
        const retry = generationRequest.current?.signature === key;
        const id = retry ? generationRequest.current!.id : createClientUUID();
        generationRequest.current = { id, signature: key };
        generationLock.current = true;
        setGenerating(true);
        setGenerationError("");
        setStatus("all");
        setOrder("new");
        const store = useDetailRuns.getState();
        store.start({ id, scope, url: "", title: next.productName.trim() || scene.label, count: autoScreens ? 0 : next.count, startedAt: Date.now() });
        try {
            const project = await submitDetailExecution(scope, id, config, next);
            generationRequest.current = undefined;
            if (getActiveUserScope() === scope) {
                store.save(id, project);
                setMobileView("works");
            }
        } catch (error) {
            if (clearSubmissionError(error)) generationRequest.current = undefined;
            if (getActiveUserScope() === scope) setGenerationError(errorText(error, "生成任务未确认，请重试"));
        } finally {
            store.finish(id);
            generationLock.current = false;
            setGenerating(false);
        }
    };

    const shown = useMemo(() => {
        const list = (projects || []).filter((project) => !projectDraft(project).execution?.kind).filter((project) => status === "all" || (status === "running" ? isRunning(project) : !isRunning(project)));
        return list.sort((a, b) => (order === "new" ? 1 : -1) * (Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
    }, [projects, status, order]);
    const openProject = (project: EcommerceProject) => {
        setHistoryOpen(false);
        setStatus("all");
        setMobileView("works");
        setFocusProject({ id: project.id, at: Date.now() });
    };
    const again = (project: EcommerceProject) => {
        // Put a failed round back into the editor so quote and capability checks run before another charge.
        setDraft(restoreDraft(projectDraft(project)));
        setMobileView("compose");
    };
    const pendingRuns = runs.filter((run) => run.scope === scope && (!run.projectId || !(projects || []).some((project) => project.id === run.projectId)));

    const left = (
        <nav className="sdx-nav" aria-label="详情功能">
            <h3>详情图</h3>
            <LayoutGroup id="sdx-nav">
                {SCENES.map((item) => (
                    <button key={item.id} type="button" className="sdx-nav-item" data-active={item.id === scene.id || undefined} aria-pressed={item.id === scene.id} onClick={() => chooseScene(item)}>
                        {item.id === scene.id ? <motion.span layoutId="sdx-nav-active" className="sdx-nav-active" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 38 }} /> : null}
                        <span className="sdx-art sdx-package-art">
                            <item.icon className="size-4" />
                        </span>
                        <span className="sdx-nav-copy">
                            <strong>{item.label}</strong>
                            <small>{item.summary}</small>
                        </span>
                    </button>
                ))}
            </LayoutGroup>
        </nav>
    );

    const uploads = (kind: UploadKind) => {
        const primary = kind === "product";
        const items = primary ? draft.references : layoutReferences;
        const required = primary || scene.id === "detail";
        const label = primary ? "商品图" : "参考图";
        return (
            <div className={`sdx-upload-col${primary ? "" : " sdx-package-reference"}`} data-required={required || undefined} onPaste={(event) => pasteImages(event, kind)}>
                <div className="sdx-label">
                    {label} <em className={required ? "is-required" : undefined}>{required ? "必传" : "选填"}</em>
                    <small>{items.length ? `${items.length} / ${refLimit[kind]} 张` : `最多 ${refLimit[kind]} 张`}</small>
                </div>
                <div className="sdx-upload" data-has-images={items.length > 0 || undefined}>
                    <Thumbs items={items} onRemove={(id) => removeImage(id, kind)} />
                    {items.length < refLimit[kind] ? (
                        <UploadTile
                            big={required}
                            label={items.length ? `添加${label}` : `上传${label}`}
                            hint={primary && !items.length ? "点击、拖入或粘贴" : undefined}
                            busy={Boolean(uploading)}
                            onTransfer={(transfer) => void importImages(transfer, kind)}
                        />
                    ) : null}
                </div>
                <small className="sdx-hint">{primary ? "上传清晰的商品图，可补充包装和细节" : "借鉴构图、配色与排版"}</small>
            </div>
        );
    };

    const sellingPoints = product.claims
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const summaryRows = [
        ["商品名", product.productName],
        ["品类", product.category],
        ["卖点", sellingPoints.length > 1 ? `${sellingPoints[0]} 等 ${sellingPoints.length} 条` : sellingPoints[0]],
    ];
    const extraFields = infoCount - summaryRows.filter(([, value]) => value?.trim()).length;
    const recognitionLabel = recognitionBusy ? "正在识别…" : infoCount > 0 ? "重新识别" : "自动识别";
    const imagePrice = generationCost !== null && displayCount > 0 ? generationCost : null;
    const generationTip = (
        <div className="sdx-generation-tip">
            {imagePrice !== null ? (
                <div className="sdx-generation-tip-price">
                    <strong>
                        <CreditStar /> {formatCommerceCredits(imagePrice)} 积分{autoScreens ? " / 张" : ""}
                    </strong>
                    <small>{autoScreens ? "分析参考长图后，按实际张数计算图片积分。" : "图片积分按模型和规格预估，以实际结算为准。"}</small>
                </div>
            ) : null}
            {missingItems.length ? (
                <>
                    <strong>请完成以下准备</strong>
                    <ul>
                        {missingItems.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </>
            ) : preparationReason ? (
                <strong>{preparationReason}</strong>
            ) : null}
            {creditsEnabled && !missingItems.length && !preparationReason ? <small>Agent 策划按分析模型另计。</small> : null}
        </div>
    );
    const center = (
        <main className="sdx-main" onPaste={(event) => pasteImages(event, "product")}>
            <div className="sdx-scroll">
                <AnimatePresence mode="wait">
                    <motion.header key={scene.id} className="sdx-title" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        <h1>{scene.label}</h1>
                        <p>
                            {scene.summary}
                            {scene.id === "set" ? "，可逐张设置比例和内容。" : "。"}
                        </p>
                    </motion.header>
                </AnimatePresence>

                <section className="sdx-step">
                    <h2>
                        <span>1</span>上传图片
                        {referenceCount ? (
                            <Button
                                type="text"
                                size="small"
                                className="sdx-clear"
                                disabled={Boolean(uploading) || recognitionBusy}
                                onClick={() => {
                                    setRecognitionError("");
                                    setGenerationError("");
                                    recognitionRequest.current = undefined;
                                    setDraft((current) => clearProduct(changeImages({ ...current, autoPackage: scene.id === "detail" ? undefined : current.autoPackage, detailScreenCount: undefined }, [], [])));
                                }}
                            >
                                清空图片
                            </Button>
                        ) : null}
                    </h2>
                    <div className="sdx-package-media">
                        {uploads("product")}
                        <div className="sdx-info" aria-busy={recognitionBusy}>
                            <div className="sdx-info-title">
                                <strong>商品信息</strong>
                                {infoCount ? <small data-filled>已填 {infoCount} 项</small> : null}
                            </div>
                            <dl>
                                {summaryRows.map(([label, value], index) => (
                                    <div className="contents" key={label}>
                                        <dt>{label}</dt>
                                        <dd title={value}>{recognitionBusy ? <i className="sdx-info-placeholder" data-short={index === 1 || undefined} aria-hidden /> : value || "—"}</dd>
                                    </div>
                                ))}
                            </dl>
                            {extraFields > 0 && !recognitionBusy ? <small>另有 {extraFields} 项资料</small> : null}
                            {!draft.references.length ? <small>添加商品图后可识别资料</small> : null}
                            {recognitionBusy ? <small role="status">Agent 正在读取图片并拟定逐张内容</small> : null}
                            {recognitionError && !editor ? (
                                <p className="sdx-info-error" role="alert">
                                    {recognitionError}
                                </p>
                            ) : draft.references.length && recognitionReason && !recognitionBusy ? (
                                <small>{recognitionReason}</small>
                            ) : null}
                            <div className="sdx-info-actions">
                                {draft.references.length ? (
                                    <Button className="sdx-recognize" size="small" disabled={Boolean(recognitionReason) || recognitionBusy} loading={recognitionBusy} title={recognitionReason || undefined} onClick={() => void recognize()}>
                                        {recognitionLabel}
                                        {recognitionCost !== null && !recognitionBusy ? (
                                            <span className="sdx-recognition-credit">
                                                <CreditStar />
                                                {formatCommerceCredits(recognitionCost)} 积分
                                            </span>
                                        ) : null}
                                    </Button>
                                ) : null}
                                <Button size="small" type={draft.references.length ? "default" : "text"} disabled={!draftReady || recognitionBusy} onClick={openEditor}>
                                    {infoCount ? "修改" : "手动填写"}
                                </Button>
                            </div>
                        </div>
                        {uploads("layout")}
                    </div>
                </section>

                <section className="sdx-step">
                    <h2>
                        <span>2</span>出哪些图 <small className="sdx-total">{autoScreens ? "按参考分屏" : `共 ${displayCount} 张`}</small>
                    </h2>
                    <PackageOutputControls
                        platform={draft.platform}
                        onPlatformChange={(platform) => update({ platform, region: "" })}
                        mainRatios={slots.filter((slot) => slot.kind === "main").map((slot) => slot.ratio)}
                        detailRatios={displayCount > 0 ? slots.filter((slot) => slot.kind === "detail").map((slot) => slot.ratio) : []}
                        onMainRatiosChange={(ratios) => changeSlots("main", ratios)}
                        onDetailRatiosChange={(ratios) => changeSlots("detail", ratios)}
                        availableRatios={ratioValues}
                        maxCount={PACKAGE_OUTPUT_LIMIT}
                        showMain={scene.id !== "detail"}
                        showDetail={scene.id !== "main"}
                        mainCountLocked={scene.id === "main"}
                        detailCountLocked={scene.id === "detail" && !layoutReferences.length}
                        detailMinimum={longReference ? layoutReferences.length : undefined}
                        detailCountMode={longReference ? { automatic: autoScreens, onToggle: () => update({ detailScreenCount: autoScreens ? slots.length : 0 }) } : undefined}
                        detailHint={scene.id === "detail" ? (!layoutReferences.length ? "上传参考图后可设置张数与比例" : longReference ? "保留参考图的版式与上下屏衔接" : `可设 1–${PACKAGE_OUTPUT_LIMIT} 张，按参考图版式生成`) : undefined}
                        model={
                            <div className="sdx-model">
                                <ModelPicker
                                    config={config}
                                    capability="image"
                                    value={imageModel}
                                    onChange={changeModel}
                                    modelFilter={(model) => imageModels.includes(model)}
                                    closeOnSelect
                                    fullWidth
                                    className="creation-model-picker"
                                    variant="creation"
                                    mobileBack
                                    showSelectedPrice={false}
                                    adaptiveTrigger
                                    placeholder="选择图片模型"
                                />
                            </div>
                        }
                    />
                </section>

                <section className="sdx-step">
                    <h2>
                        <span>3</span>补充要求 <small>选填</small>
                    </h2>
                    <div className="sdx-brief">
                        <ReferencePromptTextarea
                            className="sdx-notes"
                            containerClassName="sdx-brief-input"
                            style={{ color: "var(--ms-text)" }}
                            materials={detailPromptReferences(source)}
                            value={draft.instruction}
                            maxLength={2000}
                            onChange={(instruction) => update({ instruction })}
                            placeholder="例如：用米白背景，文案简短，上下屏沿用同一纹理"
                            aria-label="补充要求"
                        />
                        <div className="sdx-brief-footer">
                            <span>{referenceCount ? "输入 @ 可引用已上传的图片" : "可补充配色、文案或想突出的卖点"}</span>
                            <span>{draft.instruction.length} / 2000</span>
                        </div>
                    </div>
                </section>
            </div>

            <footer className="sdx-bar">
                {generationError ? (
                    <p className="sdx-package-submit-error" role="alert">
                        {generationError}
                    </p>
                ) : null}
                <PackageFooterControls language={draft.language} onLanguageChange={(language) => update({ language })} resolution={resolution} onResolutionChange={(value) => update({ resolution: value })} resolutions={resolutionChoices} />
                {creditsEnabled && generationQuote.isError ? (
                    <button type="button" className="sdx-link" onClick={() => void generationQuote.refetch()}>
                        重新获取生成报价
                    </button>
                ) : null}
                <AntTooltip
                    title={generating || (!generationDisabled && !creditsEnabled) ? undefined : generationTip}
                    placement="topRight"
                    mouseEnterDelay={0.15}
                    trigger={generationDisabled ? ["hover", "focus", "click"] : ["hover", "focus"]}
                    classNames={{ root: "sdx-generation-tooltip ms-scope", container: "sdx-generation-tooltip-panel" }}
                >
                    <span className="sdx-start-anchor" data-disabled={generationDisabled || undefined} tabIndex={generationDisabled && !generating ? 0 : undefined} aria-label={generationDisabled && !generating ? "查看生成条件" : undefined}>
                        <motion.button type="button" className="sdx-start" disabled={generationDisabled} data-ready={!generationDisabled || undefined} aria-busy={generating} onClick={() => void start()} whileTap={reduced ? undefined : { scale: 0.97 }}>
                            {imagePrice !== null ? (
                                <span className="sdx-submit-credit" aria-label={`预计 ${formatCommerceCredits(imagePrice)} 积分${autoScreens ? "每张" : ""}`}>
                                    <CreditStar />
                                    <RollingCreditAmount value={imagePrice} maximumFractionDigits={6} /> {autoScreens ? "积分 / 张" : "积分"}
                                </span>
                            ) : null}
                            {generating ? (
                                <>
                                    提交中 <LoaderCircle className="size-4 animate-spin" aria-hidden />
                                </>
                            ) : (
                                <>
                                    {autoScreens ? "按参考分屏生成" : `生成 ${displayCount} 张`} {generationDisabled ? <Ban className="size-3.5" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
                                </>
                            )}
                        </motion.button>
                    </span>
                </AntTooltip>
            </footer>
        </main>
    );

    const right = (
        <ShopDetailWorks
            projects={projects === null ? null : shown}
            pending={pendingRuns}
            focusProject={focusProject}
            onAgain={again}
            onOpenHistory={() => setHistoryOpen(true)}
            onBatchDeleted={onProjectsDeleted}
            onUseReference={(resourceId, role) => {
                if (uploadLock.current) return;
                const kind = role === "style" ? "layout" : "product";
                const items = kind === "product" ? draft.references : layoutReferences;
                if (items.length >= refLimit[kind]) {
                    message.warning(`${kind === "product" ? "商品图" : "参考图"}最多 ${refLimit[kind]} 张`);
                    return;
                }
                if ([...draft.references, ...layoutReferences].some((item) => item.resourceId === resourceId)) return;
                setMobileView("compose");
                void importImages({ files: [], resourceId, name: "生成的图片" }, kind);
            }}
            onReload={() =>
                listEcommerceProjects()
                    .then((list) => {
                        if (scope && getActiveUserScope() === scope)
                            setProjects(
                                detailProjectCache.remember(
                                    scope,
                                    list.filter((project) => !deletedProjects.current.has(project.id)),
                                    true,
                                ),
                            );
                    })
                    .catch(() => undefined)
            }
            filters={
                <ImagePopover
                    placement="bottom"
                    align="end"
                    trigger={(open, toggle) => (
                        <button type="button" className="sdx-tool is-icon" data-open={open || undefined} onClick={toggle} aria-label="筛选与排序">
                            <SlidersHorizontal className="size-3.5" />
                        </button>
                    )}
                >
                    {() => (
                        <div className="sdx-filter">
                            <span>状态</span>
                            <div className="sdx-seg">
                                {(
                                    [
                                        ["all", "全部"],
                                        ["running", "生成中"],
                                        ["done", "已完成"],
                                    ] as const
                                ).map(([id, text]) => (
                                    <button key={id} type="button" data-active={status === id || undefined} onClick={() => setStatus(id)}>
                                        {text}
                                    </button>
                                ))}
                            </div>
                            <span>顺序</span>
                            <div className="sdx-seg">
                                <button type="button" data-active={order === "new" || undefined} onClick={() => setOrder("new")}>
                                    最新在前
                                </button>
                                <button type="button" data-active={order === "old" || undefined} onClick={() => setOrder("old")}>
                                    最早在前
                                </button>
                            </div>
                        </div>
                    )}
                </ImagePopover>
            }
        />
    );

    return (
        <>
            <ResizablePanes
                storageKey="shop-detail"
                className={`sp-page sdx-page sdx-package ms-scope sdx-mobile-${mobileView}`}
                defaults={{ left: 200, right: 380 }}
                leftLimits={{ min: 170, max: 360 }}
                rightLimits={{ min: 270, max: 1200 }}
                centerMin={630}
                left={
                    <>
                        <div className="sdx-mobile-tabs" role="group" aria-label="切换详情图面板">
                            <button type="button" aria-pressed={mobileView === "compose"} onClick={() => setMobileView("compose")}>
                                创作
                            </button>
                            <button type="button" aria-pressed={mobileView === "works"} onClick={() => setMobileView("works")}>
                                作品
                            </button>
                        </div>
                        {left}
                    </>
                }
                center={center}
                right={right}
            />
            {editor ? (
                <PackageProductInfoModal
                    open
                    product={editor.product}
                    outline={editor.outline}
                    canRecognize={!recognitionReason}
                    recognitionBlockedReason={recognitionReason}
                    recognitionCost={recognitionCost}
                    recognitionError={recognitionError}
                    recognitionComplete={editor.recognized}
                    recognizing={recognitionBusy}
                    onRecognize={(editedProduct, editedSlots) => void recognize(editedProduct, editedSlots)}
                    onComplete={(editedProduct, editedSlots) => {
                        setDraft((current) => withPackageProduct({ ...current, autoPackage: { slots: editedSlots.length === slots.length ? editedSlots : stripOutline(slots) } }, editedProduct));
                        setEditor(undefined);
                    }}
                    onClose={() => setEditor(undefined)}
                />
            ) : null}
            <HistoryModal open={historyOpen} projects={shown} onOpen={openProject} onDeleted={onProjectsDeleted} onClose={() => setHistoryOpen(false)} />
        </>
    );
}
