import { App, Button } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert, Copy, Download, Expand, History, ImagePlus, LoaderCircle, RotateCcw, Rows3, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { getActiveUserScope } from "@/lib/user-scope";
import { exportEcommerceLongImage, startEcommerceDownload, type EcommerceExportItem } from "@/pages/ecommerce/export";
import { readStreamedScreens } from "@/pages/ecommerce/stream-plan";
import { outputResourceId } from "@/pages/ecommerce/tryon/tryon-runtime";
import {
    confirmEcommerceExecution,
    deleteEcommerceProjects,
    getEcommerceProject,
    listEcommerceProjects,
    listEcommerceRounds,
    patchEcommerceRoundImage,
    projectDraft,
    projectPlan,
    retryEcommerceExecution,
    saveEcommerceProject,
    type EcommercePlanImage,
    type EcommerceProject,
} from "@/services/api/ecommerce";
import { ApiError } from "@/services/api/request";
import { resourceFileUrl, resourceVariantUrl } from "@/services/api/resources";
import { deleteGenerationTask, listGenerationTasks, queryGenerationTask, subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { deleteAssetsWithRemoteSync } from "@/services/user-data-sync";
import { getCachedGenerationTasks, loadCachedGenerationTasks } from "@/services/generation-task-cache";

import type { DetailRun } from "./detail-runs";
import { detailProjectCache } from "./detail-project-cache";
import { GridLayoutMenu, gridStyle, useGridLayout } from "./shop-layout";
import { useShopScope } from "./shop-context";
import { COMMERCE_THINKING_STEPS, ShopCreating, ShopThinking } from "./shop-thinking";
import { copyText, DetailRegenerateModal } from "./shop-image-viewer";
import { ShopDetailWorkbench, type DetailWorkbenchImage } from "./shop-detail-workbench";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useCommerceDisplayConfig } from "@/pages/ecommerce/admin-models";
import { generationErrorMessage } from "@/lib/generation-error";
import { findDetailPlanImage, regenerateDetailImage } from "./detail-regenerate";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const DETAIL_THINKING_STEPS = COMMERCE_THINKING_STEPS.map((step, index) => (index === 2 ? { label: "整理版式", detail: "根据参考素材安排商品、文案和留白" } : step));

type DetailImage = { key: string; project: EcommerceProject; taskId: string; index: number; plan?: EcommercePlanImage; status: "loading" | "running" | "done" | "failed"; resourceId: string; error?: string };

const HIDDEN_KEY = "shop-detail-hidden:";

function useHidden(scope: string) {
    const [hidden, setHidden] = useState<Set<string>>(() => {
        try {
            return new Set(JSON.parse(window.localStorage.getItem(HIDDEN_KEY + scope) || "[]") as string[]);
        } catch {
            return new Set();
        }
    });
    const hide = (keys: string[]) =>
        setHidden((current) => {
            const next = new Set([...current, ...keys]);
            try {
                window.localStorage.setItem(HIDDEN_KEY + scope, JSON.stringify([...next].slice(-3000)));
            } catch {
                // 存储不可用时只在本次有效。
            }
            return next;
        });
    return [hidden, hide] as const;
}

function exportItems(images: DetailImage[]): EcommerceExportItem[] {
    return images.map((image, index) => ({ image: image.plan || ({ imageType: projectDraft(image.project).imageType } as EcommercePlanImage), assetId: "", index, resourceId: image.resourceId }));
}

function IconButton({ title, onClick, disabled, children, tone }: { title: string; onClick: () => void; disabled?: boolean; children: ReactNode; tone?: "danger" }) {
    return (
        <AntTooltip title={title} mouseEnterDelay={0.2}>
            <motion.button type="button" className="sdw-icon" data-tone={tone} aria-label={title} disabled={disabled} onClick={onClick} whileHover={disabled ? undefined : { y: -2 }} whileTap={disabled ? undefined : { scale: 0.9 }}>
                {children}
            </motion.button>
        </AntTooltip>
    );
}

/**
 * 详情图右栏：只展示生成出来的图片（按项目分组，新的在前），历史项目在「历史项目」弹窗里。
 * 顶部：导出全部、拼成长图、布局；图片悬浮右上角：重新生成、下载、删除。
 */
export function ShopDetailWorks({
    projects,
    pending = [],
    focusProject,
    filters,
    onAgain,
    onOpenHistory,
    onBatchDeleted,
    onReload,
    onUseReference,
}: {
    projects: EcommerceProject[] | null;
    /** 刚点了生成、项目还没保存出来的轮次：先画思考动画和每屏等待位。 */
    pending?: DetailRun[];
    focusProject?: { id: string; at: number } | null;
    filters: ReactNode;
    onAgain: (project: EcommerceProject) => void;
    onOpenHistory: () => void;
    onBatchDeleted: (projectIds: string[]) => void;
    onReload: () => Promise<void>;
    /** 「用作参考图」：把这张成片加到左侧商品图或风格排版参考。 */
    onUseReference?: (resourceId: string, role: "product" | "style") => void;
}) {
    const { message, modal } = App.useApp();
    const reduced = useReducedMotion();
    const baseConfig = useEffectiveConfig();
    const config = useCommerceDisplayConfig(baseConfig);
    const [workbench, setWorkbench] = useState<{ images: DetailWorkbenchImage[]; initialKey: string } | null>(null);
    const [regenTarget, setRegenTarget] = useState<DetailImage | null>(null);
    const scope = useShopScope();
    const cacheScope = getActiveUserScope();
    const [layout, setLayout] = useGridLayout("detail");
    const [hidden, hide] = useHidden(scope);
    const [tasks, setTasks] = useState<Record<string, GenerationTask>>(() => Object.fromEntries(getCachedGenerationTasks(cacheScope).map((task) => [task.id, task])));
    useEffect(() => {
        let active = true;
        void loadCachedGenerationTasks(cacheScope).then((cached) => {
            if (active && getActiveUserScope() === cacheScope) setTasks((current) => ({ ...Object.fromEntries(cached.map((task) => [task.id, task])), ...current }));
        });
        return () => {
            active = false;
        };
    }, [cacheScope]);
    const [exporting, setExporting] = useState(false);
    const executionActions = useRef(new Set<string>());
    const [actionPending, setActionPending] = useState<Record<string, boolean>>({});
    const deletingBatches = useRef(new Set<string>());

    // 策划结束后重新拉一次项目，拿到存进方案里的整套图片。
    const [fresh, setFresh] = useState<Record<string, EcommerceProject>>({});
    useEffect(() => {
        const visible = Object.values(fresh).filter((project) => projects?.some((item) => item.id === project.id));
        if (getActiveUserScope() === cacheScope && visible.length) detailProjectCache.remember(cacheScope, visible);
    }, [fresh, projects, cacheScope]);
    const merged = useMemo(() => (projects || []).map((project) => (fresh[project.id] && fresh[project.id].revision >= project.revision ? fresh[project.id] : project)), [projects, fresh]);
    const ordered = useMemo(() => [...merged].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [merged]);
    // Restore server-owned runs and their task receipts on every shop page mount.
    const executions = ordered.flatMap((project) => {
        const run = projectDraft(project).execution;
        if (!run) return [];
        return [{ project, run, count: Math.max(1, projectDraft(project).count || 1) }];
    });
    const executionIds = executions
        .filter(({ run }) => run.status === "queued" || run.status === "running")
        .map(({ project }) => project.id)
        .join("|");
    useEffect(() => {
        if (!executionIds) return;
        let active = true;
        let loading = false;
        const refresh = async () => {
            if (loading || !active) return;
            loading = true;
            const ids = executionIds.split("|").filter(Boolean);
            const latest = await Promise.allSettled(ids.map((id) => getEcommerceProject(id)));
            loading = false;
            if (!active) return;
            setFresh((current) => ({ ...current, ...Object.fromEntries(latest.flatMap((result) => (result.status === "fulfilled" ? [[result.value.id, result.value]] : []))) }));
        };
        void refresh();
        const timer = window.setInterval(() => void refresh(), 2500);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [executionIds]);
    const executionAction = async (project: EcommerceProject, taskId?: string, resumeSaved = false) => {
        const key = taskId || project.id;
        if (deletingBatches.current.has(project.id) || executionActions.current.has(key)) return;
        executionActions.current.add(key);
        setActionPending((current) => ({ ...current, [key]: true }));
        try {
            if (taskId && !projectPlan(project)?.images.some((image) => image.taskId === taskId && projectDraft(project).execution)) {
                const source = await findDetailPlanImage(project.id, taskId);
                if (!source) throw new Error("找不到这张图的策划，请从原项目重新生成");
                const saved = await regenerateDetailImage(config, source, source.image);
                setFresh((current) => ({ ...current, [saved.project.id]: saved.project }));
                await onReload();
                return;
            }
            const saved = resumeSaved ? await confirmEcommerceExecution(project.id, "exclude") : await retryEcommerceExecution(project.id, taskId);
            setFresh((current) => ({ ...current, [saved.id]: saved }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败，请重试");
        } finally {
            executionActions.current.delete(key);
            setActionPending((current) => ({ ...current, [key]: false }));
        }
    };
    // Existing browser Agent records are shown only for migrations created before server execution.
    const planning = useMemo(
        () =>
            ordered.flatMap((project) => {
                const draft = projectDraft(project);
                if (draft.execution) return [];
                const id = draft.planningTaskId;
                if (!id) return [];
                const planned = (projectPlan(project)?.images || []).filter((image) => image.taskId).length;
                return [{ project, taskId: id, count: Math.max(1, draft.count || 1), planned }];
            }),
        [ordered],
    );
    const planningLoading = planning.filter((item) => !item.planned && !tasks[item.taskId]);
    const planningRunning = planning.filter((item) => !item.planned && tasks[item.taskId] && !TERMINAL.has(tasks[item.taskId].status));
    const planningFailed = planning.filter((item) => tasks[item.taskId]?.status === "failed" || tasks[item.taskId]?.status === "cancelled");
    const runningKey = planningRunning.map((item) => item.taskId).join("|");
    // 策划进行中，电商 Agent 每写完一屏就提交出图并在本机记回执；这里定时读回执，让已提交的屏立即出现。
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!runningKey) return;
        const timer = window.setInterval(() => setTick((value) => value + 1), 2500);
        return () => window.clearInterval(timer);
    }, [runningKey]);
    const slots = useMemo(
        () =>
            ordered.flatMap((project) => {
                const planImages = projectPlan(project)?.images || [];
                const fromPlan = planImages.flatMap((image, index) => (image.taskId ? [{ project, taskId: image.taskId, index, plan: image }] : []));
                const known = new Set(fromPlan.map((item) => item.taskId));
                const planningTaskId = projectDraft(project).planningTaskId;
                const streamed = planningTaskId
                    ? Object.entries(readStreamedScreens(scope, project.id, planningTaskId))
                          .sort((a, b) => Number(a[0]) - Number(b[0]))
                          .map(([, entry]) => entry.taskId)
                          .filter((id) => !known.has(id))
                    : [];
                for (const id of streamed) known.add(id);
                const fromStream = streamed.map((taskId, offset) => ({ project, taskId, index: fromPlan.length + offset, plan: undefined }));
                const covers = (project.coverTaskIds || []).filter((id) => !known.has(id)).map((taskId, offset) => ({ project, taskId, index: fromPlan.length + fromStream.length + offset, plan: undefined }));
                return [...fromPlan, ...fromStream, ...covers];
            }),
        // tick：定时重读本机的逐屏回执。
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ordered, scope, tick],
    );
    const taskIds = useMemo(
        () => [...new Set([...planning.map((item) => item.taskId), ...ordered.flatMap((project) => projectDraft(project).execution?.planningTaskId || []), ...slots.map((slot) => slot.taskId)])].slice(0, 400),
        [planning, ordered, slots],
    );
    // 策划任务结束（成功或失败）后稍等服务端保存方案，再拉一次项目。
    const finishedKey = planning
        .filter((item) => !item.planned && tasks[item.taskId] && TERMINAL.has(tasks[item.taskId].status))
        .map((item) => item.taskId)
        .join("|");
    useEffect(() => {
        if (!finishedKey) return;
        let cancelled = false;
        const load = () =>
            listEcommerceProjects()
                .then((list) => !cancelled && setFresh((current) => ({ ...current, ...Object.fromEntries(list.map((project) => [project.id, project])) })))
                .catch(() => undefined);
        const first = window.setTimeout(load, 1500);
        const second = window.setTimeout(load, 8000);
        return () => {
            cancelled = true;
            window.clearTimeout(first);
            window.clearTimeout(second);
        };
    }, [finishedKey]);
    const idsKey = taskIds.join("|");
    useEffect(() => {
        if (!taskIds.length) return;
        return subscribeGenerationTasks(taskIds, (task) => {
            if (getActiveUserScope() !== cacheScope) return;
            setTasks((current) => {
                const previous = current[task.id];
                return previous && (previous.updatedAt > task.updatedAt || (previous.status === task.status && previous.updatedAt === task.updatedAt)) ? current : { ...current, [task.id]: task };
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey, cacheScope]);

    const images = useMemo<DetailImage[]>(
        () =>
            slots.flatMap((slot): DetailImage[] => {
                const key = `${slot.project.id}:${slot.taskId}`;
                if (hidden.has(key)) return [];
                const task = tasks[slot.taskId];
                if (!task) return [{ ...slot, key, status: "loading", resourceId: "" }];
                if (task.status === "succeeded") {
                    const resourceId = outputResourceId(task);
                    return resourceId ? [{ ...slot, key, status: "done", resourceId }] : [];
                }
                if (task.status === "failed" || task.status === "cancelled") return [{ ...slot, key, status: "failed", resourceId: "", error: task.error || (task.status === "cancelled" ? "任务已取消" : "生成失败") }];
                return [{ ...slot, key, status: "running", resourceId: "" }];
            }),
        [hidden, slots, tasks],
    );
    const done = images.filter((image) => image.status === "done");
    const executionStillRunning = (project: EcommerceProject) => {
        const draft = projectDraft(project);
        const run = draft.execution;
        if (!run || (run.status !== "queued" && run.status !== "running")) return false;
        const submitted = (projectPlan(project)?.images || []).flatMap((image) => (image.taskId ? [image.taskId] : []));
        // The project receipt can lag behind its completed image tasks during restoration.
        return !(submitted.length >= Math.max(1, draft.count) && submitted.every((id) => tasks[id] && TERMINAL.has(tasks[id].status)));
    };
    const groups = useMemo(() => {
        const list: Array<{ project: EcommerceProject; images: DetailImage[] }> = [];
        for (const image of images) {
            const last = list[list.length - 1];
            if (last && last.project.id === image.project.id) last.images.push(image);
            else list.push({ project: image.project, images: [image] });
        }
        // 还在分析、一张图都没提交的项目也要出现（只显示思考动画和等待位）。
        for (const item of [...planningLoading, ...planningRunning, ...planningFailed]) {
            if (!list.some((group) => group.project.id === item.project.id)) list.unshift({ project: item.project, images: [] });
        }
        for (const item of executions) {
            if (!list.some((group) => group.project.id === item.project.id)) list.unshift({ project: item.project, images: [] });
        }
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [images, runningKey, ordered, tasks]);
    const latest = groups.find((group) => group.images.some((image) => image.status === "done"));
    const loading = projects === null;

    const download = (resourceId: string) => {
        const link = document.createElement("a");
        link.href = `${resourceFileUrl(resourceId)}?download=1`;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
    };
    const exportAll = () => {
        if (!done.length) return;
        startEcommerceDownload(exportItems(done));
        message.success(`开始导出 ${done.length} 张`);
    };
    const longImage = async () => {
        const items = latest?.images.filter((image) => image.status === "done") || [];
        if (items.length < 2) {
            message.info("最近一套至少要有 2 张图才能拼成长图");
            return;
        }
        setExporting(true);
        try {
            await exportEcommerceLongImage(latest?.project.name || "详情图", exportItems(items));
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "拼长图失败");
        } finally {
            setExporting(false);
        }
    };
    // 历史项目里点「打开」：滚到这套图并闪一下。
    const scrollRef = useRef<HTMLDivElement>(null);
    const [flash, setFlash] = useState("");
    useEffect(() => {
        if (!focusProject) return;
        const target = scrollRef.current?.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(focusProject.id)}"]`);
        if (!target) {
            message.info("这套详情图还没有出好的图片");
            return;
        }
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        setFlash(focusProject.id);
        const timer = window.setTimeout(() => setFlash(""), 1600);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusProject]);
    // 重新生成不跳页：弹窗里改提示词、模型、比例、分辨率后直接在本页提交。
    const regenerate = (image: DetailImage) => setRegenTarget(image);
    const openViewer = (image: DetailImage) => {
        setWorkbench({
            images: done
                .filter((item) => item.project.id === image.project.id)
                .sort((a, b) => a.index - b.index)
                .map((item) => ({ ...item, prompt: promptOf(item) })),
            initialKey: image.key,
        });
    };
    const promptOf = (image: DetailImage) => image.plan?.prompt || tasks[image.taskId]?.prompt || "";
    const useReference = (image: DetailImage, role: "product" | "style") => {
        if (!onUseReference) return;
        onUseReference(image.resourceId, role);
    };
    /**
     * 彻底删除一张图：从所在项目（当前方案或历史轮次）里移除，删除资产库里的成片，再删掉生成任务记录。
     * 任何一步失败就停下并提示，已完成的步骤不回滚（再点一次删除会继续完成剩下的）。
     */
    const destroy = async (image: DetailImage) => {
        const project = image.project;
        const plan = projectPlan(project);
        if (plan?.images.some((entry) => entry.taskId === image.taskId)) {
            const images = plan.images.filter((entry) => entry.taskId !== image.taskId);
            const next = images.length || plan.previousImages?.length ? { ...plan, images } : null;
            await saveEcommerceProject(project, { ...projectDraft(project), count: Math.max(1, images.length) }, next);
        } else {
            let before: number | undefined;
            for (let page = 0; page < 20; page++) {
                const result = await listEcommerceRounds(project.id, { limit: 50, before });
                const round = result.rounds.find((item) => item.plan?.images.some((entry) => entry.taskId === image.taskId));
                if (round) {
                    const target = round.plan!.images.find((entry) => entry.taskId === image.taskId)!;
                    await patchEcommerceRoundImage(project.id, round.id, target.id, { version: round.version, remove: true });
                    break;
                }
                if (!result.hasMore || !result.rounds.length) break;
                before = result.rounds[result.rounds.length - 1].ordinal;
            }
        }
        const assetIds = [...new Set((tasks[image.taskId]?.outputs || []).map((output) => output.materializedAssetId).filter((id): id is string => Boolean(id)))];
        if (assetIds.length) await deleteAssetsWithRemoteSync(assetIds);
        await deleteGenerationTask(image.taskId);
        hide([image.key]);
        await onReload();
    };
    const remove = (image: DetailImage) =>
        modal.confirm({
            title: "彻底删除这张图？",
            content: "会从所在项目、资产库和生成记录里一起删除，删除后无法恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await destroy(image);
                    message.success("已删除");
                } catch (cause) {
                    message.error(cause instanceof Error ? cause.message : "删除失败，请稍后重试");
                    throw cause;
                }
            },
        });

    const batchUnavailableReason = (project: EcommerceProject) => {
        const draft = projectDraft(project);
        const ids = slots.filter((slot) => slot.project.id === project.id).map((slot) => slot.taskId);
        const analysisId = draft.execution?.planningTaskId || draft.planningTaskId;
        if (analysisId) ids.push(analysisId);
        if (actionPending[project.id] || ids.some((id) => actionPending[id])) return "请等待当前操作完成";
        if (draft.execution?.status === "queued" || draft.execution?.status === "running" || ids.some((id) => tasks[id] && !TERMINAL.has(tasks[id].status))) {
            return "请等待本批次生成完成";
        }
        return "";
    };

    const removeBatch = (project: EcommerceProject) => {
        const id = project.id;
        modal.confirm({
            title: "删除这个批次？",
            content: `「${project.name || "未命名详情图"}」将从详情图和历史项目中移除。已生成的图片仍可在作品与素材库中查看。`,
            okText: "删除批次",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                if (deletingBatches.current.has(id)) return;
                deletingBatches.current.add(id);
                try {
                    if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开详情图");
                    const latest = await getEcommerceProject(id, { history: "active" }).catch((cause) => {
                        if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
                    });
                    if (latest) {
                        const draft = projectDraft(latest);
                        const planningId = draft.execution?.planningTaskId || draft.planningTaskId || draft.directionsTaskId;
                        const [active, planningTask] = await Promise.all([
                            listGenerationTasks(1, { projectId: id, activeOnly: true }),
                            planningId
                                ? queryGenerationTask(planningId).catch((cause) => {
                                      if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
                                  })
                                : undefined,
                        ]);
                        if (draft.execution?.status === "queued" || draft.execution?.status === "running" || active.length || (planningTask && !TERMINAL.has(planningTask.status))) {
                            throw new Error("本批次仍有任务在处理中，请完成后再删除");
                        }
                        if (latest.revision !== project.revision) {
                            setFresh((current) => ({ ...current, [id]: latest }));
                            throw new Error("本批次已更新，请关闭弹窗后重新确认删除");
                        }
                        if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开详情图");
                        await deleteEcommerceProjects({ ids: [id], expectedTotal: 1 });
                    }
                    if (getActiveUserScope() !== scope) return;
                    setWorkbench(null);
                    setRegenTarget(null);
                    onBatchDeleted([id]);
                } catch (cause) {
                    message.error(cause instanceof Error ? cause.message : "批次删除失败，请重试");
                } finally {
                    deletingBatches.current.delete(id);
                }
            },
        });
    };

    const batchDeleteButton = (project: EcommerceProject) => {
        const unavailableReason = batchUnavailableReason(project);
        return (
            <AntTooltip title={unavailableReason || "删除批次"}>
                <span className="sdw-batch-action">
                    <Button type="text" size="small" danger aria-label="删除批次" icon={<Trash2 className="size-3.5" />} disabled={Boolean(unavailableReason)} onClick={() => removeBatch(project)} />
                </span>
            </AntTooltip>
        );
    };

    return (
        <aside className="sdx-works sdw" aria-label="我的详情图">
            <header className="sdw-head">
                <h3>
                    我的详情图 <small>{done.length}</small>
                </h3>
                <span className="sdw-tools">
                    <IconButton title="导出全部（ZIP）" onClick={exportAll} disabled={!done.length}>
                        <Download className="size-4" />
                    </IconButton>
                    <IconButton title="把最近一套拼成长图" onClick={() => void longImage()} disabled={exporting || !latest}>
                        {exporting ? <LoaderCircle className="sp-spin size-4" /> : <Rows3 className="size-4" />}
                    </IconButton>
                    <i className="sdw-sep" />
                    <button type="button" className="sdx-tool" onClick={onOpenHistory}>
                        <History className="size-3.5" /> 历史项目
                    </button>
                    {filters}
                </span>
            </header>
            <div className="sdw-layout">
                <GridLayoutMenu layout={layout} onChange={setLayout} />
            </div>
            <div className="sdx-works-scroll" ref={scrollRef}>
                <AnimatePresence initial={false}>
                    {pending.map((run) => (
                        <motion.section key={run.id} className="sdw-group" data-pending initial={reduced ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                            <header>
                                <strong>{run.title || "详情图"}</strong>
                                <small>刚刚</small>
                            </header>
                            <div className="sdw-thinking">
                                <ShopThinking compact steps={DETAIL_THINKING_STEPS} since={run.startedAt} active={0} note={run.count ? `共 ${run.count} 屏` : "正在读取参考图与长图结构"} />
                            </div>
                            <div className="sdw-grid sp-grid-layout" data-cols={layout.cols} data-size={layout.size} style={gridStyle(layout)}>
                                {Array.from({ length: Math.max(1, Math.min(30, run.count)) }, (_, offset) => (
                                    <motion.div key={offset} className="sdw-card" data-status="running" initial={reduced ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(offset, 12) * 0.04 }}>
                                        <ShopCreating compact tone="wait" label={`第 ${offset + 1} 屏`} phrases={["读取商品", "等待分析", "排队构思"]} />
                                    </motion.div>
                                ))}
                            </div>
                        </motion.section>
                    ))}
                </AnimatePresence>
                {loading && !pending.length ? (
                    <div className="sdx-works-empty">
                        <LoaderCircle className="size-5 animate-spin" />
                    </div>
                ) : groups.length ? (
                    <>
                        {groups.map((group) => (
                            <section key={group.project.id} className="sdw-group" data-project-id={group.project.id} data-flash={flash === group.project.id || undefined}>
                                <header>
                                    <strong>{group.project.name || "未命名详情图"}</strong>
                                    <small>{new Date(group.project.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
                                    {batchDeleteButton(group.project)}
                                </header>
                                {planningLoading.some((item) => item.project.id === group.project.id) ? <p role="status">正在读取图片记录…</p> : null}
                                {(() => {
                                    const run = projectDraft(group.project).execution;
                                    if (!run) return null;
                                    const plan = projectPlan(group.project);
                                    const submitted = plan?.images.filter((image) => image.taskId).length || 0;
                                    const since = run.startedAt || (run.planningTaskId ? tasks[run.planningTaskId]?.createdAt : undefined);
                                    const stageLabel = run.stage === "planning" ? (submitted ? "策划与生图进行中" : "模型分析中") : "生图进行中";
                                    return (
                                        <div className="sdw-thinking">
                                            {executionStillRunning(group.project) ? (
                                                <ShopThinking
                                                    compact
                                                    steps={DETAIL_THINKING_STEPS}
                                                    key={run.id}
                                                    since={since}
                                                    restoring={!since}
                                                    active={submitted > 0 || run.stage !== "planning" ? 4 : run.status === "queued" ? 0 : undefined}
                                                    note={projectDraft(group.project).detailScreenCount === 0 && run.stage === "planning" ? "正在识别参考图屏数和上下衔接" : `${stageLabel} · 已提交 ${submitted}/${projectDraft(group.project).count} 张`}
                                                />
                                            ) : null}
                                            {run.error ? (
                                                <div className="sdw-error" role="alert">
                                                    <CircleAlert aria-hidden />
                                                    <div>
                                                        <strong>{run.stage === "planning" ? "模型分析失败" : "详情图生成失败"}</strong>
                                                        <p>{generationErrorMessage(run.error)}</p>
                                                    </div>
                                                    {run.status === "failed" && run.stage !== "submitted" ? (
                                                        <button type="button" className="sdx-tool" disabled={actionPending[group.project.id]} onClick={() => void executionAction(group.project)}>
                                                            重试
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                            {run.status === "awaiting_confirmation" ? (
                                                <button type="button" className="sdx-tool" disabled={actionPending[group.project.id]} onClick={() => void executionAction(group.project, undefined, true)}>
                                                    继续生成已保存的方案
                                                </button>
                                            ) : null}
                                        </div>
                                    );
                                })()}
                                {planningFailed.some((item) => item.project.id === group.project.id) ? (
                                    <div className="sdw-error" role="alert">
                                        <CircleAlert aria-hidden />
                                        <div>
                                            <strong>模型分析失败</strong>
                                            <p>可恢复参数，检查素材后重新生成。</p>
                                        </div>
                                        <button type="button" className="sdx-tool" onClick={() => onAgain(group.project)}>
                                            恢复参数
                                        </button>
                                    </div>
                                ) : null}
                                {(() => {
                                    const thinking = planningRunning.find((item) => item.project.id === group.project.id);
                                    if (!thinking) return null;
                                    const submitted = group.images.length;
                                    const task = tasks[thinking.taskId];
                                    return (
                                        <motion.div className="sdw-thinking" initial={reduced ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                                            <ShopThinking
                                                compact
                                                steps={DETAIL_THINKING_STEPS}
                                                since={task?.createdAt || group.project.updatedAt}
                                                active={submitted > 0 ? 4 : undefined}
                                                note={submitted ? `已出 ${submitted}/${thinking.count} 屏` : `共 ${thinking.count} 屏`}
                                            />
                                        </motion.div>
                                    );
                                })()}
                                <div className="sdw-grid sp-grid-layout" data-cols={layout.cols} data-size={layout.size} style={gridStyle(layout)}>
                                    <AnimatePresence initial={false}>
                                        {group.images.map((image, index) => (
                                            <motion.div
                                                key={image.key}
                                                layout={!reduced}
                                                className="sdw-card"
                                                data-status={image.status}
                                                initial={reduced ? false : { opacity: 0, y: 8, scale: 0.97 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.9 }}
                                                transition={{ delay: Math.min(index, 12) * 0.025, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                                            >
                                                {image.status === "done" ? (
                                                    <>
                                                        <img className="sdw-thumb" src={resourceVariantUrl(image.resourceId, "thumbnail")} alt={image.plan?.theme || ""} loading="lazy" draggable={false} />
                                                        <button type="button" className="sdw-zoom-hit" aria-label="放大查看" onClick={() => openViewer(image)} />
                                                        <span className="sdw-actions">
                                                            <IconButton title="放大查看" onClick={() => openViewer(image)}>
                                                                <Expand className="size-3.5" />
                                                            </IconButton>
                                                            <IconButton title="重新生成" onClick={() => regenerate(image)}>
                                                                <RotateCcw className="size-3.5" />
                                                            </IconButton>
                                                            {onUseReference ? (
                                                                <IconButton title="用作商品参考图" onClick={() => useReference(image, "product")}>
                                                                    <ImagePlus className="size-3.5" />
                                                                </IconButton>
                                                            ) : null}
                                                            <IconButton title="复制提示词" onClick={() => copyText(promptOf(image), message)} disabled={!promptOf(image)}>
                                                                <Copy className="size-3.5" />
                                                            </IconButton>
                                                            <IconButton title="下载" onClick={() => download(image.resourceId)}>
                                                                <Download className="size-3.5" />
                                                            </IconButton>
                                                            <IconButton title="删除" tone="danger" onClick={() => remove(image)}>
                                                                <Trash2 className="size-3.5" />
                                                            </IconButton>
                                                        </span>
                                                        {image.plan?.theme ? <span className="sdw-caption">{image.plan.theme}</span> : null}
                                                    </>
                                                ) : image.status === "failed" ? (
                                                    <div className="sdw-error" role="alert">
                                                        <CircleAlert aria-hidden />
                                                        <strong>第 {image.index + 1} 张生成失败</strong>
                                                        {image.error ? <span>{generationErrorMessage(image.error)}</span> : null}
                                                        <button type="button" className="sdx-tool" disabled={actionPending[image.taskId]} onClick={() => void executionAction(image.project, image.taskId)}>
                                                            重试
                                                        </button>
                                                    </div>
                                                ) : image.status === "loading" ? (
                                                    <div className="sdx-works-empty" style={{ minHeight: 0, height: "100%" }} role="status">
                                                        正在读取图片…
                                                    </div>
                                                ) : (
                                                    <ShopCreating compact progress={tasks[image.taskId]?.progress} since={tasks[image.taskId]?.createdAt} label={`第 ${index + 1} 屏创作中`} />
                                                )}
                                            </motion.div>
                                        ))}
                                        {(() => {
                                            const thinking = planningRunning.find((item) => item.project.id === group.project.id);
                                            const serverWaiting = executionStillRunning(group.project) ? projectDraft(group.project).count - group.images.length : 0;
                                            const waiting = Math.max(0, Math.min(30, thinking ? thinking.count - group.images.length : serverWaiting));
                                            return Array.from({ length: waiting }, (_, offset) => (
                                                <motion.div key={`wait-${offset}`} className="sdw-card" data-status="running" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                                    <ShopCreating compact tone="wait" label={`第 ${group.images.length + offset + 1} 屏`} phrases={["等待分析", "排队构思"]} />
                                                </motion.div>
                                            ));
                                        })()}
                                    </AnimatePresence>
                                </div>
                            </section>
                        ))}
                    </>
                ) : pending.length ? null : (
                    <div className="sdx-works-empty">还没有生成的详情图，左边做一套试试</div>
                )}
            </div>
            {workbench ? <ShopDetailWorkbench initialImages={workbench.images} initialKey={workbench.initialKey} onClose={() => setWorkbench(null)} onSubmitted={() => void onReload()} /> : null}
            <DetailRegenerateModal
                target={
                    regenTarget
                        ? {
                              projectId: regenTarget.project.id,
                              taskId: regenTarget.taskId,
                              image: { key: regenTarget.key, src: resourceFileUrl(regenTarget.resourceId), thumb: resourceVariantUrl(regenTarget.resourceId, "thumbnail"), title: regenTarget.plan?.theme },
                              fallbackPrompt: tasks[regenTarget.taskId]?.prompt,
                          }
                        : null
                }
                onClose={() => setRegenTarget(null)}
                onSubmitted={() => void onReload()}
            />
        </aside>
    );
}
