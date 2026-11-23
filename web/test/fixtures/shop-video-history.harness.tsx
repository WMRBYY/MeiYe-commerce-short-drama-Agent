import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { GalleryActions, GalleryBatch } from "../../src/pages/workbench/workbench-gallery";
import type { GenerationTask } from "../../src/services/api/task-center";

const dom = new Window({ url: "https://shop.example.test/shop/image?kind=video" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
mock.module("antd", () => ({
    Button: ({ children, icon, type, size, ...props }: any) => (
        <button {...props}>
            {icon}
            {children}
        </button>
    ),
    Input: ({ prefix, allowClear, size, ...props }: any) => <input {...props} />,
    Dropdown: ({ children, menu }: any) => (
        <div>
            {children}
            <div role="menu">
                {menu.items.map((item: any) => (
                    <button key={item.key} role="menuitem" disabled={item.disabled} onClick={() => menu.onClick({ key: item.key })}>
                        {item.label}
                    </button>
                ))}
            </div>
        </div>
    ),
}));
mock.module("../../src/components/ui/base/tooltip/ant-tooltip", () => ({ AntTooltip: ({ children }: any) => children }));
mock.module("../../src/components/ui/base/segmented-control/segmented-control", () => ({ SegmentedControl: () => <div data-testid="default-filter" /> }));
mock.module("../../src/components/ui/product/relative-time", () => ({ RelativeTime: () => <time>今天</time> }));
mock.module("../../src/components/layout/workspace-state", () => ({ WorkspaceNoResultsState: () => <div>没有结果</div>, WorkspaceState: () => <div>空记录</div> }));
mock.module("../../src/pages/workbench/workbench-composer", () => ({ SceneGlyph: () => null }));
mock.module("../../src/pages/workbench/workbench-presets", () => ({ workbenchToolSubtitle: () => "" }));
const { WorkbenchGallery } = await import("../../src/pages/workbench/workbench-gallery");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let actions: GalleryActions;
let onFilterChange: ReturnType<typeof mock>;
const task = (id: string, status: string) => ({ id, status, progress: 48, error: status === "failed" ? "服务暂不可用" : "" }) as GenerationTask;
const done = task("done", "succeeded");
const running = task("running", "running");
const failed = task("failed", "failed");
const cancelled = task("cancelled", "cancelled");
const output = (key: string, width = 1920, height = 1080) => ({ key, taskId: done.id, index: 0, kind: "video" as const, url: "/fixture.mp4", thumbUrl: "/fixture.jpg", width, height });
const firstOutput = output("first");
const secondOutput = output("second", 1080, 1920);
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);
const batch: GalleryBatch = {
    key: "batch:today",
    createdAt: today.toISOString(),
    prompt: "保留完整视频提示词但不平铺在历史卡片上",
    toolName: "商品视频",
    modelLabel: "测试视频模型",
    chips: ["16:9", "720p"],
    tiles: [
        { type: "output", key: "first", output: firstOutput, task: done },
        { type: "output", key: "second", output: secondOutput, task: done },
        { type: "active", key: "running", task: running, slot: 0 },
        { type: "failed", key: "failed", task: failed },
        { type: "failed", key: "cancelled", task: cancelled },
        { type: "pending", key: "pending", state: "unsubmitted", error: "网络中断，尚未提交" },
    ],
    tasks: [done, running, failed, cancelled],
    outputs: [firstOutput, secondOutput],
    counts: { done: 2, active: 1, failed: 2, pending: 1, total: 6 },
    resumable: 1,
    submitting: false,
    localOnly: true,
};
const older: GalleryBatch = {
    ...batch,
    key: "batch:yesterday",
    createdAt: yesterday.toISOString(),
    tiles: [batch.tiles[0]],
    tasks: [done],
    outputs: [firstOutput],
    counts: { done: 1, active: 0, failed: 0, pending: 0, total: 1 },
    resumable: 0,
    localOnly: false,
};
beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    actions = Object.fromEntries(["openOutput", "download", "cancelTask", "retryTask", "reuse", "copyPrompt", "downloadAll", "cancelBatch", "retryFailed", "resume", "dismiss", "visible", "measure"].map((key) => [key, mock()])) as GalleryActions;
    onFilterChange = mock();
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
const render = (presentation: "timeline" | undefined, filter: "all" | "active" = "all") =>
    act(async () =>
        root.render(
            <WorkbenchGallery
                kind="video"
                presentation={presentation}
                batches={[batch, older]}
                loading={false}
                filter={filter}
                query=""
                busyTaskIds={new Set()}
                actions={actions}
                quickTools={[]}
                historyCapped={false}
                onFilterChange={onFilterChange}
                onQueryChange={() => {}}
                onRefresh={() => {}}
                onOpenLibrary={() => {}}
                onChooseTool={() => {}}
            />,
        ),
    );
async function click(selector: string) {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    await act(async () => element!.click());
}
async function clickText(text: string, selector = "button") {
    const button = [...host.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent === text);
    expect(button).not.toBeUndefined();
    await act(async () => button!.click());
}

test("timeline以日期网格展示每条媒体，不展开大提示词或批次表面", async () => {
    await render("timeline");
    expect(host.querySelectorAll(".svh-grid").length).toBe(2);
    expect(host.querySelectorAll(".svh-grid")[0].querySelectorAll(".svh-card").length).toBe(6);
    expect(host.querySelectorAll(".svh-card").length).toBe(7);
    expect(host.querySelector(".wb-batch")).toBeNull();
    expect(host.querySelector(".wb-batch-prompt")).toBeNull();
    expect(host.textContent).not.toContain(batch.prompt);
    expect([...host.querySelectorAll(".svg-history-day-head")].map((element) => element.textContent)).toEqual(["今天6 条", "昨天1 条"]);
    expect((host.querySelectorAll(".svh-card")[1] as HTMLElement).style.getPropertyValue("--wb-tile-ratio")).toBe(String(1080 / 1920));
    expect(actions.visible).toHaveBeenCalledTimes(2);
    await click('[aria-label="预览视频"]');
    expect(actions.openOutput).toHaveBeenCalledWith(batch, firstOutput);
    await click(".svh-edit");
    expect(actions.reuse).toHaveBeenCalledWith(batch);
});

test("timeline保留单项取消重试、批次继续提交与筛选回调", async () => {
    await render("timeline");
    expect(host.textContent).toContain("已取消");
    expect(host.textContent).toContain("服务暂不可用");
    expect(host.textContent).toContain("网络中断，尚未提交");
    await click('[aria-label="取消任务"]');
    expect(actions.cancelTask).toHaveBeenCalledWith(running);
    await clickText("重新生成");
    expect(actions.retryTask).toHaveBeenCalledWith(failed);
    await clickText("继续提交");
    expect(actions.resume).toHaveBeenCalledWith(batch);
    await clickText("取消本组未完成任务");
    expect(actions.cancelBatch).toHaveBeenCalledWith(batch);
    await clickText("重新生成本组失败项");
    expect(actions.retryFailed).toHaveBeenCalledWith(batch);
    await clickText("移除这组记录");
    expect(actions.dismiss).toHaveBeenCalledWith(batch);
    await clickText("复制提示词");
    expect(actions.copyPrompt).toHaveBeenCalledWith(batch);
    await clickText("下载本组 2 个作品");
    expect(actions.downloadAll).toHaveBeenCalledWith(batch);
    await clickText("进行中 1");
    expect(onFilterChange).toHaveBeenCalledWith("active");
    await render("timeline", "active");
    expect(host.querySelectorAll(".svh-grid").length).toBe(1);
});

test("非timeline工作台保留原有批次提示词和筛选布局", async () => {
    await render(undefined);
    expect(host.querySelectorAll(".wb-batch").length).toBe(2);
    expect(host.querySelectorAll(".wb-batch-prompt").length).toBe(2);
    expect(host.querySelector(".svh-grid")).toBeNull();
    expect(host.querySelector('[data-testid="default-filter"]')).not.toBeNull();
});
