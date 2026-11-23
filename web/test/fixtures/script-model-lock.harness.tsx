import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";

const dom = new Window({ url: "https://shop.example.test/shop/script" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, localStorage: dom.localStorage, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const message = { info: mock(() => {}), error: mock(() => {}), warning: mock(() => {}) };
const confirm = mock((_options: any) => {});
mock.module("antd", () => ({ App: { useApp: () => ({ message, modal: { confirm } }) }, InputNumber: () => null }));
mock.module("../../src/stores/use-user-store", () => ({ useUserStore: (select: any) => select({ user: { id: "test" } }) }));
mock.module("../../src/stores/use-config-store", () => ({
    logicalModelIDForConfig: ({ model }: any) => model,
    modelDisplayName: (_config: any, model: string) => model,
    modelOptionName: (model: string) => model,
    resolveModelChannel: () => ({ id: "system" }),
}));
mock.module("../../src/components/model-picker", () => ({
    ModelPicker: ({ value, onChange, modelDisabledReason }: any) => (
        <button disabled={Boolean(modelDisabledReason())} onClick={() => onChange("seedance-fast")}>
            {value}
        </button>
    ),
}));
let savedProject: any;
const createProject = mock(async (input: any) => (savedProject = { id: "created", ...input, assets: [], runs: [] }));
const updateProject = mock(async (_id: string, input: any) => ({ ...savedProject, ...input }));
const analyzeProject = mock(async () => ({ ...savedProject, status: "analyzing" }));
const addAsset = mock(async (id: string, asset: any) => (savedProject = { ...savedProject, id, assets: [...savedProject.assets, asset] }));
mock.module("../../src/services/api/video-replication", () => ({
    getVideoReplicationProject: async () => savedProject,
    listVideoReplicationProjects: async () => [],
    createVideoReplicationProject: createProject,
    updateVideoReplicationProject: updateProject,
    analyzeVideoReplication: analyzeProject,
    addVideoReplicationAsset: addAsset,
    deleteVideoReplicationAsset: mock(),
    deleteVideoReplicationProject: mock(),
}));
mock.module("../../src/services/api/viral-plan", () => ({ deleteViralScriptBatch: mock(), generateViralVideo: mock(), saveViralScript: mock() }));
const { useViralPlan } = await import("../../src/pages/ecommerce/video/use-viral-plan");
const { ScriptModelButton } = await import("../../src/pages/shop/script/script-spec");
const { SCRIPT_FORMATS } = await import("../../src/pages/shop/script-formats");
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let latest: ReturnType<typeof useViralPlan>;
let currentState: any;
let overrides: Record<string, unknown>;
beforeEach(() => {
    overrides = {};
    savedProject = {
        id: "project",
        status: "analyzed",
        parameters: { model: "seedance-pro", logicalModelId: "seedance-pro", targetSeconds: 60, viral: { stage: "script" } },
        assets: [{ resourceId: "product", category: "product_image" }],
        runs: [],
        analysis: {
            viral: {
                scriptReady: true,
                modelFamily: "seedance",
                materials: [{ resourceId: "product", description: "商品" }],
                batches: [{ id: "batch", seconds: 60, inputs: { modelKey: "seedance-pro", modelFamily: "seedance", segmentSeconds: [30, 30] }, scripts: [{ id: "script", shots: [] }] }],
            },
        },
    };
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    host?.remove();
    dom.localStorage.clear();
    for (const fn of [confirm, createProject, updateProject, analyzeProject, addAsset, ...Object.values(message)]) fn.mockClear();
});
afterAll(() => dom.happyDOM.abort());
async function mount(element: ReactNode = <Probe />) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(element);
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
}
function Probe() {
    const [selectedModel, setModel] = useState("seedance-fast");
    currentState = {
        config: {},
        selectedModel,
        setModel,
        systemModel: () => true,
        publicConfig: { maxViralSeconds: 120 },
        maxReferenceSeconds: 120,
        profile: { duration: { selection: "enum", values: [15, 30] }, references: { maxImages: 5, maxAudios: 2 } },
        images: [{ id: "image", resourceId: "product", slot: "viral-product", category: "product_image" }],
        subjectHint: "",
        productName: "",
        trim: null,
        video: null,
        clipMs: 0,
        restoreViralProject: () => {},
        canGenerateAudio: false,
        buildParameters: () => ({}),
        setSubmittingGuard: () => {},
        addProject: mock(),
        ...overrides,
    };
    latest = useViralPlan(currentState, true);
    return null;
}

test("恢复草稿保留当前同系列模型，预览使用所选脚本时长", async () => {
    dom.localStorage.setItem("ecv-viral-project:test", "project");
    dom.localStorage.setItem("ecv-viral-options:test", JSON.stringify({ projectId: "project", seconds: 30, options: {} }));
    await mount();
    expect(currentState.selectedModel).toBe("seedance-fast");
    expect(latest.modelLocked).toBe(false);
    expect(latest.modelLockIssue).toBe("");
    expect(latest.seconds).toBe(30);
    expect(latest.selectedSegments.map((segment) => segment.seconds)).toEqual([30, 30]);
    await act(async () => latest.requestModelChange("seedance-pro"));
    expect(currentState.selectedModel).toBe("seedance-pro");
    expect(confirm).not.toHaveBeenCalled();
});

test("跨模型系列切换先确认，再要求重新分析", async () => {
    dom.localStorage.setItem("ecv-viral-project:test", "project");
    await mount();
    await act(async () => latest.requestModelChange("veo-3"));
    expect(currentState.selectedModel).toBe("seedance-fast");
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => confirm.mock.calls[0][0].onOk());
    expect(currentState.selectedModel).toBe("veo-3");
    expect(latest.modelLockIssue).toContain("重新分析");
    expect(latest.fresh).toBe(false);
});

test("执行中的草稿禁止切换模型", async () => {
    savedProject.status = "analyzing";
    dom.localStorage.setItem("ecv-viral-project:test", "project");
    await mount();
    expect(latest.modelLocked).toBe(true);
    await act(async () => latest.requestModelChange("veo-3"));
    expect(currentState.selectedModel).toBe("seedance-fast");
    expect(confirm).not.toHaveBeenCalled();
});

test("模型入口允许空闲时选择，执行期间禁用", async () => {
    const requestModelChange = mock();
    const state = { config: {}, selectedModel: "seedance-pro", systemModel: () => true } as any;
    await mount(<ScriptModelButton state={state} p={{ modelLocked: false, requestModelChange } as any} />);
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(requestModelChange).toHaveBeenCalledWith("seedance-fast");
    await act(async () => root!.render(<ScriptModelButton state={state} p={{ modelLocked: true, requestModelChange } as any} />));
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
});

test("全部非短剧类型清除短剧风格，首页自由创作草稿不提交非法组合", async () => {
    await mount();
    for (const format of SCRIPT_FORMATS) {
        await act(async () => latest.patch({ format: "drama-commerce", dramaStyle: "custom" }));
        expect(latest.options.dramaStyle).toBe("custom");
        await act(async () => latest.patch({ format: format.id === "free" ? "" : format.id }));
        expect(latest.options.dramaStyle).toBe(format.id === "drama-commerce" ? "custom" : "");
    }
    await act(async () => latest.patch({ format: "drama-commerce", dramaStyle: "reference" }));
    await act(async () => latest.patch({ format: "", scene: "电商带货" }));
    await act(async () => {
        expect(await latest.run("draft")).toBe(true);
    });
    expect(createProject.mock.calls[0][0].parameters.viral).toMatchObject({ format: "", dramaStyle: "" });
});

test("素材库中的过短视频在调用创建和付费分析前拦截", async () => {
    overrides = { video: { resourceId: "video", durationMs: 3000 }, clipMs: 3000 };
    await mount();
    expect(latest.missing).toContain("至少 4 秒");
    await act(async () => {
        expect(await latest.run("recognize")).toBe(false);
    });
    expect(createProject).not.toHaveBeenCalled();
    expect(analyzeProject).not.toHaveBeenCalled();
});

test("未知时长保留后端探测，长视频仍可先分析再选择风格帧", async () => {
    overrides = { video: { resourceId: "video", durationMs: 0 }, clipMs: 0 };
    await mount();
    expect(latest.missing).toBe("");
    overrides = { video: { resourceId: "video", durationMs: 90000 }, clipMs: 90000, profile: { ...currentState.profile, references: { maxImages: 5, maxAudios: 2, maxVideoDurationSeconds: 15 } } };
    await act(async () => root!.render(<Probe />));
    expect(latest.missing).toBe("");
});
