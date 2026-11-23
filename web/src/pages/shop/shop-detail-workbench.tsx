import { App, Button, Input } from "antd";
import { Download, Expand, ScanText, Type, X, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { CreditStar } from "@/components/ui/credit-star";
import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { createClientUUID } from "@/lib/client-id";
import { generationErrorMessage } from "@/lib/generation-error";
import { useCommerceDisplayConfig } from "@/pages/ecommerce/admin-models";
import { formatCommerceCredits } from "@/pages/ecommerce/catalog";
import { exportEcommerceLongImage, startEcommerceDownload, type EcommerceExportItem } from "@/pages/ecommerce/export";
import { outputResourceId } from "@/pages/ecommerce/tryon/tryon-runtime";
import { detectEcommerceImageText, type EcommerceImageTextDetection } from "@/services/api/ecommerce-text";
import { type EcommerceProject, type EcommercePlanImage } from "@/services/api/ecommerce";
import { resourceFileUrl, resourceStorageKey, resourceVariantUrl } from "@/services/api/resources";
import { subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { modelDisplayName } from "@/stores/config-model-options";
import { completeDetailEditAttempt, editDetailImage, findDetailPlanImage } from "./detail-regenerate";
import { detailTextBoxStyle, detailTextEditInstruction } from "./detail-text-layout";
import { DetailJoinPreview } from "./detail-join-preview";
import { useImageQuote } from "./shop-edits";
import "./shop-detail-workbench.css";

export type DetailWorkbenchImage = { key: string; project: EcommerceProject; taskId: string; index: number; resourceId: string; plan?: EcommercePlanImage; prompt?: string };
type EditDraft = { instruction: string; prompt?: string; detection?: EcommerceImageTextDetection; values: Record<string, string> };
const emptyEdit = (): EditDraft => ({ instruction: "", values: {} });

export function ShopDetailWorkbench({ initialImages, initialKey, onClose, onSubmitted }: { initialImages: DetailWorkbenchImage[]; initialKey: string; onClose: () => void; onSubmitted: () => void }) {
    const { message } = App.useApp();
    const config = useCommerceDisplayConfig(useEffectiveConfig());
    const [images, setImages] = useState(initialImages);
    const [selectedKey, setSelectedKey] = useState(initialKey);
    const [mode, setMode] = useState<"image" | "text">("image");
    const [mobilePane, setMobilePane] = useState<"preview" | "edit">("preview");
    const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
    const [activeRegion, setActiveRegion] = useState("");
    const [showBoxes, setShowBoxes] = useState(true);
    const [zoom, setZoom] = useState(1);
    const [preview, setPreview] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [detecting, setDetecting] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [pending, setPending] = useState<Record<string, GenerationTask>>({});
    const pendingRef = useRef(pending);
    pendingRef.current = pending;
    const lock = useRef(false);
    const submission = useRef<{ signature: string; id: string } | null>(null);
    const detector = useRef<AbortController | null>(null);
    const scroll = useRef<HTMLDivElement>(null);
    const nodes = useRef(new Map<string, HTMLElement>());
    const inputs = useRef(new Map<string, HTMLTextAreaElement>());
    const selected = images.find((image) => image.key === selectedKey) || images[0];
    const draft = drafts[selected.key] || emptyEdit();
    const detection = draft.detection;
    const model = selected.plan?.imageModel || "";
    const quote = useImageQuote(config, model, selected.plan?.ratio || "", selected.plan?.resolution || "", 1);
    const busy = Boolean(pending[selected.key] && !["succeeded", "failed", "cancelled"].includes(pending[selected.key].status));
    const changed = Boolean(detection?.regions.some((region) => draft.values[region.id] !== undefined && draft.values[region.id] !== region.text));
    const prompt = draft.prompt ?? selected.plan?.prompt ?? selected.prompt ?? "";
    const patch = (key: string, update: Partial<EditDraft>) => setDrafts((current) => ({ ...current, [key]: { ...(current[key] || emptyEdit()), ...update } }));
    const fail = (key: string, value: string) => setErrors((current) => ({ ...current, [key]: value }));

    useEffect(() => () => detector.current?.abort(), []);
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "h" || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement)?.closest("input,textarea,[contenteditable=true]")) return;
            event.preventDefault();
            setShowBoxes((value) => !value);
        };
        window.addEventListener("keydown", keydown);
        return () => window.removeEventListener("keydown", keydown);
    }, []);
    const pendingIds = Object.values(pending)
        .filter((task) => !["succeeded", "failed", "cancelled"].includes(task.status))
        .map((task) => task.id)
        .join("|");
    useEffect(() => {
        if (!pendingIds) return;
        return subscribeGenerationTasks(pendingIds.split("|"), (task) => {
            const key = Object.keys(pendingRef.current).find((id) => pendingRef.current[id].id === task.id);
            if (!key) return;
            setPending((current) => ({ ...current, [key]: task }));
            if (["succeeded", "failed", "cancelled"].includes(task.status)) {
                const image = images.find((item) => item.key === key);
                if (image?.plan) void completeDetailEditAttempt(image.project.id, image.plan.id, task.id).catch(() => undefined);
            }
            if (task.status === "succeeded") {
                const resourceId = outputResourceId(task);
                if (!resourceId) {
                    fail(key, "图片已生成，正在保存资源，请稍后重新打开");
                    return;
                }
                setImages((current) => current.map((image) => (image.key === key ? { ...image, resourceId, taskId: task.id, prompt: task.prompt, plan: image.plan ? { ...image.plan, prompt: task.prompt || image.plan.prompt } : undefined } : image)));
                setDrafts((current) => ({ ...current, [key]: emptyEdit() }));
                onSubmitted();
            } else if (task.status === "failed" || task.status === "cancelled") {
                fail(key, task.status === "cancelled" ? "修改任务已取消" : generationErrorMessage(task.error) || "修改未完成，可重新提交");
            }
        });
        // Callback updates do not restart the task event subscription.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingIds]);
    const select = (key: string, move = true) => {
        setSelectedKey(key);
        setActiveRegion("");
        if (move) nodes.current.get(key)?.scrollIntoView({ block: "start", behavior: "auto" });
    };
    useEffect(() => {
        nodes.current.get(initialKey)?.scrollIntoView({ block: "start" });
    }, [initialKey]);
    const locate = (id: string, focusInput: boolean) => {
        setActiveRegion(id);
        if (focusInput) {
            const input = inputs.current.get(id);
            input?.scrollIntoView({ block: "nearest" });
            input?.focus({ preventScroll: true });
        } else {
            nodes.current
                .get(selected.key)
                ?.querySelector(`[data-region-id="${CSS.escape(id)}"]`)
                ?.scrollIntoView({ block: "center", inline: "nearest" });
        }
    };
    const detect = async () => {
        if (detecting) return;
        const key = selected.key;
        const controller = new AbortController();
        detector.current = controller;
        setDetecting(key);
        fail(key, "");
        try {
            patch(key, { detection: await detectEcommerceImageText(selected.resourceId, controller.signal), values: {} });
        } catch (cause) {
            if (!controller.signal.aborted) fail(key, cause instanceof Error ? cause.message : "文字识别未完成，请重试");
        } finally {
            if (!controller.signal.aborted) setDetecting("");
        }
    };
    const submit = async () => {
        if (lock.current || busy || quote.value === null) return;
        const key = selected.key;
        lock.current = true;
        setSubmitting(true);
        fail(key, "");
        try {
            const source = await findDetailPlanImage(selected.project.id, selected.taskId);
            if (!source) throw new Error("这张图的方案尚未保存，请稍后再试");
            if (source.image.imageModel !== model || source.image.ratio !== selected.plan?.ratio || source.image.resolution !== selected.plan?.resolution) throw new Error("这张图的模型或规格已更新，请重新打开工作台获取报价");
            const instruction =
                mode === "text" && detection
                    ? detailTextEditInstruction(detection, draft.values)
                    : [draft.instruction.trim() || "在保留整体构图的前提下优化本图细节。", prompt !== (selected.plan?.prompt ?? selected.prompt ?? "") ? `本张更新后的画面提示词：\n${prompt}` : ""].filter(Boolean).join("\n\n");
            const signature = JSON.stringify([selected.resourceId, instruction, source.image.imageModel]);
            if (submission.current?.signature !== signature) submission.current = { signature, id: createClientUUID() };
            const result = await editDetailImage(config, source, selected.resourceId, instruction, submission.current.id);
            if (result.task.status === "failed" || result.task.status === "cancelled") {
                await completeDetailEditAttempt(source.project.id, source.image.id, result.task.id);
                submission.current = null;
                throw new Error(generationErrorMessage(result.task.error) || "这次修改未完成，可重新提交");
            }
            if (result.task.status === "succeeded") {
                const resourceId = outputResourceId(result.task);
                if (!resourceId) throw new Error("修改已完成，正在保存图片，请稍后重新打开");
                setImages((current) => current.map((image) => (image.key === key ? { ...image, resourceId, taskId: result.task.id, plan: image.plan ? { ...image.plan, prompt: result.task.prompt || image.plan.prompt } : undefined } : image)));
                setDrafts((current) => ({ ...current, [key]: emptyEdit() }));
                await completeDetailEditAttempt(source.project.id, source.image.id, result.task.id);
            }
            // The project now points at this receipt, including on failure. Keep
            // the original pixels visible until success, but resolve retries by
            // the new task so they can still find the current saved plan.
            setImages((current) => current.map((image) => (image.key === key ? { ...image, taskId: result.task.id } : image)));
            setPending((current) => ({ ...current, [key]: result.task }));
            submission.current = null;
            onSubmitted();
        } catch (cause) {
            fail(key, cause instanceof Error ? cause.message : "修改任务提交失败，请重试");
        } finally {
            lock.current = false;
            setSubmitting(false);
        }
    };
    const exportItems = (): EcommerceExportItem[] => images.map((image, index) => ({ image: image.plan || ({ imageType: "detail" } as EcommercePlanImage), assetId: "", resourceId: image.resourceId, index }));
    const longDownload = async () => {
        setExporting(true);
        try {
            await exportEcommerceLongImage(selected.project.name || "详情图", exportItems());
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "长图下载失败");
        } finally {
            setExporting(false);
        }
    };
    const price = quote.loading ? "报价中…" : quote.value === null ? "报价暂不可用" : `${formatCommerceCredits(quote.value)} 积分`;

    return (
        <AppModal open onCancel={() => !submitting && onClose()} footer={null} closable={false} width="calc(100vw - 32px)" centered flush className="sdwb-modal" keyboard={!submitting} maskClosable={false}>
            <div className="sdwb ms-scope" data-canvas-no-zoom>
                <header className="sdwb-header">
                    <div className="sdwb-title">
                        <strong>详情图工作台</strong>
                        <span>
                            {images.length} 张 · {selected.project.name || "商品详情"}
                        </span>
                    </div>
                    <div className="sdwb-header-actions">
                        <Button icon={<Download size={15} />} onClick={() => startEcommerceDownload(exportItems())}>
                            打包下载
                        </Button>
                        <Button loading={exporting} onClick={() => void longDownload()}>
                            长图下载
                        </Button>
                        <Button type="text" aria-label="关闭工作台" icon={<X size={18} />} disabled={submitting} onClick={onClose} />
                    </div>
                </header>
                <div className="sdwb-mobile-tabs">
                    <SegmentedControl
                        value={mobilePane}
                        onChange={setMobilePane}
                        options={[
                            { value: "preview", label: "长图预览" },
                            { value: "edit", label: "编辑当前图片" },
                        ]}
                        block
                    />
                </div>
                <div className="sdwb-body" data-mobile-pane={mobilePane}>
                    <nav className="sdwb-rail" aria-label="本套生成图片" data-canvas-wheel-scroll>
                        {images.map((image, index) => (
                            <button key={image.key} type="button" aria-label={`选择第 ${index + 1} 张`} aria-pressed={selected.key === image.key} onClick={() => select(image.key)}>
                                <img src={resourceVariantUrl(image.resourceId, "thumbnail")} alt={image.plan?.theme || `详情 ${index + 1}`} />
                                <span>{String(index + 1).padStart(2, "0")}</span>
                                {pending[image.key] && !["succeeded", "failed", "cancelled"].includes(pending[image.key].status) ? <i aria-label="正在生成" /> : null}
                            </button>
                        ))}
                    </nav>
                    <section className="sdwb-center">
                        <div className="sdwb-scroll" ref={scroll} data-canvas-wheel-scroll>
                            <div className="sdwb-strip" style={{ width: `${Math.round(480 * zoom)}px` }}>
                                {images.map((image, index) => (
                                    <div
                                        key={image.key}
                                        ref={(element) => {
                                            if (element) nodes.current.set(image.key, element);
                                            else nodes.current.delete(image.key);
                                        }}
                                        className="sdwb-image"
                                        data-selected={selected.key === image.key || undefined}
                                        onClick={() => select(image.key, false)}
                                    >
                                        <img src={resourceFileUrl(image.resourceId)} alt={image.plan?.theme || `详情 ${index + 1}`} draggable={false} />
                                        {index > 0 && (image.plan?.imageType ?? "detail") === "detail" && (images[index - 1].plan?.imageType ?? "detail") === "detail" && <DetailJoinPreview above={images[index - 1].resourceId} below={image.resourceId} />}
                                        {mode === "text" &&
                                            showBoxes &&
                                            image.key === selected.key &&
                                            detection?.regions.map((region) => {
                                                const style = detailTextBoxStyle(region, detection);
                                                return style ? (
                                                    <button
                                                        key={region.id}
                                                        type="button"
                                                        className="sdwb-text-box"
                                                        data-region-id={region.id}
                                                        data-active={activeRegion === region.id || undefined}
                                                        aria-label={`修改文字：${region.text}`}
                                                        aria-pressed={activeRegion === region.id}
                                                        style={style}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            locate(region.id, true);
                                                        }}
                                                    />
                                                ) : null;
                                            })}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <footer className="sdwb-view-tools">
                            <span>第 {images.findIndex((image) => image.key === selected.key) + 1} 张</span>
                            <div>
                                <Button type="text" aria-label="缩小长图" icon={<Minus size={15} />} onClick={() => setZoom((value) => Math.max(0.4, value - 0.2))} />
                                <span>{Math.round(zoom * 100)}%</span>
                                <Button type="text" aria-label="放大长图" icon={<Plus size={15} />} onClick={() => setZoom((value) => Math.min(3, value + 0.2))} />
                            </div>
                            <div className="sdwb-view-actions">
                                {mode === "text" ? (
                                    <Button aria-pressed={showBoxes} icon={<Type size={15} />} onClick={() => setShowBoxes((value) => !value)}>
                                        文字框 <kbd>H</kbd>
                                    </Button>
                                ) : null}
                                <Button onClick={() => startEcommerceDownload(exportItems().filter((item) => item.resourceId === selected.resourceId))}>下载这张</Button>
                                <Button icon={<Expand size={15} />} onClick={() => setPreview(true)}>
                                    放大查看
                                </Button>
                            </div>
                        </footer>
                    </section>
                    <aside className="sdwb-editor">
                        <div className="sdwb-editor-head">
                            <span>第 {images.findIndex((image) => image.key === selected.key) + 1} 张</span>
                            <strong>{selected.plan?.theme || "当前图片"}</strong>
                        </div>
                        <SegmentedControl
                            value={mode}
                            onChange={setMode}
                            options={[
                                { value: "image", label: "调整画面" },
                                { value: "text", label: "修改文字" },
                            ]}
                            block
                        />
                        <div className="sdwb-edit-scroll" data-canvas-wheel-scroll>
                            {mode === "image" ? (
                                <>
                                    <p className="sdwb-note">修改只应用于当前图片，原图保留在任务记录中。</p>
                                    <label className="sdwb-field">
                                        <span>改图要求</span>
                                        <Input.TextArea
                                            variant="filled"
                                            value={draft.instruction}
                                            maxLength={2000}
                                            autoSize={{ minRows: 5, maxRows: 10 }}
                                            placeholder="例如：保留构图，将标题缩小，增加花草的自然光影"
                                            onChange={(event) => patch(selected.key, { instruction: event.target.value })}
                                        />
                                    </label>
                                    <label className="sdwb-field">
                                        <span>本张提示词</span>
                                        <Input.TextArea variant="filled" value={prompt} maxLength={12000} autoSize={{ minRows: 7, maxRows: 20 }} onChange={(event) => patch(selected.key, { prompt: event.target.value })} />
                                    </label>
                                </>
                            ) : (
                                <>
                                    <p className="sdwb-note">点选图中文字框，即可定位并修改对应文案。清空一行，重新生成时将移除该段文字并修复背景。</p>
                                    {!detection ? (
                                        <div className="sdwb-detect">
                                            <ScanText size={28} />
                                            <span>从原图识别文字与位置</span>
                                            <Button loading={detecting === selected.key} disabled={Boolean(detecting) || busy} icon={<ScanText size={15} />} onClick={() => void detect()}>
                                                识别图片文字
                                            </Button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="sdwb-detection-meta">
                                                <span>识别到 {detection.regions.length} 行</span>
                                                <Button type="text" size="small" disabled={changed || busy || Boolean(detecting)} loading={detecting === selected.key} onClick={() => void detect()}>
                                                    重新识别
                                                </Button>
                                            </div>
                                            {!detection.regions.length ? <p className="sdwb-note">未检测到清晰文字，可在“调整画面”中描述修改要求。</p> : null}
                                            {detection.regions.map((region, index) => (
                                                <label key={region.id} className="sdwb-text-row" data-active={activeRegion === region.id || undefined}>
                                                    <span>{index + 1}</span>
                                                    <textarea
                                                        aria-label={`第 ${index + 1} 行文字`}
                                                        ref={(element) => {
                                                            if (element) inputs.current.set(region.id, element);
                                                            else inputs.current.delete(region.id);
                                                        }}
                                                        value={draft.values[region.id] ?? region.text}
                                                        rows={1}
                                                        maxLength={500}
                                                        onFocus={() => locate(region.id, false)}
                                                        onChange={(event) => patch(selected.key, { values: { ...draft.values, [region.id]: event.target.value } })}
                                                    />
                                                    <Button type="text" size="small" aria-label={`清空第 ${index + 1} 行`} onClick={() => patch(selected.key, { values: { ...draft.values, [region.id]: "" } })}>
                                                        清空
                                                    </Button>
                                                </label>
                                            ))}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                        <footer className="sdwb-submit">
                            {errors[selected.key] ? <p role="alert">{errors[selected.key]}</p> : null}
                            {busy ? <p role="status">正在修改这张图片…{pending[selected.key].progress ? ` ${pending[selected.key].progress}%` : ""}</p> : null}
                            <span className="sdwb-model">{model ? modelDisplayName(config, model) : "正在读取原图模型"} · 1 张</span>
                            <Button type="primary" block icon={<RotateCcw size={15} />} loading={submitting || busy} disabled={!model || quote.value === null || (mode === "text" && !changed)} onClick={() => void submit()}>
                                <span>按修改重新生成</span>
                                <CreditStar className="size-3.5" />
                                <span>{price}</span>
                            </Button>
                        </footer>
                    </aside>
                </div>
            </div>
            {preview ? <CanvasImagePreview storageKey={resourceStorageKey(selected.resourceId)} previewSrc={resourceVariantUrl(selected.resourceId, "thumbnail")} alt={selected.plan?.theme || "详情图"} onClose={() => setPreview(false)} /> : null}
        </AppModal>
    );
}
