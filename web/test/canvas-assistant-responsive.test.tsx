import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCanvasAssistantVisibility } = await import("../src/pages/canvas/use-canvas-assistant-visibility");
const { useGlobalAgentStore } = await import("../src/stores/use-global-agent-store");
const { subscribeTaskTicker, taskTickerSnapshot } = await import("../src/lib/canvas/task-ticker");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("opening and closing the assistant updates its state without rerendering the canvas action consumer", async () => {
    const previous = useGlobalAgentStore.getState();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let renders = 0;
    function CanvasActions() {
        const { openAgent, closeAgent } = useCanvasAssistantVisibility();
        renders++;
        return <><button onClick={openAgent}>Open</button><button onClick={closeAgent}>Close</button></>;
    }
    try {
        useGlobalAgentStore.getState().reset();
        await act(async () => root.render(<CanvasActions />));
        const settledRenders = renders;
        await act(async () => host.querySelectorAll("button")[0].click());
        expect(useGlobalAgentStore.getState().open).toBe(true);
        expect(renders).toBe(settledRenders);
        await act(async () => host.querySelectorAll("button")[1].click());
        expect(useGlobalAgentStore.getState().open).toBe(false);
        expect(renders).toBe(settledRenders);
    } finally {
        await act(async () => root.unmount());
        useGlobalAgentStore.setState(previous);
        host.remove();
    }
});

test("elapsed labels yield during pan and node drag, resume at wall time, and stop after the last subscriber", () => {
    const canvas = document.createElement("div");
    document.body.append(canvas);
    const intervals = new Map<number, () => void>();
    let intervalId = 0;
    let clock = 1_000;
    const date = spyOn(Date, "now").mockImplementation(() => clock);
    const start = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => {
        intervals.set(++intervalId, callback);
        return intervalId;
    }) as typeof setInterval);
    const clear = spyOn(globalThis, "clearInterval").mockImplementation((id) => { intervals.delete(Number(id)); });
    const first: number[] = [];
    const second: number[] = [];
    let stopFirst = () => {};
    let stopSecond = () => {};
    const tickAt = (time: number) => {
        clock = time;
        for (const callback of intervals.values()) callback();
    };
    try {
        stopFirst = subscribeTaskTicker(() => first.push(taskTickerSnapshot()));
        stopSecond = subscribeTaskTicker(() => second.push(taskTickerSnapshot()));
        expect(intervals.size).toBe(1);
        tickAt(2_000);
        expect(first).toEqual([1_000, 2_000]);
        expect(second).toEqual([2_000]);

        canvas.dataset.canvasViewportInteracting = "true";
        tickAt(3_000);
        delete canvas.dataset.canvasViewportInteracting;
        canvas.dataset.canvasNodeDragging = "true";
        tickAt(4_000);
        expect(first).toEqual([1_000, 2_000]);
        expect(second).toEqual([2_000]);
        expect(taskTickerSnapshot()).toBe(2_000);

        delete canvas.dataset.canvasNodeDragging;
        tickAt(9_000);
        expect(first.at(-1)).toBe(9_000);
        expect(second.at(-1)).toBe(9_000);
        stopFirst();
        tickAt(10_000);
        expect(first.at(-1)).toBe(9_000);
        expect(second.at(-1)).toBe(10_000);
        stopSecond();
        expect(intervals.size).toBe(0);
        tickAt(11_000);
        expect(second.at(-1)).toBe(10_000);
    } finally {
        stopFirst();
        stopSecond();
        clear.mockRestore();
        start.mockRestore();
        date.mockRestore();
        canvas.remove();
    }
});
