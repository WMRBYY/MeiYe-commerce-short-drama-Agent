import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://meiyeai.example/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, HTMLBodyElement: dom.HTMLBodyElement, HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot,
    Event: dom.Event, MouseEvent: dom.MouseEvent, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const api = await import("../src/services/api/task-center");
const { ScriptProgress } = await import("../src/pages/projects/studio/script-progress");
import type { DramaJob } from "../src/services/api/drama";
import type { WaitForGenerationTaskOptions } from "../src/services/api/task-center";

const job = { id: "job-1", kind: "script", status: "running", taskId: "task-1", label: "剧本与分镜" } as DramaJob;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let options: WaitForGenerationTaskOptions;
let calls: string[];
let client: InstanceType<typeof QueryClient>;

beforeEach(() => {
    calls = [];
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    spyOn(api, "waitForGenerationTask").mockImplementation((id, opts) => {
        calls.push(id);
        options = opts!;
        return new Promise(() => {});
    });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); mock.restore(); });
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});
async function render(current = job) {
    await act(async () => root.render(<QueryClientProvider client={client}><ScriptProgress projectId="project-1" job={current} onComplete={() => {}} /></QueryClientProvider>));
}

test("streams progress without restarting on parent polling, and aborts only the listener on unmount", async () => {
    await render();
    expect(calls).toEqual(["task-1"]);
    expect(options.useTextEvents).toBe(true);
    expect(host.textContent).toContain("等待模型返回内容");
    await act(async () => options.onTextDelta!("剧情内容😀"));
    expect(host.textContent).toContain("已收到 5 字");
    const signal = options.signal!;
    await render({ ...job });
    expect(calls).toEqual(["task-1"]);
    expect(signal.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
});

test("queued work does not subscribe until a task exists", async () => {
    await render({ ...job, status: "queued", taskId: undefined });
    expect(calls).toEqual([]);
    expect(host.textContent).toContain("等待可用生成名额");
});

test("reconnect observes the same task instead of resubmitting generation", async () => {
    spyOn(api, "waitForGenerationTask").mockImplementation(async (id, opts) => {
        calls.push(id); options = opts!;
        if (calls.length === 1) throw new Error("disconnected");
        return new Promise(() => {});
    });
    await render();
    expect(host.textContent).toContain("进度连接暂时中断");
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "重新连接进度")!.click());
    expect(calls).toEqual(["task-1", "task-1"]);
    expect(host.textContent).not.toContain("进度连接暂时中断");
});
