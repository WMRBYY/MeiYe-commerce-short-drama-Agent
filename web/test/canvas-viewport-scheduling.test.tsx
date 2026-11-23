import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
    CustomEvent: dom.CustomEvent, Event: dom.Event,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasViewport } = await import("../src/components/canvas/canvas-viewport");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("high-frequency wheel input paints once per frame and flushes its final position at idle", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const container = createRef<HTMLDivElement>();
    const commits: { x: number; y: number; k: number }[] = [];
    await act(async () => root.render(<CanvasViewport containerRef={container} viewport={{ x: 0, y: 0, k: 1 }} onViewportChange={(next) => commits.push(next)}><span /></CanvasViewport>));
    try {
        const world = container.current!.querySelector<HTMLElement>("[data-canvas-world-layer]")!;
        const before = world.style.transform;
        for (let i = 0; i < 100; i++) container.current!.dispatchEvent(new dom.WheelEvent("wheel", { deltaX: 1, deltaY: 2, bubbles: true, cancelable: true }) as unknown as WheelEvent);
        expect(frames.size).toBe(1);
        expect(world.style.transform).toBe(before);
        expect(commits).toHaveLength(0);
        const pending = [...frames.entries()][0];
        frames.delete(pending[0]);
        pending[1](100);
        expect(world.style.transform).toBe("translate3d(-100px, -200px, 0) scale(1)");
        container.current!.dispatchEvent(new dom.WheelEvent("wheel", { deltaX: 3, deltaY: 4, bubbles: true, cancelable: true }) as unknown as WheelEvent);
        expect(frames.size).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 160));
        expect(commits).toEqual([{ x: -103, y: -204, k: 1 }]);
        expect(frames.size).toBe(0);
        expect(world.style.transform).toBe("translate3d(-103px, -204px, 0) scale(1)");
        expect(container.current!.dataset.canvasViewportInteracting).toBeUndefined();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
