import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationInspiration } from "../src/lib/inspirations/catalog";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLMediaElement: dom.HTMLMediaElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    DOMException: dom.DOMException,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

let plays = 0;
let loads = 0;
const media = dom.HTMLMediaElement.prototype;
const originalMethods = new Map(["play", "load", "pause"].map((key) => [key, Object.getOwnPropertyDescriptor(media, key)]));
Object.defineProperty(media, "play", { configurable: true, value: () => { plays += 1; return Promise.resolve(); } });
Object.defineProperty(media, "load", { configurable: true, value: () => { loads += 1; } });
Object.defineProperty(media, "pause", { configurable: true, value: () => undefined });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { FeaturedWorks } = await import("../src/pages/inspirations/featured-works");
const entry = {
    id: "seedance:test",
    title: "测试视频",
    description: "测试视频",
    image: "/cover.webp",
    videoUrl: "https://service-22c679da.example.invalid/test.mp4",
    mode: "video",
    prompt: "测试",
} as CreationInspiration;

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originalMethods) {
        if (descriptor) Object.defineProperty(media, key, descriptor);
    }
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("featured card starts on mouse hover and viewer starts on open", async () => {
    plays = loads = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<FeaturedWorks entries={[entry]} />));
        const card = host.querySelector(".featured-work-open") as HTMLButtonElement;
        await act(async () => card.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
        expect(host.querySelector(".featured-work-card video")).not.toBeNull();
        expect(loads).toBe(1);
        expect(plays).toBe(1);

        await act(async () => card.click());
        expect(document.querySelector(".featured-viewer video")).not.toBeNull();
        expect(loads).toBe(2);
        expect(plays).toBe(2);
        await act(async () => document.querySelector(".featured-viewer video")!.dispatchEvent(new dom.Event("error")));
        expect(document.querySelector(".featured-viewer-playback-status")?.textContent).toContain("重新播放");
        await act(async () => (document.querySelector(".featured-viewer-playback-status button") as HTMLButtonElement).click());
        expect(loads).toBe(3);
        expect(plays).toBe(3);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
