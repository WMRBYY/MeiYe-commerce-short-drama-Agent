import { Button, Popover } from "antd";
import { Check, Images, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { resolveResourceVariantUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import type { EcommerceCreativeDirection, EcommerceDraft, EcommercePlan, EcommercePlanImage } from "@/services/api/ecommerce";
import type { AiConfig } from "@/stores/use-config-store";
import { imageTypes, labelOf } from "./catalog";
import { SingleImageEditor } from "./result-gallery";
import { commerceCopyHasDirections } from "./consumer-copy";
import { commerceCanvasImages } from "./continuation";
import { ecommerceText } from "./display-text";
import { writeCommerceImageTransfer } from "./image-transfer";

function imageSource(task?: GenerationTask) {
    if (!task || task.status !== "succeeded") return undefined;
    try {
        const result = parseBackendGenerationResult(task)?.images?.[0];
        if (result?.storageKey) return resolveResourceVariantUrl(result.storageKey, "thumbnail");
        if (result?.dataUrl) return result.dataUrl;
    } catch {
        /* Persisted previews may be unavailable for older tasks. */
    }
    return task.previewUrl;
}

export function EcommerceAgentFeed({
    direction,
    plan,
    tasks,
    config,
    draft,
    imageModels,
    imageCost,
    onRegenerate,
    onRetry,
    onFocus,
}: {
    direction: EcommerceCreativeDirection | null;
    plan: EcommercePlan | null;
    tasks: Record<string, GenerationTask>;
    config: AiConfig;
    draft: EcommerceDraft;
    imageModels: string[];
    imageCost: number | null;
    onRegenerate: (image: EcommercePlanImage) => Promise<void>;
    onRetry: (image: EcommercePlanImage) => void;
    onFocus: (id: string) => void;
}) {
    const { t } = useTranslation();
    const [editing, setEditing] = useState<string>();
    const [expanded, setExpanded] = useState<string>();
    const complete = plan?.images.filter((image) => image.taskId && imageSource(tasks[image.taskId])).length || 0;
    const total = commerceCanvasImages(plan).length;
    const submitted = plan?.images.some((image) => image.taskId);
    const active = submitted && plan?.images.some((image) => image.taskId && (!tasks[image.taskId] || !["succeeded", "failed", "cancelled"].includes(tasks[image.taskId].status)));
    return (
        <div className="commerce-agent-feed">
            {direction ? (
                <div className="commerce-direction-choice">
                    <small>{t("ecommerce.agentFeed.chosenDirection")}</small>
                    <strong>{direction.name}</strong>
                    <span>{direction.summary.split(" 知识约束：{")[0]}</span>
                </div>
            ) : null}
            {plan && active ? (
                <section className="commerce-generation-message" role="status" aria-label={t("ecommerce.agentFeed.progressLabel")}>
                    <header>
                        <span className="commerce-generation-glyph">
                            <Sparkles size={17} />
                        </span>
                        <strong>{t("ecommerce.agentFeed.generating")}</strong>
                        <span>
                            {complete} / {total}
                        </span>
                    </header>
                    <div className="commerce-generation-visual">
                        <span className="commerce-yoru-glow" />
                        <Sparkles size={34} aria-label={t("ecommerce.agentFeed.creating")} />
                        <span className="commerce-generation-particles" aria-hidden="true" />
                    </div>
                    <div className="commerce-generation-track" aria-label={t("ecommerce.agentFeed.progressTrack", { complete, total })}>
                        <span style={{ width: `${total ? (complete / total) * 100 : 0}%` }} />
                    </div>
                    <p>
                        <LoaderCircle size={14} className="commerce-planning-spin" />
                        {t("ecommerce.agentFeed.progressHint")}
                    </p>
                </section>
            ) : null}
            {commerceCanvasImages(plan).map((image, index) => {
                const task = image.taskId ? tasks[image.taskId] : undefined;
                const src = imageSource(task);
                let resourceId = image.resourceId;
                try {
                    resourceId ||= task ? resourceIdFromStorageKey(parseBackendGenerationResult(task)?.images?.[0]?.storageKey) : undefined;
                } catch {
                    /* Legacy previews still provide their URL. */
                }
                if (!src && task && ["failed", "cancelled"].includes(task.status))
                    return (
                        <section className="commerce-generated-card" key={image.id} role="alert">
                            <header>
                                <span className="commerce-generation-glyph">
                                    <Images size={16} />
                                </span>
                                <strong>{t("ecommerce.agentFeed.failedTitle", { index: index + 1 })}</strong>
                            </header>
                            <p>{task.error || t("ecommerce.agentFeed.failedDetail")}</p>
                            <Button size="small" onClick={() => onRetry(image)}>
                                {task.canRecoverMedia ? t("ecommerce.agentFeed.recover") : t("ecommerce.agentFeed.retry")}
                            </Button>
                        </section>
                    );
                if (!src) return null;
                return (
                    <section className="commerce-generated-card" key={`${image.id}:${image.taskId}`} aria-label={t("ecommerce.agentFeed.resultLabel", { index: index + 1 })}>
                        <header>
                            <span className="commerce-generation-glyph">
                                <Check size={16} />
                            </span>
                            <strong>{t("ecommerce.agentFeed.generated")}</strong>
                            <small>
                                {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
                            </small>
                        </header>
                        <p>
                            {ecommerceText(labelOf(imageTypes, image.imageType))}
                            <span> · {image.ratio}</span>
                        </p>
                        <button type="button" className="commerce-generated-preview" onClick={() => onFocus(image.id)} aria-label={t("ecommerce.agentFeed.focusLabel", { index: index + 1 })}>
                            <img src={src} alt={t("ecommerce.agentFeed.imageAlt", { index: index + 1 })} draggable onDragStart={(event) => writeCommerceImageTransfer(event.dataTransfer, { resourceId, name: `第 ${index + 1} 张生成结果`, url: src })} />
                        </button>
                        <footer>
                            <Popover
                                open={editing === image.id}
                                onOpenChange={(open) => setEditing(open ? image.id : undefined)}
                                trigger="click"
                                placement="rightTop"
                                destroyOnHidden
                                content={<SingleImageEditor key={`${image.id}:${image.taskId}`} config={config} draft={image.sourceDraft || draft} image={image} imageModels={imageModels} onClose={() => setEditing(undefined)} onGenerate={onRegenerate} />}
                            >
                                <Button size="small" icon={<RotateCcw size={14} />} onClick={() => setEditing(image.id)}>
                                    {t("ecommerce.agentFeed.regenerate")}
                                    {imageCost == null ? "" : t("ecommerce.agentFeed.regenerateCost", { amount: imageCost.toLocaleString(currentLocale(), { maximumFractionDigits: 3 }) })}
                                </Button>
                            </Popover>
                            <Button size="small" icon={<Images size={14} />} onClick={() => setExpanded((id) => (id === image.id ? undefined : image.id))} aria-expanded={expanded === image.id}>
                                {t("ecommerce.agentFeed.viewCopy")}
                            </Button>
                        </footer>
                        {expanded === image.id ? (
                            <div className="commerce-generated-plan">
                                <strong>{t("ecommerce.agentFeed.performance")}</strong>
                                <p>{image.performanceAngle || t("ecommerce.agentFeed.performanceFallback")}</p>
                                <strong>{t("ecommerce.agentFeed.information")}</strong>
                                <p>{image.informationComponent || t("ecommerce.agentFeed.informationFallback")}</p>
                                <strong>{t("ecommerce.agentFeed.copy")}</strong>
                                <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{!image.copy || commerceCopyHasDirections(image.copy) ? t("ecommerce.agentFeed.copyFallback") : image.copy}</p>
                            </div>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}
