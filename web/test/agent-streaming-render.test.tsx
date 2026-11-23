import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
    SVGElement: dom.SVGElement, getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: dom.ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, Profiler } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentChatMessage } = await import("../src/components/canvas/canvas-cloud-agent-chat-ui");
const { canvasThemes } = await import("../src/lib/canvas-theme");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("streamed chunks render completely without background typing commits during canvas gestures", async () => {
    const host = document.createElement("div");
    const canvas = document.createElement("div");
    canvas.dataset.canvasViewportInteracting = "true";
    document.body.append(host, canvas);
    const root = createRoot(host);
    let commits = 0;
    const references = [{ id: "image-123", nodeId: "image-123", kind: "image" as const, label: "产品", title: "产品", sourceType: "image" as const }];
    const render = async (text: string, streaming: boolean) => {
        await act(async () => root.render(
            <Profiler id="message" onRender={() => { commits++; }}>
                <AgentChatMessage item={{ id: "reply", role: "assistant", text, streaming }} theme={canvasThemes.dark} references={references} isStreaming={streaming} />
            </Profiler>,
        ));
    };
    try {
        const chunk = "已经收到的完整内容：中文、emoji 🌿和 **Markdown** 都应立即显示。";
        await render(chunk, true);
        expect(host.textContent).toContain("中文、emoji 🌿和 Markdown 都应立即显示。");
        const settledCommits = commits;
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
        expect(commits).toBe(settledCommits);

        await render(`${chunk}\n\n新节点 ID：image-123\n\n本批内容末尾。`, true);
        expect(host.textContent).toContain("本批内容末尾。");
        expect(host.querySelector('[data-agent-node-id="image-123"]')).not.toBeNull();

        // A final snapshot can replace the draft, including shortening it.
        await render("最终内容 ✅", false);
        expect(host.textContent).toContain("最终内容 ✅");
        expect(host.textContent).not.toContain("本批内容末尾");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        canvas.remove();
    }
});
