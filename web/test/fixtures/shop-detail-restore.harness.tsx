import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { EcommerceProject } from "../../src/services/api/ecommerce";
import type { GenerationTask } from "../../src/services/api/task-center";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    localStorage: dom.localStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
Object.defineProperty(globalThis, "HTMLAnchorElement", { configurable: true, value: dom.HTMLAnchorElement });
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { ShopDetailWorks } = await import("../../src/pages/shop/shop-detail-works");
const taskCache = await import("../../src/services/generation-task-cache");
const tasksApi = await import("../../src/services/api/task-center");
const { setActiveUserScope } = await import("../../src/lib/user-scope");

const completed: GenerationTask = { id: "image-task", type: "canvas_image", status: "succeeded", prompt: "", attempts: 1, previewUrl: "/api/resources/finished-image/file", createdAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-21T00:00:01Z" };
const project: EcommerceProject = {
    id: "detail-project",
    userId: "owner",
    name: "已生成商品图",
    status: "done",
    revision: 1,
    draftJson: '{"count":1}',
    planJson: '{"images":[{"id":"image","taskId":"image-task"}]}',
    createdAt: completed.createdAt,
    updatedAt: completed.updatedAt,
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let memory: GenerationTask[];
let restore: (tasks: GenerationTask[]) => void;
let receive: (task: GenerationTask) => void;

beforeEach(() => {
    setActiveUserScope("owner");
    memory = [];
    spyOn(taskCache, "getCachedGenerationTasks").mockImplementation(() => memory);
    spyOn(taskCache, "loadCachedGenerationTasks").mockImplementation(
        () =>
            new Promise((resolve) => {
                restore = resolve;
            }),
    );
    spyOn(tasksApi, "subscribeGenerationTasks").mockImplementation((_ids, callback) => {
        receive = callback;
        return () => {};
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    mock.restore();
});
afterAll(() => dom.happyDOM.abort());

async function render(value = project) {
    await act(async () =>
        root.render(
            <App>
                <ShopDetailWorks projects={[value]} filters={null} onAgain={() => {}} onOpenHistory={() => {}} onBatchDeleted={() => {}} onReload={async () => {}} />
            </App>,
        ),
    );
}

test("切页返回立即展示完成图片，保持后台订阅", async () => {
    memory = [completed];
    await render();
    expect(host.querySelector(".sdw-thumb")?.getAttribute("src")).toContain("finished-image");
    expect(host.querySelector('[data-status="running"]')).toBeNull();
    expect(receive).toBeFunction();
});

test("刷新先恢复本地完成结果，不等待服务端任务查询", async () => {
    await render();
    expect(host.textContent).toContain("正在读取图片");
    expect(host.textContent).not.toContain("创作中");
    await act(async () => restore([completed]));
    expect(host.querySelector(".sdw-thumb")?.getAttribute("src")).toContain("finished-image");
});

test("未知旧策划状态不重播思考动画", async () => {
    await render({ ...project, draftJson: '{"planningTaskId":"old-planning","count":10}', planJson: "{}" });
    expect(host.textContent).toContain("正在读取图片记录");
    expect(host.textContent).not.toContain("思考中");
    expect(host.querySelector('[data-status="running"]')).toBeNull();
});

test("晚到的缓存不能覆盖最新任务状态", async () => {
    await render();
    await act(async () => receive({ ...completed, status: "running", updatedAt: "2026-11-21T01:00:00Z" }));
    await act(async () => restore([completed]));
    expect(host.querySelector(".sdw-thumb")).toBeNull();
    expect(host.querySelector('[data-status="running"]')).not.toBeNull();
});

test("旧执行记录仍在运行时，完成任务不再重播 Agent 动画", async () => {
    memory = [completed];
    await render({ ...project, draftJson: '{"count":1,"execution":{"id":"run","status":"running","stage":"submitted"}}' });
    expect(host.querySelector(".sdw-thumb")).not.toBeNull();
    expect(host.textContent).not.toContain("思考中");
    expect(host.querySelector('[data-status="running"]')).toBeNull();
});

test("晚到的旧订阅不能把完成图片倒退为生成中", async () => {
    memory = [completed];
    await render();
    await act(async () => receive({ ...completed, status: "running", updatedAt: completed.createdAt }));
    expect(host.querySelector(".sdw-thumb")).not.toBeNull();
});

test("切账号后不接收旧账号磁盘结果", async () => {
    await render();
    setActiveUserScope("other");
    await act(async () => restore([completed]));
    expect(host.querySelector(".sdw-thumb")).toBeNull();
});
