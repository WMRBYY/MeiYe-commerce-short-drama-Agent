import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { createClientUUID } from "@/lib/client-id";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { getActiveUserScope } from "@/lib/user-scope";
import { quoteModel } from "@/services/api/logical-models";
import { resourceIdFromStorageKey, resourceVariantUrl, uploadResourceFile } from "@/services/api/resources";
import { appQueryClient } from "@/lib/query-client";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { loadAssetLibraryPage, loadAssetsForUse, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { listGenerationTasks, retryGenerationTask, subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { createWorkbenchTask } from "@/services/api/workbench";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { cacheGenerationTasks, getCachedGenerationTasks, loadCachedGenerationTasks } from "@/services/generation-task-cache";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

import { submitCommerceTaskWhenSlotAvailable } from "@/pages/ecommerce/generation-slot";
import { mergeCommerceTask } from "@/pages/ecommerce/task-state";
import { outputResourceId } from "@/pages/ecommerce/tryon/tryon-runtime";
import { commerceImageParameters } from "@/pages/ecommerce/workflow";
import { getEcommerceProject, listEcommerceProjects, projectDraft, retryEcommerceExecution, type EcommerceBatchExecutionRequest, type EcommerceProject } from "@/services/api/ecommerce";
import { sendDetailRequest } from "./detail-outbox";
import { ApiError } from "@/services/api/request";
import { useEffectiveConfig } from "@/stores/use-config-store";

/**
 * 电商模式里不属于批量换装的出图：对话生图，以及对照台里的局部重绘、智能重绘、高清放大、图片抠图；
 * 裁剪和加噪点在本机完成，结果上传后同样记成一条。任务在服务端，本机只记任务编号与回填信息。
 */

export type ShopEditKind = "chat" | "inpaint" | "repaint" | "upscale" | "cutout" | "crop" | "noise" | "upload";

export const SHOP_EDIT_LABEL: Record<ShopEditKind, string> = {
    chat: "对话生图",
    inpaint: "局部重绘",
    repaint: "智能重绘",
    upscale: "高清放大",
    cutout: "图片抠图",
    crop: "裁剪",
    noise: "加噪点",
    upload: "本地上传",
};

export type ShopEditRecord = {
    id: string;
    /** 同一次提交的多张共用一个 group。 */
    group: string;
    index: number;
    kind: ShopEditKind;
    createdAt: string;
    /** 用户写的话：卡片上展示，「重新编辑」回填到输入框。 */
    text: string;
    prompt: string;
    model: string;
    modelLabel: string;
    ratio: string;
    resolution: string;
    /** 「重新编辑」回填的参考图。 */
    references: string[];
    /** 实际提交给模型的参考图（局部重绘含标注图）。 */
    submitRefs: string[];
    /** 原图：对照台按 O 查看。 */
    baseResourceId?: string;
    /** 本机加工直接得到的成片。 */
    resourceId?: string;
    taskId?: string;
    projectId?: string;
    canvasProjectId?: string;
    executionRequest?: EcommerceBatchExecutionRequest;
    state: "waiting" | "submitting" | "submitted" | "done" | "failed";
    error?: string;
    width?: number;
    height?: number;
};

type EditState = { scope: string; records: ShopEditRecord[]; tasks: Record<string, GenerationTask>; loaded: boolean };

const KEY = "shop-edit-records";
const MAX_RECORDS = 400;
let state: EditState = { scope: "", records: [], tasks: {}, loaded: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

function save(scope: string) {
    if (state.scope !== scope) return;
    return Promise.resolve(localForageStorageForScope(scope).setItem(KEY, JSON.stringify(state.records.slice(0, MAX_RECORDS))));
}

function setRecords(scope: string, updater: (records: ShopEditRecord[]) => ShopEditRecord[]) {
    if (state.scope !== scope) return;
    state = { ...state, records: updater(state.records) };
    emit();
    void save(scope)?.catch(() => undefined);
}

function patchRecord(scope: string, id: string, patch: Partial<ShopEditRecord>) {
    setRecords(scope, (records) => records.map((record) => (record.id === id ? { ...record, ...patch } : record)));
}

async function load(scope: string) {
    if (state.scope === scope) return;
    state = { scope, records: [], tasks: Object.fromEntries(getCachedGenerationTasks(scope).map((task) => [task.id, task])), loaded: false };
    emit();
    let records: ShopEditRecord[] = [];
    try {
        const [raw, cached] = await Promise.all([localForageStorageForScope(scope).getItem(KEY), loadCachedGenerationTasks(scope)]);
        if (state.scope !== scope) return;
        state = { ...state, tasks: { ...Object.fromEntries(cached.map((task) => [task.id, task])), ...state.tasks } };
        const parsed = raw ? (JSON.parse(String(raw)) as ShopEditRecord[]) : [];
        records = Array.isArray(parsed) ? parsed.filter((record) => record && typeof record.id === "string" && record.kind in SHOP_EDIT_LABEL) : [];
    } catch {
        records = [];
    }
    if (state.scope !== scope) return;
    // 页面关闭时还没拿到任务编号的张：无法确认是否已创建，标记失败让用户手动重试，避免重复扣费。
    records = records.map((record) =>
        (record.state === "waiting" || record.state === "submitting") && !record.taskId && !record.projectId && !record.executionRequest ? { ...record, state: "failed", error: "旧任务提交回执未确认，请查看历史记录后重试" } : record,
    );
    state = { ...state, records, loaded: true };
    emit();
    void reconcilePersistedTasks(scope, records);
}

/**
 * 页面关闭或项目接口短暂失败时，批量执行可能已经创建任务，但本地记录还没有拿到 taskId。
 * 按项目 ID补查服务端任务，避免这种记录永久停留在 waiting/submitting。
 */
async function reconcilePersistedTasks(scope: string, records: ShopEditRecord[]) {
    const projectIds = [...new Set(records.filter((record) => !record.taskId && record.projectId && record.state !== "failed").map((record) => record.projectId as string))];
    for (const projectId of projectIds) {
        if (state.scope !== scope || getActiveUserScope() !== scope) return;
        let tasks: GenerationTask[];
        try {
            tasks = await listGenerationTasks(100, { projectId, activeOnly: false });
        } catch {
            continue;
        }
        if (!tasks.length || state.scope !== scope) continue;

        const matched: GenerationTask[] = [];
        setRecords(scope, (current) => {
            const available = tasks.filter((task) => !current.some((record) => record.taskId === task.id));
            return current.map((record) => {
                if (record.projectId !== projectId || record.taskId || record.state === "failed") return record;
                const exact = available.find((task) => task.prompt === record.prompt);
                const task = exact || (available.length === 1 ? available[0] : undefined);
                if (!task) return record;
                const index = available.indexOf(task);
                if (index >= 0) available.splice(index, 1);
                matched.push(task);
                return { ...record, taskId: task.id, state: "submitted", error: undefined };
            });
        });
        matched.forEach((task) => setTask(scope, task));
    }
}

const materializing = new Set<string>();

function setTask(scope: string, task: GenerationTask) {
    if (state.scope !== scope || getActiveUserScope() !== scope) return;
    if (state.tasks[task.id] && state.tasks[task.id].updatedAt > task.updatedAt) return;
    const merged = mergeCommerceTask(task, state.tasks[task.id]);
    if (merged === state.tasks[task.id]) return;
    state = { ...state, tasks: { ...state.tasks, [task.id]: merged } };
    cacheGenerationTasks([merged], scope);
    emit();
    // 成片登记进资产库（与换装一致），素材库与作品页都能看到。
    if (merged.status === "succeeded" && !merged.outputs?.some((output) => output.materializedAssetId) && !materializing.has(task.id)) {
        materializing.add(task.id);
        void materializeGenerationTaskAssets(merged)
            .then((ready) => setTask(scope, ready))
            .catch(() => materializing.delete(task.id));
    }
}

/** 一条记录当前的成片资源；没有成片时为空串。 */
export function shopEditOutput(record: ShopEditRecord, tasks: Record<string, GenerationTask>) {
    if (record.resourceId) return record.resourceId;
    return record.taskId ? outputResourceId(tasks[record.taskId]) : "";
}

export function useShopEdits(scope: string, canvasProjectId?: string, watchedEditIds?: ReadonlySet<string>) {
    const snapshot = useSyncExternalStore(subscribe, () => state);
    const config = useEffectiveConfig();
    useEffect(() => {
        if (scope) void load(scope);
    }, [scope]);
    const records = snapshot.scope === scope ? snapshot.records : [];
    const tasks = snapshot.scope === scope ? snapshot.tasks : {};
    // 画布优先恢复本项目；完成结果直接展示，并与进行中任务一起在后台校准。
    const watchIds = useMemo(
        () =>
            records
                .filter((record) => (!canvasProjectId || record.canvasProjectId === canvasProjectId || watchedEditIds?.has(record.id)) && record.taskId)
                .sort((a, b) => Number(["succeeded", "failed", "cancelled"].includes(tasks[a.taskId!]?.status || "")) - Number(["succeeded", "failed", "cancelled"].includes(tasks[b.taskId!]?.status || "")))
                .map((record) => record.taskId as string)
                .slice(0, 80),
        [canvasProjectId, records, tasks, watchedEditIds],
    );
    const key = watchIds.join("|");
    useEffect(() => {
        if (!watchIds.length) return;
        return subscribeGenerationTasks(watchIds, (task) => setTask(scope, task));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, scope]);
    const restoreKey = records
        .filter((record) => record.projectId || record.executionRequest)
        .map((record) => record.group)
        .join("|");
    useEffect(() => {
        if (!snapshot.loaded || snapshot.scope !== scope) return;
        void restoreShopExecutions(scope);
        const timer = window.setInterval(() => void restoreShopExecutions(scope), 3000);
        return () => window.clearInterval(timer);
    }, [scope, snapshot.loaded]);
    useEffect(() => {
        if (!restoreKey) return;
        for (const record of records)
            if (!record.projectId && record.executionRequest)
                void submitShopExecution(
                    { scope, config },
                    records.filter((item) => item.group === record.group),
                );
    }, [scope, restoreKey]);
    return { records, tasks, loaded: snapshot.scope === scope && snapshot.loaded };
}

export function removeShopEdit(scope: string, id: string) {
    setRecords(scope, (records) => records.filter((record) => record.id !== id));
}

// ---------- 提交 ----------

export type ShopRunContext = { scope: string; config: AiConfig };

export type ShopEditSpec = {
    kind: ShopEditKind;
    text: string;
    prompt: string;
    references: string[];
    submitRefs: string[];
    baseResourceId?: string;
    width?: number;
    height?: number;
};

export function nearestRatio(width: number | undefined, height: number | undefined, values: string[], fallback: string) {
    if (!width || !height) return fallback;
    const target = width / height;
    let best = fallback;
    let bestDiff = Infinity;
    for (const value of values) {
        const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(value);
        if (!match) continue;
        const diff = Math.abs(Math.log(Number(match[1]) / Number(match[2]) / target));
        if (diff < bestDiff) {
            bestDiff = diff;
            best = value;
        }
    }
    return best;
}

/** 按模型支持的比例换算：有原图时跟随原图比例，否则用选中的比例。 */
export function editSize(config: AiConfig, model: string, ratio: string, width?: number, height?: number) {
    const profile = modelCapabilityConfigFor(config, model).image;
    const values = profile?.size.values.length ? profile.size.values : [profile?.size.default || "1:1"];
    if (width && height)
        return nearestRatio(
            width,
            height,
            values.filter((value) => value !== "auto"),
            values.includes("auto") ? "auto" : values[0],
        );
    if (ratio && values.includes(ratio)) return ratio;
    return profile?.size.default || values[0];
}

const running = new Set<string>();

async function pump(ctx: ShopRunContext) {
    const { scope } = ctx;
    if (running.has(scope)) return;
    running.add(scope);
    try {
        for (;;) {
            if (state.scope !== scope) break;
            // 先提交的在前：记录按时间倒序存放，从末尾找最早的等待项。
            const next = [...state.records].reverse().find((record) => record.state === "waiting" && !record.projectId && !record.executionRequest);
            if (!next) break;
            const profile = modelCapabilityConfigFor(ctx.config, next.model).image;
            if (!profile) {
                patchRecord(scope, next.id, { state: "failed", error: "这张使用的图片模型已不可用，请换一个模型后重试" });
                continue;
            }
            if (next.submitRefs.length > Math.min(20, profile.references.maxImages || 0)) {
                patchRecord(scope, next.id, { state: "failed", error: `当前图片模型最多接收 ${profile.references.maxImages || 0} 张参考图，这张需要 ${next.submitRefs.length} 张，请换用支持多图参考的模型` });
                continue;
            }
            const parameters = commerceImageParameters(profile, next.ratio, next.resolution);
            const logicalModelId = logicalModelIDForConfig({ ...ctx.config, model: next.model });
            const max = profile.references.promptMaxChars;
            patchRecord(scope, next.id, { state: "submitting", error: undefined });
            try {
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
                            prompt: max && next.prompt.length > max ? next.prompt.slice(0, max) : next.prompt,
                            model: modelOptionName(next.model),
                            ...(logicalModelId ? { logicalModelId } : { channelId: resolveModelChannel(ctx.config, next.model).id }),
                            parameters,
                            references: next.submitRefs.map((resourceId) => ({ resourceId, kind: "image" as const, role: "reference" as const })),
                        }),
                });
                patchRecord(scope, next.id, { state: "submitted", taskId: task.id });
                setTask(scope, task);
            } catch (cause) {
                if (cause instanceof DOMException && cause.name === "AbortError") {
                    patchRecord(scope, next.id, { state: "waiting" });
                    break;
                }
                const message = cause instanceof Error && cause.message ? cause.message : "提交失败";
                patchRecord(scope, next.id, { state: "failed", error: message });
                // 余额不足、权限或模型问题会让同批后面的张都失败：同组剩下的一并停下，不连续扣费。
                setRecords(scope, (records) => records.map((record) => (record.group === next.group && record.state === "waiting" ? { ...record, state: "failed", error: `同批前一张提交失败：${message}` } : record)));
            }
        }
    } finally {
        running.delete(scope);
    }
}

const submittingGroups = new Set<string>();
const restoringGroups = new Set<string>();

function adoptShopExecution(scope: string, project: EcommerceProject) {
    if (state.scope !== scope || getActiveUserScope() !== scope) return;
    const run = projectDraft(project).execution;
    if (run?.kind !== "shop-edit" || !Array.isArray(run.clientState)) return;
    const sources = run.clientState as ShopEditRecord[];
    setRecords(scope, (current) => {
        const next = [...current];
        for (const source of sources) {
            const job = run.jobs?.find((item) => item.key === source.id);
            const position = next.findIndex((item) => item.id === source.id);
            const existing = position >= 0 ? next[position] : source;
            const record: ShopEditRecord = { ...existing, projectId: project.id, taskId: job?.taskId || existing.taskId, state: job?.taskId ? "submitted" : run.status === "failed" ? "failed" : "waiting", error: job?.taskId ? undefined : run.error };
            if (position >= 0) next[position] = record;
            else next.unshift(record);
        }
        return next;
    });
}

async function restoreShopExecutions(scope: string) {
    if (restoringGroups.has(scope) || getActiveUserScope() !== scope) return;
    restoringGroups.add(scope);
    try {
        const projects = await listEcommerceProjects();
        projects.forEach((project) => adoptShopExecution(scope, project));
    } catch {
        /* Keep existing cards while offline. */
    } finally {
        restoringGroups.delete(scope);
    }
}

async function submitShopExecution(ctx: ShopRunContext, records: ShopEditRecord[]) {
    const group = records[0]?.group;
    if (!group || submittingGroups.has(group) || getActiveUserScope() !== ctx.scope) return;
    submittingGroups.add(group);
    try {
        let request = records[0].executionRequest;
        if (!request) {
            request = {
                id: group,
                kind: "shop-edit",
                title: records[0].text.slice(0, 40) || SHOP_EDIT_LABEL[records[0].kind],
                clientState: records,
                jobs: records.map((record) => {
                    const profile = modelCapabilityConfigFor(ctx.config, record.model).image;
                    if (!profile) throw new Error("图片模型不可用");
                    const logicalModelId = logicalModelIDForConfig({ ...ctx.config, model: record.model });
                    return {
                        key: record.id,
                        request: {
                            kind: "image",
                            model: modelOptionName(record.model),
                            ...(logicalModelId ? { logicalModelId } : { channelId: resolveModelChannel(ctx.config, record.model).id }),
                            prompt: profile.references.promptMaxChars ? record.prompt.slice(0, profile.references.promptMaxChars) : record.prompt,
                            parameters: commerceImageParameters(profile, record.ratio, record.resolution),
                            references: record.submitRefs.map((resourceId) => ({ resourceId, kind: "image", role: "reference" })),
                        },
                    };
                }),
            };
            setRecords(ctx.scope, (list) => list.map((record) => (record.group === group ? { ...record, executionRequest: request, state: "submitting" } : record)));
            await save(ctx.scope);
        }
        const project = await sendDetailRequest(ctx.scope, request);
        adoptShopExecution(ctx.scope, project);
    } catch (error) {
        const text = error instanceof Error ? error.message : "提交未完成，输入已保留";
        setRecords(ctx.scope, (list) => list.map((record) => (record.group === group ? { ...record, state: error instanceof ApiError && error.retryable ? "submitting" : "failed", error: text } : record)));
    } finally {
        submittingGroups.delete(group);
    }
}

/** 立即显示记录，再将完整一批保存到服务器；后续执行不依赖页面。 */
export function submitShopEdits(ctx: ShopRunContext, options: { model: string; modelLabel: string; ratio: string; resolution: string; canvasProjectId?: string }, specs: ShopEditSpec[]) {
    const group = createClientUUID();
    const createdAt = new Date().toISOString();
    const records: ShopEditRecord[] = specs.map((spec, index) => ({
        id: createClientUUID(),
        group,
        index,
        createdAt,
        model: options.model,
        modelLabel: options.modelLabel,
        canvasProjectId: options.canvasProjectId,
        ratio: editSize(ctx.config, options.model, options.ratio, spec.width, spec.height),
        resolution: options.resolution,
        state: "waiting",
        ...spec,
    }));
    setRecords(ctx.scope, (list) => [...[...records].reverse(), ...list]);
    void submitShopExecution(ctx, records);
    return records;
}

export function retryShopEdit(ctx: ShopRunContext, id: string) {
    const record = state.records.find((item) => item.id === id);
    if (record?.taskId) {
        void retryGenerationTask(record.taskId)
            .then((task) => {
                patchRecord(ctx.scope, id, { state: "submitted", error: undefined });
                setTask(ctx.scope, task);
            })
            .catch((error) => patchRecord(ctx.scope, id, { error: error instanceof Error ? error.message : "重试失败" }));
        return;
    }
    if (record?.projectId) {
        void retryEcommerceExecution(record.projectId)
            .then((project) => adoptShopExecution(ctx.scope, project))
            .catch(() => undefined);
        return;
    }
    if (record?.executionRequest) {
        void submitShopExecution(
            ctx,
            state.records.filter((item) => item.group === record.group),
        );
        return;
    }
    patchRecord(ctx.scope, id, { state: "waiting", taskId: undefined, error: undefined });
    void pump(ctx);
}

/** 本机加工（裁剪、加噪点）：上传成片后记成一条已完成的记录。 */
export async function addLocalShopEdit(scope: string, kind: "crop" | "noise", blob: Blob, source: { baseResourceId: string; text: string; width: number; height: number; modelLabel?: string }) {
    const resource = await uploadResourceFile(blob, "image", { fileName: `${kind}-${Date.now()}.png` });
    const record: ShopEditRecord = {
        id: createClientUUID(),
        group: createClientUUID(),
        index: 0,
        kind,
        createdAt: new Date().toISOString(),
        text: source.text,
        prompt: "",
        model: "",
        modelLabel: source.modelLabel || "本机加工",
        ratio: `${source.width}:${source.height}`,
        resolution: "",
        references: [source.baseResourceId],
        submitRefs: [],
        baseResourceId: source.baseResourceId,
        resourceId: resource.id,
        state: "done",
        width: source.width,
        height: source.height,
    };
    setRecords(scope, (list) => [record, ...list]);
    return record;
}

async function localImageSize(file: Blob) {
    try {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size.width > 0 && size.height > 0 ? size : null;
    } catch {
        return null;
    }
}

/** 本地上传 / 粘贴的图片记成一条「本地上传」记录，供对照台和作品区直接使用。 */
export async function addUploadedShopImage(scope: string, file: File) {
    const [resource, size] = await Promise.all([uploadResourceFile(file, "image", { fileName: file.name || `pasted-${Date.now()}.png` }), localImageSize(file)]);
    const record: ShopEditRecord = {
        id: createClientUUID(),
        group: createClientUUID(),
        index: 0,
        kind: "upload",
        createdAt: new Date().toISOString(),
        text: file.name || "粘贴图片",
        prompt: "",
        model: "",
        modelLabel: "本地上传",
        ratio: size ? `${size.width}:${size.height}` : "",
        resolution: "",
        references: [],
        submitRefs: [],
        resourceId: resource.id,
        state: "done",
        ...(size ? { width: size.width, height: size.height } : {}),
    };
    setRecords(scope, (list) => [record, ...list]);
    return record;
}

// ---------- 对话生图草稿 ----------

export type ChatRef = { id: string; resourceId: string; previewUrl: string; name: string; error?: string };
export type ChatDraft = { text: string; refs: ChatRef[]; count: number };

const CHAT_KEY = "shop-chat-draft:";
let chatScope = "";
let chat: ChatDraft = { text: "", refs: [], count: 1 };
function currentChat() {
    const scope = getActiveUserScope();
    if (chatScope === scope) return chat;
    chatScope = scope;
    chat = { text: "", refs: [], count: 1 };
    try {
        const saved = JSON.parse(window.localStorage.getItem(CHAT_KEY + scope) || "null") as ChatDraft | null;
        if (saved && typeof saved.text === "string")
            chat = { text: saved.text, count: Math.max(1, Math.min(8, Number(saved.count) || 1)), refs: (saved.refs || []).filter((ref) => ref.resourceId).map((ref) => ({ ...ref, previewUrl: resourceVariantUrl(ref.resourceId, "thumbnail") })) };
    } catch {
        /* A stored draft must never cross account boundaries. */
    }
    return chat;
}
const chatListeners = new Set<() => void>();

export function updateChatDraft(updater: (draft: ChatDraft) => ChatDraft) {
    chat = updater(currentChat());
    try {
        window.localStorage.setItem(CHAT_KEY + chatScope, JSON.stringify({ ...chat, refs: chat.refs.filter((ref) => ref.resourceId) }));
    } catch {
        // 存储不可用时只在内存里保留。
    }
    chatListeners.forEach((listener) => listener());
}

export function useChatDraft() {
    return useSyncExternalStore((listener) => {
        chatListeners.add(listener);
        return () => chatListeners.delete(listener);
    }, currentChat);
}

export const CHAT_MAX_REFS = 6;

export function addChatResources(picked: Array<{ resourceId: string; name?: string }>) {
    updateChatDraft((draft) => {
        const room = Math.max(0, CHAT_MAX_REFS - draft.refs.length);
        const next = picked
            .filter((item) => item.resourceId && !draft.refs.some((ref) => ref.resourceId === item.resourceId))
            .slice(0, room)
            .map((item) => ({ id: createClientUUID(), resourceId: item.resourceId, name: item.name || "参考图", previewUrl: resourceVariantUrl(item.resourceId, "thumbnail") }));
        return { ...draft, refs: [...draft.refs, ...next] };
    });
}

export async function addChatFiles(files: File[]) {
    const scope = getActiveUserScope();
    const room = Math.max(0, CHAT_MAX_REFS - currentChat().refs.length);
    const images = files.filter((file) => file.type.startsWith("image/")).slice(0, room);
    await Promise.all(
        images.map(async (file) => {
            const id = createClientUUID();
            updateChatDraft((draft) => ({ ...draft, refs: [...draft.refs, { id, resourceId: "", previewUrl: URL.createObjectURL(file), name: file.name }] }));
            try {
                const resource = await uploadResourceFile(file, "image");
                if (getActiveUserScope() === scope) updateChatDraft((draft) => ({ ...draft, refs: draft.refs.map((ref) => (ref.id === id ? { ...ref, resourceId: resource.id } : ref)) }));
            } catch (cause) {
                if (getActiveUserScope() === scope) updateChatDraft((draft) => ({ ...draft, refs: draft.refs.map((ref) => (ref.id === id ? { ...ref, error: cause instanceof Error ? cause.message : "上传失败" } : ref)) }));
            }
        }),
    );
    return files.length - images.length;
}

export function removeChatRef(id: string) {
    updateChatDraft((draft) => ({ ...draft, refs: draft.refs.filter((ref) => ref.id !== id) }));
}

// ---------- 报价 ----------

/** 单张图片的服务端报价（积分）。null 表示暂时无法报价。 */
export function useImageQuote(config: AiConfig, model: string, size: string, resolution: string, refs: number) {
    const request = useMemo(
        () =>
            systemModelQuoteRequest(config, model, "image", {
                capability: "image",
                input: { textCount: 1, imageCount: refs, referenceImageCount: refs, videoCount: 0, audioCount: 0, characterCount: 0 },
                imageSize: size,
                options: { size, imageResolution: resolution, count: 1 },
            }),
        [config, model, refs, resolution, size],
    );
    const requestKey = JSON.stringify(request) || "";
    const [quote, setQuote] = useState<{ requestKey: string; value: number | null; loading: boolean }>({ requestKey: "", value: null, loading: false });
    useEffect(() => {
        if (!request) {
            setQuote({ requestKey, value: null, loading: false });
            return;
        }
        const controller = new AbortController();
        setQuote({ requestKey, value: null, loading: true });
        const timer = window.setTimeout(() => {
            void quoteModel(request, controller.signal)
                .then((result) => !controller.signal.aborted && setQuote({ requestKey, value: result.quote.amountMicrocredits / 1_000_000, loading: false }))
                .catch(() => !controller.signal.aborted && setQuote({ requestKey, value: null, loading: false }));
        }, 250);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [request, requestKey]);
    return quote.requestKey === requestKey ? quote : { value: null, loading: Boolean(request) };
}

// ---------- 收藏 ----------

/**
 * 收藏记在服务端：给这张图在资产库里的那条素材打上「收藏」标签，随账号走，换电脑也在。
 * 本机 localStorage 只做秒开缓存，进入页面后以服务端为准。
 */
const FAV_KEY = "shop-favorites:";
const FAV_TAG = "收藏";
let favorites: { scope: string; ids: Set<string> } = { scope: "", ids: new Set() };
const favListeners = new Set<() => void>();
const favSynced = new Set<string>();

function setFavorites(scope: string, ids: Set<string>) {
    favorites = { scope, ids };
    try {
        window.localStorage.setItem(FAV_KEY + scope, JSON.stringify([...ids].slice(-3000)));
    } catch {
        // 缓存写不进去不影响服务端收藏。
    }
    favListeners.forEach((listener) => listener());
}

function favoritesFor(scope: string) {
    if (favorites.scope !== scope) {
        let ids: string[] = [];
        try {
            ids = JSON.parse(window.localStorage.getItem(FAV_KEY + scope) || "[]") as string[];
        } catch {
            ids = [];
        }
        favorites = { scope, ids: new Set(Array.isArray(ids) ? ids : []) };
    }
    return favorites;
}

function assetResourceId(asset: Asset) {
    const key = (asset.data as { storageKey?: string } | undefined)?.storageKey;
    return resourceIdFromStorageKey(key) || "";
}

/** 从服务端读回全部带「收藏」标签的素材。 */
async function syncFavorites(scope: string) {
    if (!scope || favSynced.has(scope)) return;
    favSynced.add(scope);
    try {
        const ids = new Set<string>();
        for (let page = 1; page <= 20; page++) {
            const result = await loadAssetLibraryPage({ page, pageSize: 100, status: "active", query: FAV_TAG });
            result.assets
                .filter((asset) => asset.tags?.includes(FAV_TAG))
                .forEach((asset) => {
                    const id = assetResourceId(asset);
                    if (id) ids.add(id);
                });
            if (!result.hasMore) break;
        }
        if (getActiveUserScope() === scope) setFavorites(scope, ids);
    } catch {
        favSynced.delete(scope);
    }
}

/** 按图片资源找到它在资产库里的素材；成片登记进资产库后才有。 */
async function findAssetForResource(resourceId: string, assertScope: () => void) {
    assertScope();
    const local = useAssetStore.getState().assets.find((asset) => assetResourceId(asset) === resourceId);
    if (local) return local;
    const result = await loadAssetLibraryPage({ page: 1, pageSize: 20, status: "active", query: resourceId });
    assertScope();
    const remote = result.assets.find((asset) => assetResourceId(asset) === resourceId);
    if (!remote) return null;
    await loadAssetsForUse([remote.id]);
    assertScope();
    return useAssetStore.getState().assets.find((asset) => asset.id === remote.id) || null;
}

const pendingFavorites = new Map<string, Promise<boolean>>();

/** 同一作品保存完成前复用请求，避免连续点击的回滚覆盖后一次结果。 */
export function toggleShopFavorite(scope: string, resourceId: string): Promise<boolean> {
    const key = JSON.stringify([scope, resourceId]);
    const pending = pendingFavorites.get(key);
    if (pending) return pending;
    const operation = saveShopFavorite(scope, resourceId).finally(() => pendingFavorites.delete(key));
    pendingFavorites.set(key, operation);
    return operation;
}

/** 切换收藏：界面立即变化，后台写到服务端；写失败时恢复并抛出原因。 */
async function saveShopFavorite(scope: string, resourceId: string) {
    const isCurrentScope = () => Boolean(scope && scope !== "guest" && getActiveUserScope() === scope && useUserStore.getState().user?.id === scope);
    const assertScope = () => {
        if (!isCurrentScope()) throw new Error("账号已切换，请重新收藏作品");
    };
    assertScope();
    if (!resourceId) throw new Error("作品资源不存在，请刷新后重试");
    const before = favoritesFor(scope).ids;
    const on = !before.has(resourceId);
    const optimistic = new Set(before);
    if (on) optimistic.add(resourceId);
    else optimistic.delete(resourceId);
    setFavorites(scope, optimistic);
    let changedAsset: Asset | null = null;
    try {
        const asset = await findAssetForResource(resourceId, assertScope);
        assertScope();
        if (!asset) throw new Error("这张图还没登记进资产库，稍后再收藏");
        changedAsset = asset;
        const tags = on ? [...new Set([...(asset.tags || []), FAV_TAG])] : (asset.tags || []).filter((tag) => tag !== FAV_TAG);
        useAssetStore.getState().updateAsset(asset.id, { tags });
        await flushAssetStorePersistence();
        assertScope();
        await saveRemoteUserDataNow([]);
        assertScope();
        void appQueryClient.invalidateQueries({ queryKey: ["asset-library"] });
        return on;
    } catch (cause) {
        if (!isCurrentScope()) throw cause;
        if (changedAsset) {
            const assetId = changedAsset.id;
            const current = useAssetStore.getState().assets.find((asset) => asset.id === assetId);
            if (current) {
                const tags = (current.tags || []).filter((tag) => tag !== FAV_TAG);
                if (changedAsset.tags?.includes(FAV_TAG)) tags.push(FAV_TAG);
                useAssetStore.getState().updateAsset(current.id, { tags });
                await flushAssetStorePersistence().catch(() => undefined);
            }
        }
        const reverted = new Set(favoritesFor(scope).ids);
        if (on) reverted.delete(resourceId);
        else reverted.add(resourceId);
        setFavorites(scope, reverted);
        throw cause;
    }
}

export function useShopFavorites(scope: string) {
    useEffect(() => {
        void syncFavorites(scope);
    }, [scope]);
    return useSyncExternalStore(
        (listener) => {
            favListeners.add(listener);
            return () => favListeners.delete(listener);
        },
        () => favoritesFor(scope).ids,
    );
}

/** 切换收藏并提示结果（成功 / 失败原因）。 */
export function favoriteWithNotice(message: { success: (text: string) => unknown; error: (text: string) => unknown }, scope: string, resourceId: string) {
    return toggleShopFavorite(scope, resourceId)
        .then((on) => message.success(on ? "已收藏，换电脑登录也能看到" : "已取消收藏"))
        .catch((cause: unknown) => message.error(cause instanceof Error ? cause.message : "收藏没保存成功，请稍后重试"));
}
