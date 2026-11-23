import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { GenerationTask } from "../../src/services/api/task-center";
import type { TryOnState } from "../../src/pages/ecommerce/tryon/use-tryon";

const dom = new Window({ url: "http://localhost/shop/image" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const disk = new Map<string, string>();
const storage = (scope: string) => ({
    getItem: async (key: string) => disk.get(`${scope}:${key}`) || null,
    setItem: async (key: string, value: string) => {
        disk.set(`${scope}:${key}`, value);
    },
    removeItem: async (key: string) => {
        disk.delete(`${scope}:${key}`);
    },
});
mock.module("@/lib/localforage-storage", () => ({ localForageStorage: storage("global"), localForageStorageForScope: storage }));
const taskApi = await import("../../src/services/api/task-center");
const watchers: Array<{ ids: string[]; listener(task: GenerationTask): void }> = [];
mock.module("@/services/api/task-center", () => ({
    ...taskApi,
    subscribeGenerationTasks: (ids: string[], listener: (task: GenerationTask) => void) => {
        watchers.push({ ids, listener });
        return () => undefined;
    },
}));
const commerceApi = await import("../../src/services/api/ecommerce");
mock.module("@/services/api/ecommerce", () => ({ ...commerceApi, listEcommerceProjects: async () => [] }));
const { act, useSyncExternalStore } = await import("react");
const { createRoot } = await import("react-dom/client");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { useShopEdits } = await import("../../src/pages/shop/shop-edits");
const { useShopItems } = await import("../../src/pages/shop/shop-items");
const { tryOnState, subscribeTryOn, watchTryOnTasks } = await import("../../src/pages/ecommerce/tryon/tryon-runtime");
const { defaultTryOnDraft } = await import("../../src/pages/ecommerce/tryon/tryon-plan");
const { cachedWorkbenchTasks, loadWorkbenchTaskHistory, rememberWorkbenchTasks } = await import("../../src/services/workbench-task-history");
const { cacheGenerationTasks } = await import("../../src/services/generation-task-cache");

function receipt(id: string): GenerationTask {
    return {
        id,
        type: "canvas_image",
        status: "succeeded",
        prompt: "",
        attempts: 1,
        createdAt: "2026-11-21T01:00:00Z",
        updatedAt: "2026-11-21T01:01:00Z",
        previewUrl: `/api/resources/${id}-image/file`,
        resultJson: JSON.stringify({ images: [{ storageKey: `resource:${id}-image` }] }),
        outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: `${id}-asset` }],
    };
}

function seed(scope: string, task = receipt("finished")) {
    disk.set(`${scope}:generation-result-snapshots-v1`, JSON.stringify([task]));
    disk.set(`${scope}:shop-edit-records`, JSON.stringify([{ id: "edit", group: "group", index: 0, kind: "chat", state: "submitted", taskId: task.id, text: "商品图", references: [], createdAt: task.createdAt }]));
    disk.set(`${scope}:ecommerce-tryon-batches`, JSON.stringify([{ id: "batch", fn: "outfit", createdAt: task.createdAt, source: defaultTryOnDraft(), jobs: [{ key: "job", state: "submitted", taskId: task.id, references: [] }] }]));
    return task;
}

const observed: Array<{ loaded: boolean; items: Array<{ status: string; resourceId: string }> }> = [];
function ImageHistory({ scope }: { scope: string }) {
    const edits = useShopEdits(scope);
    const runtime = useSyncExternalStore(subscribeTryOn, () => tryOnState(scope));
    const items = useShopItems({ shown: runtime.batches, tasks: runtime.tasks } as TryOnState, edits.records, edits.tasks);
    const loaded = edits.loaded && runtime.batchesLoaded;
    observed.push({ loaded, items });
    return <div>{loaded ? items.map((item) => <img key={item.key} data-status={item.status} src={item.resourceId} />) : "读取记录"}</div>;
}

afterAll(() => dom.happyDOM.abort());

test("刷新生图记录时，完成结果和历史一起恢复；断网期间不闪回生成中", async () => {
    const scope = "image-refresh";
    const task = seed(scope);
    setActiveUserScope(scope);
    const host = document.createElement("div");
    const root = createRoot(host);
    observed.length = 0;
    try {
        await act(async () => {
            root.render(<ImageHistory scope={scope} />);
            await Promise.resolve();
        });
        expect(host.querySelectorAll('img[data-status="done"]').length).toBe(2);
        expect(observed.filter((view) => view.loaded).every((view) => view.items.every((item) => item.status === "done" && item.resourceId === `${task.id}-image`))).toBe(true);
        expect(watchers.some((watch) => watch.ids.includes(task.id))).toBe(true);
        // The real TryOn subscription still checks the server in the background.
        watchTryOnTasks(scope, [task.id])();
        expect(watchers.at(-1)?.ids).toEqual([task.id]);
        await act(async () => {
            watchers.at(-1)!.listener({ ...task, status: "running", updatedAt: "2026-11-21T01:00:30Z" });
        });
        expect(host.querySelectorAll('img[data-status="done"]').length).toBe(2);
    } finally {
        await act(async () => root.unmount());
    }
});

test("切换页面回到生图时首帧保留已完成图片，切换账号不复用前一账号结果", async () => {
    const scope = "image-navigation";
    seed(scope);
    setActiveUserScope(scope);
    const first = createRoot(document.createElement("div"));
    await act(async () => {
        first.render(<ImageHistory scope={scope} />);
    });
    await act(async () => first.unmount());
    const host = document.createElement("div");
    const second = createRoot(host);
    observed.length = 0;
    try {
        await act(async () => {
            second.render(<ImageHistory scope={scope} />);
        });
        expect(observed[0].loaded).toBe(true);
        expect(observed[0].items.every((item) => item.status === "done")).toBe(true);
        setActiveUserScope("other-image-user");
        await act(async () => {
            second.render(<ImageHistory scope="other-image-user" />);
        });
        expect(host.querySelectorAll("img").length).toBe(0);
    } finally {
        await act(async () => second.unmount());
    }
});

test("首次安装尚未缓存的旧任务显示读取作品，不冒充正在生成", async () => {
    const scope = "image-no-cache";
    seed(scope);
    disk.delete(`${scope}:generation-result-snapshots-v1`);
    setActiveUserScope(scope);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
        await act(async () => {
            root.render(<ImageHistory scope={scope} />);
        });
        expect(host.querySelectorAll('img[data-status="loading"]').length).toBe(2);
        expect(host.querySelectorAll('img[data-status="running"]').length).toBe(0);
    } finally {
        await act(async () => root.unmount());
    }
});

test("工作台仅恢复当前画廊成员，列表摘要不会抹掉完整结果，刷新不会恢复其他账号结果", async () => {
    const scope = "workbench-refresh";
    const completed = receipt("workbench-done");
    disk.set(`${scope}:generation-result-snapshots-v1`, JSON.stringify([completed, receipt("unrelated")]));
    disk.set(`${scope}:workbench-history-image`, JSON.stringify([completed.id]));
    expect((await loadWorkbenchTaskHistory(scope, "image")).map((task) => task.id)).toEqual([completed.id]);
    expect(rememberWorkbenchTasks(scope, "image", [{ ...completed, resultJson: undefined }])[0].resultJson).toBe(completed.resultJson);
    expect(cachedWorkbenchTasks(scope, "image")[0].status).toBe("succeeded");
    expect(await loadWorkbenchTaskHistory("other-workbench-user", "image")).toEqual([]);
    expect(rememberWorkbenchTasks(scope, "image", [{ ...completed, status: "running", updatedAt: "2026-11-21T02:00:00Z", resultJson: undefined }])[0].resultJson).toBeUndefined();
    cacheGenerationTasks([{ ...completed, updatedAt: "2026-11-21T02:01:00Z" }], scope);
    expect(cachedWorkbenchTasks(scope, "image")[0].status).toBe("succeeded");
    expect(cachedWorkbenchTasks(scope, "image")[0].resultJson).toBe(completed.resultJson);
});
