import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type * as EcommerceTypes from "../../src/services/api/ecommerce";
import type { DetailPlanSource } from "../../src/pages/shop/detail-regenerate";
import type { GenerationTask } from "../../src/services/api/task-center";

const dom = new Window({ url: "http://localhost/" });
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
const storage = new Map<string, string>();
// Replace the storage driver before loading stores; keep the application's
// scoped persistence wrapper and edit submission logic real.
const memoryDriver = {
    config: () => undefined,
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
        storage.set(key, String(value));
        return value;
    },
    removeItem: async (key: string) => {
        storage.delete(key);
    },
    keys: async () => [...storage.keys()],
    clear: async () => {
        storage.clear();
    },
    createInstance: () => memoryDriver,
};
mock.module("localforage", () => ({ default: memoryDriver }));
const { default: localforage } = await import("localforage");
const ecommerce = await import("../../src/services/api/ecommerce");
const workbench = await import("../../src/services/api/workbench");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { createModelChannel, defaultConfig, normalizeConfigSnapshot } = await import("../../src/stores/use-config-store");
const { completeDetailEditAttempt, editDetailImage } = await import("../../src/pages/shop/detail-regenerate");
const profile = defaultModelCapabilityConfig();
profile.image!.references.maxImages = 2;
profile.image!.size = { parameter: "size", values: ["1:1", "3:4"], default: "1:1", allowCustom: false };
profile.image!.resolution = { supported: true, values: ["1k", "2k"], default: "1k" };
const imageModel = "edit-test::image";
const config = normalizeConfigSnapshot({
    config: {
        ...defaultConfig,
        model: imageModel,
        imageModel,
        channels: [
            createModelChannel({
                id: "edit-test",
                name: "测试改图",
                scope: "system",
                models: ["image"],
                modelCosts: [{ model: "image", capability: "image", capabilityConfig: profile, pricePolicy: "channel", billingMode: "fixed_request", unitPriceMicrocredits: 100_000 }],
            }),
        ],
    },
}).config;
const task: GenerationTask = { id: "edited-task", type: "canvas_image", status: "queued", prompt: "保存后的真实任务提示词", attempts: 0, createdAt: "2026-11-21", updatedAt: "2026-11-21" };
let source: DetailPlanSource;
let latest: EcommerceTypes.EcommerceProject;
let create: ReturnType<typeof spyOn<typeof workbench, "createWorkbenchTask">>;
let save: ReturnType<typeof spyOn<typeof ecommerce, "saveEcommerceProject">>;

beforeEach(() => {
    storage.clear();
    spyOn(localforage, "getItem").mockImplementation(async (key) => storage.get(key) ?? (null as never));
    spyOn(localforage, "setItem").mockImplementation(async (key, value) => {
        storage.set(key, String(value));
        return value;
    });
    spyOn(localforage, "removeItem").mockImplementation(async (key) => {
        storage.delete(key);
    });
    setActiveUserScope("edit-owner");
    const image: EcommerceTypes.EcommercePlanImage = {
        id: "image-1",
        taskId: "original-task",
        imageType: "detail",
        platform: "taobao",
        language: "zh-CN",
        goal: "场景",
        theme: "自然",
        composition: "左文右图",
        mainVisual: "商品",
        verifiedClaims: "",
        copy: "原文案",
        lighting: "日光",
        fidelity: "保留外观",
        prompt: "原提示词",
        negativePrompt: "",
        imageModel,
        ratio: "3:4",
        resolution: "2k",
    };
    const plan: EcommerceTypes.EcommercePlan = { productSummary: "商品", confirmedFacts: [], uncertainFacts: [], qualityChecks: [], visualStrategy: "绿色外景", images: [image, { ...image, id: "image-2", taskId: "untouched-task" }] };
    const project: EcommerceTypes.EcommerceProject = {
        id: "detail-project",
        name: "详情项目",
        status: "draft",
        revision: 3,
        draftJson: JSON.stringify(ecommerce.emptyEcommerceDraft()),
        planJson: JSON.stringify(plan),
        createdAt: "2026-11-21",
        updatedAt: "2026-11-21",
    };
    source = { image, plan, project, round: null };
    latest = structuredClone(project);
    create = spyOn(workbench, "createWorkbenchTask").mockResolvedValue(task);
    spyOn(ecommerce, "getEcommerceProject").mockImplementation(async () => latest);
    save = spyOn(ecommerce, "saveEcommerceProject").mockImplementation(async (project, draft, plan) => ({ ...project, revision: project.revision + 1, draftJson: JSON.stringify(draft), planJson: JSON.stringify(plan) }));
});

afterEach(() => {
    setActiveUserScope(null);
    mock.restore();
});
afterAll(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    dom.happyDOM.abort();
});

test("只提交选中成片一张，携带实际模型、比例与清晰度", async () => {
    await editDetailImage(config, source, "selected-output", "把主标题改为清润日常", "submission-one");
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0];
    expect(request.references).toEqual([{ resourceId: "selected-output", kind: "image", role: "reference" }]);
    expect(request.parameters).toMatchObject({ count: 1, size: "3:4", imageResolution: "2k" });
    expect(request).toMatchObject({ ecommerceProjectId: "detail-project", clientSubmissionId: "submission-one", model: "image", channelId: "edit-test" });
    expect(request.prompt).toContain("把主标题改为清润日常");
    expect(save.mock.calls[0][2]?.images[1]).toEqual(source.plan.images[1]);
});

test("网络结果不确定后重新打开沿用原提交编号，改要求才建立新编号", async () => {
    create.mockRejectedValueOnce(new Error("连接中断"));
    await expect(editDetailImage(config, source, "selected-output", "改标题", "submission-one")).rejects.toThrow("连接中断");
    expect(save).not.toHaveBeenCalled();
    await editDetailImage(config, structuredClone(source), "selected-output", "改标题", "reopened-id");
    expect(create.mock.calls.map(([request]) => request.clientSubmissionId)).toEqual(["submission-one", "submission-one"]);
    await editDetailImage(config, source, "selected-output", "删除标题", "changed-id");
    expect(create.mock.calls.at(-1)?.[0].clientSubmissionId).toBe("changed-id");
});

test("持久化失败时不发送会计费的任务", async () => {
    spyOn(localforage, "setItem").mockRejectedValueOnce(new Error("存储失败"));
    await expect(editDetailImage(config, source, "selected-output", "改标题", "submission-one")).rejects.toThrow("存储失败");
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
});

test("保存使用最新版本并保留其他窗口新改的图文元数据", async () => {
    const plan = structuredClone(source.plan);
    plan.images[0] = { ...plan.images[0], copy: "另一个窗口确认的新文案", composition: "新排版", resourceId: "current-resource" };
    plan.images[1].copy = "另一张图的新文案";
    latest = { ...latest, revision: 9, planJson: JSON.stringify(plan) };
    await editDetailImage(config, source, "selected-output", "改标题", "submission-one");
    expect(save.mock.calls[0][0].revision).toBe(9);
    expect(save.mock.calls[0][2]?.images[0]).toMatchObject({ copy: "另一个窗口确认的新文案", composition: "新排版", resourceId: "current-resource", taskId: task.id, manualPrompt: true });
    expect(save.mock.calls[0][2]?.images[1]).toEqual(plan.images[1]);
});

test("当前图已换到另一个任务时保留已提交回执并拒绝覆盖新任务", async () => {
    const plan = structuredClone(source.plan);
    plan.images[0].taskId = "concurrent-task";
    latest.planJson = JSON.stringify(plan);
    await expect(editDetailImage(config, source, "selected-output", "改标题", "submission-one")).rejects.toThrow("修改任务已提交，但这张图的方案已更新");
    expect(save).not.toHaveBeenCalled();
    expect(JSON.parse([...storage.values()][0])).toMatchObject({ id: "submission-one", taskId: task.id });
});

test("任务完成仅移除匹配回执，旧完成事件不能清理新任务", async () => {
    await editDetailImage(config, source, "selected-output", "改标题", "submission-one");
    await completeDetailEditAttempt(source.project.id, source.image.id, "older-task");
    expect(storage.size).toBe(1);
    await completeDetailEditAttempt(source.project.id, source.image.id, task.id);
    expect(storage.size).toBe(0);
});
