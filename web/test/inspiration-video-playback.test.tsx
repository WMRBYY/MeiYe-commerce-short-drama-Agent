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
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

let plays = 0;
let loads = 0;
let pauses = 0;
const media = dom.HTMLMediaElement.prototype;
const originalMethods = new Map(["play", "load", "pause"].map((key) => [key, Object.getOwnPropertyDescriptor(media, key)]));
Object.defineProperty(media, "play", { configurable: true, value: () => { plays += 1; return Promise.resolve(); } });
Object.defineProperty(media, "load", { configurable: true, value: () => { loads += 1; } });
Object.defineProperty(media, "pause", { configurable: true, value: () => { pauses += 1; } });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { InspirationVideo } = await import("../src/pages/inspirations/inspiration-video");
const item = { id: "seedance:test", title: "测试视频", image: "/cover.webp", videoUrl: "https://service-22c679da.example.invalid/test.mp4", mode: "video" } as CreationInspiration;

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

test("hover playback reloads once on media failure and offers a visible retry", async () => {
    plays = loads = pauses = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<InspirationVideo item={item} hovered />));
        expect(plays).toBe(1);
        const video = host.querySelector("video")!;
        await act(async () => video.dispatchEvent(new dom.Event("error")));
        expect(loads).toBe(1);
        expect(plays).toBe(2);
        await act(async () => video.dispatchEvent(new dom.Event("error")));
        expect(host.textContent).toContain("视频加载失败");
        expect(host.querySelector('[aria-label="重试播放视频"]')).not.toBeNull();
        await act(async () => (host.querySelector('[aria-label="重试播放视频"]') as HTMLButtonElement).click());
        expect(loads).toBe(2);
        expect(plays).toBe(3);
        await act(async () => root.render(<InspirationVideo item={item} hovered={false} />));
        expect(pauses).toBeGreaterThan(0);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("a video that never starts times out, reloads once, then shows retry", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalPlay = Object.getOwnPropertyDescriptor(media, "play")!;
    const watchdogs: Array<() => void> = [];
    Object.defineProperty(media, "play", { configurable: true, value: () => { plays += 1; return new Promise<void>(() => {}); } });
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 8000 && typeof callback === "function") {
            watchdogs.push(() => callback(...args));
            return 987654 as unknown as ReturnType<typeof setTimeout>;
        }
        return originalSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout;
    plays = loads = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<InspirationVideo item={item} hovered />));
        expect(watchdogs.length).toBe(1);
        await act(async () => watchdogs.shift()!());
        expect(loads).toBe(1);
        expect(plays).toBe(2);
        expect(watchdogs.length).toBe(1);
        await act(async () => watchdogs.shift()!());
        expect(host.textContent).toContain("加载较慢，请重试");
        expect(host.querySelector('[aria-label="重试播放视频"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
        globalThis.setTimeout = originalSetTimeout;
        Object.defineProperty(media, "play", originalPlay);
    }
});

test("detail waits for a user action before playing", async () => {
    plays = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<InspirationVideo item={item} detail />));
        expect(plays).toBe(0);
        await act(async () => (host.querySelector('[aria-label="播放视频"]') as HTMLButtonElement).click());
        expect(plays).toBe(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
