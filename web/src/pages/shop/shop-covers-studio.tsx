import { App } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { Check, ClipboardCopy, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { CreditStar } from "@/components/ui/credit-star";
import { RollingCreditAmount } from "@/components/rolling-credit-text";
import { generationErrorMessage } from "@/lib/generation-error";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceFileUrl, resourceVariantUrl } from "@/services/api/resources";
import { listGenerationTasks, subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { createWorkbenchTask } from "@/services/api/workbench";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useCommerceDisplayConfig } from "@/pages/ecommerce/admin-models";
import { useUserStore } from "@/stores/use-user-store";
import { submitCommerceTaskWhenSlotAvailable } from "@/pages/ecommerce/generation-slot";
import { outputResourceId } from "@/pages/ecommerce/tryon/tryon-runtime";
import { commerceImageParameters } from "@/pages/ecommerce/workflow";

import { COVER_SPECS, type CoverSpec } from "./shop-cover-prompts";
import { editSize, useImageQuote } from "./shop-edits";

const STORE = "shop-cover-tasks";
type TaskMap = Record<string, string>;

function readTasks(): TaskMap {
    try {
        return JSON.parse(window.localStorage.getItem(STORE) || "{}") as TaskMap;
    } catch {
        return {};
    }
}

/** 服务端用批次号找回这张封面属于哪个功能：shopcover_<功能去掉连字符>_<时间>。 */
const batchId = (spec: CoverSpec) => `shopcover_${spec.key.replace(/-/g, "")}_${Date.now().toString(36)}`;

/**
 * 管理员工具：用站内图片模型为视频复刻 / 剧本创作的功能卡生成封面。
 * 每张单独提交、单独计费，生成完成后由开发把成片固化为站点静态封面。
 */
export default function ShopCoversStudio() {
    const { message, modal } = App.useApp();
    const reduced = useReducedMotion();
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const baseConfig = useEffectiveConfig();
    const config = useCommerceDisplayConfig(baseConfig);
    const imageModels = useMemo(() => selectableModelsByCapability(config, "image").filter((model) => Boolean(logicalModelIDForConfig({ ...config, model })) || resolveModelChannel(config, model).scope === "system"), [config]);
    const [picked, setPicked] = useState("");
    const model = picked && imageModels.includes(picked) ? picked : imageModels[0] || "";
    const profile = model ? modelCapabilityConfigFor(config, model).image : undefined;
    const resolutions = profile?.resolution.supported ? profile.resolution.values : [];
    const [pickedResolution, setResolution] = useState("");
    const resolution = resolutions.includes(pickedResolution) ? pickedResolution : resolutions.find((value) => /2k/i.test(value)) || profile?.resolution.default || profile?.quality.default || "auto";
    const size = editSize(config, model, "1:1", 1, 1);
    const quote = useImageQuote(config, model, size, resolution, 0);
    const [prompts, setPrompts] = useState<Record<string, string>>(() => Object.fromEntries(COVER_SPECS.map((spec) => [spec.key, spec.prompt])));
    const [taskIds, setTaskIds] = useState<TaskMap>(readTasks);
    const [tasks, setTasks] = useState<Record<string, GenerationTask>>({});
    const [submitting, setSubmitting] = useState<Set<string>>(new Set());
    const [errors, setErrors] = useState<Record<string, string>>({});

    const ids = Object.values(taskIds);
    const idsKey = ids.join("|");
    useEffect(() => {
        if (!ids.length) return;
        return subscribeGenerationTasks(ids, (task) => setTasks((current) => ({ ...current, [task.id]: task })));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    const saveTask = (key: string, id: string) =>
        setTaskIds((current) => {
            const next = { ...current, [key]: id };
            try {
                window.localStorage.setItem(STORE, JSON.stringify(next));
            } catch {
                // 存不下也不影响服务端任务。
            }
            return next;
        });

    const submitOne = async (spec: CoverSpec) => {
        if (!profile) throw new Error("请先选择图片模型");
        const parameters = commerceImageParameters(profile, size, resolution);
        const logicalModelId = logicalModelIDForConfig({ ...config, model });
        const scope = getActiveUserScope();
        const task = await submitCommerceTaskWhenSlotAvailable({
            activeLimit: () => useUserStore.getState().runtimeLimits.activeTaskLimit,
            listActive: (limit) => listGenerationTasks(limit, { activeOnly: true }),
            assertCurrent: () => {
                if (getActiveUserScope() !== scope) throw new DOMException("账号已切换", "AbortError");
            },
            onWaiting: () => undefined,
            submit: () =>
                createWorkbenchTask({
                    kind: "image",
                    prompt: prompts[spec.key] || spec.prompt,
                    model: modelOptionName(model),
                    ...(logicalModelId ? { logicalModelId } : { channelId: resolveModelChannel(config, model).id }),
                    parameters,
                    references: [],
                    batch: { id: batchId(spec), index: 0, count: 1 },
                }),
        });
        saveTask(spec.key, task.id);
        setTasks((current) => ({ ...current, [task.id]: task }));
    };

    const run = async (specs: CoverSpec[]) => {
        for (const spec of specs) {
            setSubmitting((current) => new Set(current).add(spec.key));
            setErrors((current) => ({ ...current, [spec.key]: "" }));
            try {
                await submitOne(spec);
            } catch (cause) {
                const text = cause instanceof Error ? cause.message : "提交失败";
                setErrors((current) => ({ ...current, [spec.key]: text }));
                message.error(`「${spec.label}」提交失败：${text}`);
                break;
            } finally {
                setSubmitting((current) => {
                    const next = new Set(current);
                    next.delete(spec.key);
                    return next;
                });
            }
        }
    };

    const confirmRun = (specs: CoverSpec[]) => {
        if (!model) {
            message.warning("当前没有可用的图片模型");
            return;
        }
        if (creditsEnabled && quote.value === null) {
            message.warning(quote.loading ? "正在报价，请稍候" : "当前模型暂时无法报价，请换一个模型");
            return;
        }
        modal.confirm({
            title: `生成 ${specs.length} 张封面？`,
            content: quote.value !== null ? `按当前模型约 ${(quote.value * specs.length).toFixed(2)} 积分（${specs.length} 张 × ${quote.value.toFixed(2)}），从你的账户扣除。` : `共 ${specs.length} 张。`,
            okText: "开始生成",
            cancelText: "取消",
            onOk: () => void run(specs),
        });
    };

    const statusOf = (spec: CoverSpec) => {
        const id = taskIds[spec.key];
        const task = id ? tasks[id] : undefined;
        if (submitting.has(spec.key)) return { kind: "running" as const, text: "提交中" };
        if (errors[spec.key]) return { kind: "failed" as const, text: errors[spec.key] };
        if (!id) return { kind: "idle" as const, text: "未生成" };
        if (!task) return { kind: "running" as const, text: "读取中" };
        if (task.status === "succeeded") {
            const resourceId = outputResourceId(task);
            return resourceId ? { kind: "done" as const, text: "已完成", resourceId } : { kind: "running" as const, text: "保存成片中" };
        }
        if (task.status === "failed" || task.status === "cancelled") return { kind: "failed" as const, text: generationErrorMessage(task.error) || "生成失败" };
        return { kind: "running" as const, text: typeof task.progress === "number" ? `${Math.round(task.progress)}%` : "生成中" };
    };
    const doneMap = Object.fromEntries(
        COVER_SPECS.map((spec) => [spec.key, statusOf(spec)])
            .filter(([, status]) => (status as { kind: string }).kind === "done")
            .map(([key, status]) => [key, (status as { resourceId: string }).resourceId]),
    );
    const doneCount = Object.keys(doneMap).length;

    if (!isAdmin)
        return (
            <div className="sp-page ms-scope scs-page">
                <div className="sp-empty">
                    <strong>仅管理员可用</strong>
                </div>
            </div>
        );

    return (
        <div className="sp-page ms-scope scs-page">
            <header className="scs-head">
                <div>
                    <h1>功能卡封面生成</h1>
                    <p>用站内图片模型为「视频复刻」「剧本创作」的 {COVER_SPECS.length} 个功能生成正方形封面。每张单独计费，生成后告诉开发固化到站点。</p>
                </div>
                <div className="scs-controls">
                    <div className="scs-model">
                        <ModelPicker
                            config={config}
                            capability="image"
                            value={model}
                            onChange={setPicked}
                            modelFilter={(value) => imageModels.includes(value)}
                            closeOnSelect
                            className="creation-model-picker"
                            variant="creation"
                            showSelectedPrice={false}
                            showOptionPrices
                            placeholder="选择图片模型"
                        />
                    </div>
                    {resolutions.length ? (
                        <div className="svc-seg">
                            {resolutions.map((value) => (
                                <button key={value} type="button" data-active={value === resolution || undefined} onClick={() => setResolution(value)}>
                                    {value === resolution ? <motion.i layoutId="scs-res" /> : null}
                                    <span>{value.toUpperCase()}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <span className="scs-price">
                        {quote.value !== null ? (
                            <>
                                <CreditStar /> <RollingCreditAmount value={quote.value} maximumFractionDigits={2} /> 积分/张
                            </>
                        ) : quote.loading ? (
                            "报价中…"
                        ) : (
                            "--"
                        )}
                    </span>
                    <button type="button" className="sml-btn-ink" onClick={() => confirmRun(COVER_SPECS.filter((spec) => statusOf(spec).kind !== "done" && statusOf(spec).kind !== "running"))}>
                        <Sparkles className="size-3.5" />
                        生成未完成的全部
                    </button>
                    <button
                        type="button"
                        className="sml-btn"
                        disabled={!doneCount}
                        onClick={() => {
                            void navigator.clipboard.writeText(JSON.stringify(doneMap, null, 2)).then(() => message.success(`已复制 ${doneCount} 张封面清单`));
                        }}
                    >
                        <ClipboardCopy className="size-3.5" />
                        复制清单（{doneCount}/{COVER_SPECS.length}）
                    </button>
                </div>
            </header>
            <div className="scs-grid">
                {COVER_SPECS.map((spec, index) => {
                    const status = statusOf(spec);
                    return (
                        <motion.article key={spec.key} className="scs-card" data-status={status.kind} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 20) * 0.02 }}>
                            <div className="scs-image">
                                {status.kind === "done" ? (
                                    <a href={resourceFileUrl(status.resourceId)} target="_blank" rel="noreferrer">
                                        <img src={resourceVariantUrl(status.resourceId, "thumbnail")} alt={spec.label} />
                                    </a>
                                ) : status.kind === "running" ? (
                                    <span className="scs-wait">
                                        <i className="si-shimmer" />
                                        <LoaderCircle className="sp-spin size-5" />
                                        {status.text}
                                    </span>
                                ) : status.kind === "failed" ? (
                                    <span className="scs-wait is-failed">
                                        <TriangleAlert className="size-5" />
                                        {status.text}
                                    </span>
                                ) : (
                                    <span className="scs-wait">未生成</span>
                                )}
                            </div>
                            <header>
                                <strong>{spec.label}</strong>
                                <small>{spec.group === "video" ? "视频复刻" : "剧本创作"}</small>
                                {status.kind === "done" ? <Check className="scs-ok size-4" /> : null}
                            </header>
                            <textarea value={prompts[spec.key]} rows={4} onChange={(event) => setPrompts((current) => ({ ...current, [spec.key]: event.target.value }))} />
                            <button type="button" className="sml-btn" disabled={status.kind === "running"} onClick={() => confirmRun([spec])}>
                                <RefreshCw className="size-3.5" />
                                {status.kind === "idle" ? "生成这张" : "重新生成"}
                            </button>
                        </motion.article>
                    );
                })}
            </div>
        </div>
    );
}
