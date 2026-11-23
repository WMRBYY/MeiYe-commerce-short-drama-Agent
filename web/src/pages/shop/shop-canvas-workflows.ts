import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import { readShopCanvasProjects, saveShopCanvasProjects } from "./shop-canvas-projects";
import { COMMERCE_WORKFLOW_LIBRARY } from "./shop-canvas-workflow-library";
import { reconcileShopCanvasVideoInput } from "./shop-canvas-normal-video-state";

export type ShopWorkflow = { id: string; name: string; nodes: CanvasLayer[]; description?: string; cover?: string; category?: "商品" | "服饰" | "视频"; requirements?: string[]; limitation?: string };
export const SYSTEM_WORKFLOWS: ShopWorkflow[] = [
    ...COMMERCE_WORKFLOW_LIBRARY,
    {
        id: "main",
        name: "商品主图 · 从文案到视觉",
        description: "整理商品卖点，搭建主图创作链路",
        nodes: [
            { id: "copy", type: "text", text: "商品：\n核心卖点：\n目标受众：\n平台：", x: 100, y: 100 },
            { id: "image", type: "draft", draftKind: "chat", text: "商品主图", x: 500, y: 100, inputs: ["copy"] },
        ],
    },
    {
        id: "fashion",
        name: "服饰展示 · 换装与三视图",
        description: "替换商品和模特素材，保持同款细节",
        nodes: [
            { id: "outfit", type: "draft", draftKind: "outfit", text: "AI 换装", x: 100, y: 100 },
            { id: "views", type: "draft", draftKind: "model-views", text: "模特三视图", x: 500, y: 100, inputs: ["outfit"] },
        ],
    },
    {
        id: "polish",
        name: "商品精修 · 背景与高清",
        description: "搭建场景、提升清晰度，完成商品精修",
        nodes: [
            { id: "bg", type: "draft", draftKind: "background", text: "换背景", x: 100, y: 100 },
            { id: "hd", type: "draft", draftKind: "upscale", text: "高清放大", x: 500, y: 100, inputs: ["bg"] },
        ],
    },
];

export async function readShopWorkflows(scope: string): Promise<ShopWorkflow[]> {
    const raw = await localForageStorageForScope(scope).getItem("shop-canvas-workflows");
    const value: unknown = raw ? JSON.parse(String(raw)) : [];
    return Array.isArray(value) ? value.filter((t): t is ShopWorkflow => typeof t?.id === "string" && typeof t.name === "string" && Array.isArray(t.nodes)) : [];
}

export async function saveShopWorkflow(scope: string, workflow: ShopWorkflow) {
    const previous = await readShopWorkflows(scope);
    const next = [...previous, workflow];
    await localForageStorageForScope(scope).setItem("shop-canvas-workflows", JSON.stringify(next));
    return next;
}

/** A copied workflow is a disconnected snapshot: all links and groups receive fresh identities. */
export function cloneWorkflowNodes(source: CanvasLayer[], group = false): CanvasLayer[] {
    const ids = new Map<string, string>(source.map((n) => [n.id, crypto.randomUUID()]));
    const groupId = crypto.randomUUID();
    const groups = new Map(source.filter((n) => n.groupId).map((n) => [n.groupId!, crypto.randomUUID()]));
    return structuredClone(source).map((n) => ({
        ...n,
        id: ids.get(n.id)!,
        config: n.draftKind === "video-replace" && n.config && typeof n.config === "object" && "video" in n.config && n.config.video && typeof n.config.video === "object" ? { ...n.config, video: { ...n.config.video, projectId: undefined } } : n.config,
        type: n.type === "generation" ? (n.resourceId ? "image" : "draft") : n.type,
        generationKey: undefined,
        videoProjectId: undefined,
        videoTaskId: undefined,
        videoResultUnavailable: undefined,
        videoStage: undefined,
        videoFailed: undefined,
        normalVideoDraft: n.normalVideoDraft ? reconcileShopCanvasVideoInput(n.normalVideoDraft, n.normalVideoLinks, []).draft : undefined,
        normalVideoLinks: undefined,
        inputs: n.inputs?.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)),
        managedInputIds: n.managedInputIds?.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)),
        groupId: group ? groupId : n.groupId ? groups.get(n.groupId) : undefined,
    }));
}

export async function copyWorkflowProject(scope: string, userId: string, workflow: ShopWorkflow) {
    const project = { id: crypto.randomUUID(), name: workflow.name, updatedAt: new Date().toISOString() };
    const nodes = cloneWorkflowNodes(workflow.nodes, true);
    await localForageStorageForScope(scope).setItem(`ecommerce-canvas:shop-canvas:${userId}:${project.id}`, JSON.stringify(nodes));
    saveShopCanvasProjects(userId, [project, ...readShopCanvasProjects(userId)]);
    return project;
}
