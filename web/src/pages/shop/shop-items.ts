import { useMemo } from "react";

import { generationErrorMessage } from "@/lib/generation-error";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";

import { tryOnFunction, type TryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { outputResourceId } from "@/pages/ecommerce/tryon/tryon-runtime";
import type { TryOnState } from "@/pages/ecommerce/tryon/use-tryon";

import { SHOP_EDIT_LABEL, shopEditOutput, type ShopEditKind, type ShopEditRecord } from "./shop-edits";

/** 生图记录与对照台共用的一张图：来自批量换装的某一张，或对话生图 / 对照台加工的一条。 */
export type ShopItem = {
    key: string;
    source: "tryon" | "edit" | "asset";
    chip: string;
    label: string;
    createdAt: string;
    text: string;
    status: "loading" | "running" | "done" | "failed";
    progress?: number;
    stage?: string;
    error?: string;
    resourceId: string;
    baseResourceId?: string;
    references: string[];
    model?: string;
    modelLabel: string;
    canvasProjectId?: string;
    ratio: string;
    resolution: string;
    /** 同一次提交里的第几张（从 1 开始）。 */
    order: number;
    batchId?: string;
    jobKey?: string;
    editId?: string;
    editKind?: ShopEditKind;
    tryOnFn?: TryOnFunction;
};

/** 顶部功能筛选：与参考站一致的完整列表；没有记录的功能也保留，点开是空状态。 */
export const SHOP_CHIPS: Array<{ key: string; label: string }> = [
    { key: "model-views", label: "模特三视图" },
    { key: "outfit", label: "换装" },
    { key: "fine-outfit", label: "精细化换装" },
    { key: "repaint", label: "智能重绘" },
    { key: "inpaint", label: "局部重绘" },
    { key: "upscale", label: "高清放大" },
    { key: "pose", label: "姿势参考" },
    { key: "cutout", label: "图片抠图" },
    { key: "background", label: "换背景" },
    { key: "scene", label: "场景提取" },
    { key: "face-swap", label: "模特换脸" },
    { key: "smart-head", label: "智能换头" },
    { key: "smart-face", label: "智能换脸" },
    { key: "enhance", label: "脸部增强" },
    { key: "chat", label: "对话生图" },
    { key: "print", label: "印花提取" },
    { key: "upload", label: "本地上传" },
];

const TRYON_CHIP: Record<TryOnFunction, string> = {
    "model-views": "model-views",
    outfit: "outfit",
    "fine-outfit": "fine-outfit",
    "multi-model": "outfit",
    "multi-outfit": "outfit",
    pose: "pose",
    "face-swap": "face-swap",
    "smart-face": "smart-face",
    "smart-head": "smart-head",
    background: "background",
    scene: "scene",
    enhance: "enhance",
    print: "print",
};

function taskStatus(task: GenerationTask | undefined): Pick<ShopItem, "status" | "progress" | "stage" | "error" | "resourceId"> {
    if (!task) return { status: "loading", stage: "正在读取作品", resourceId: "" };
    if (task.status === "succeeded") {
        const resourceId = outputResourceId(task);
        return resourceId ? { status: "done", resourceId } : { status: "running", stage: "正在保存成片", resourceId: "" };
    }
    if (task.status === "failed" || task.status === "cancelled") return { status: "failed", error: task.status === "cancelled" ? "任务已取消" : generationErrorMessage(task.error) || "生成失败", resourceId: "" };
    return { status: "running", progress: generationTaskShowsProgress(task) && typeof task.progress === "number" ? task.progress : undefined, stage: generationTaskStageLabel(task), resourceId: "" };
}

export function useShopItems(state: TryOnState, records: ShopEditRecord[], editTasks: Record<string, GenerationTask>) {
    return useMemo(() => {
        const items: ShopItem[] = [];
        // 只展开已订阅任务状态的批次；更早的批次没有任务状态，会一直停在“创作中”，由“加载更多”逐批展开。
        for (const batch of state.shown) {
            const label = tryOnFunction(batch.fn).label;
            const text = (batch.source?.notes || "").trim() || batch.summary || label;
            batch.jobs.forEach((job, index) => {
                if (job.hidden) return;
                const view =
                    job.state === "failed" && !job.taskId
                        ? { status: "failed" as const, error: job.error, resourceId: "" }
                        : job.state === "waiting" || job.state === "submitting"
                          ? { status: "running" as const, stage: job.state === "waiting" ? "排队中" : "提交中", resourceId: "" }
                          : taskStatus(job.taskId ? state.tasks[job.taskId] : undefined);
                const base = job.references.find((ref) => ref.role === "model" || ref.role === "subject")?.resourceId || job.references[0]?.resourceId;
                items.push({
                    key: `t:${batch.id}:${job.key}`,
                    source: "tryon",
                    chip: TRYON_CHIP[batch.fn],
                    label,
                    createdAt: batch.createdAt,
                    text,
                    ...view,
                    baseResourceId: base,
                    references: job.references.map((ref) => ref.resourceId),
                    model: batch.model,
                    modelLabel: batch.modelLabel,
                    canvasProjectId: batch.canvasProjectId,
                    ratio: job.size || batch.ratio,
                    resolution: batch.resolution,
                    order: index + 1,
                    batchId: batch.id,
                    jobKey: job.key,
                    tryOnFn: batch.fn,
                });
            });
        }
        for (const record of records) {
            const output = shopEditOutput(record, editTasks);
            const view =
                record.state === "done" && output
                    ? { status: "done" as const, resourceId: output }
                    : record.state === "failed"
                      ? { status: "failed" as const, error: record.error, resourceId: "" }
                      : record.state === "waiting" || record.state === "submitting"
                        ? { status: "running" as const, stage: record.state === "waiting" ? "排队中" : "提交中", resourceId: "" }
                        : taskStatus(record.taskId ? editTasks[record.taskId] : undefined);
            items.push({
                key: `e:${record.id}`,
                source: "edit",
                chip: record.kind,
                label: SHOP_EDIT_LABEL[record.kind],
                createdAt: record.createdAt,
                text: record.text || SHOP_EDIT_LABEL[record.kind],
                ...view,
                baseResourceId: record.baseResourceId,
                references: record.references,
                model: record.model,
                modelLabel: record.modelLabel,
                canvasProjectId: record.canvasProjectId,
                ratio: record.ratio,
                resolution: record.resolution,
                order: record.index + 1,
                editId: record.id,
                editKind: record.kind,
            });
        }
        return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.order - b.order);
    }, [editTasks, records, state.shown, state.tasks]);
}

export function dayKey(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function dayLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "更早";
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "今天";
    if (date.toDateString() === yesterday.toDateString()) return "昨天";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function stampLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 按天分组，保持输入顺序（新的在前）。 */
export function groupByDay<T extends { createdAt: string }>(items: T[]) {
    const groups: Array<{ key: string; label: string; items: T[] }> = [];
    for (const item of items) {
        const key = dayKey(item.createdAt);
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.items.push(item);
        else groups.push({ key, label: dayLabel(item.createdAt), items: [item] });
    }
    return groups;
}
