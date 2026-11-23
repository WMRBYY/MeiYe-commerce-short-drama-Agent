import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://meiyeai.example/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
    SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot,
    Event: dom.Event, MouseEvent: dom.MouseEvent, getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

let now = 0;
let timerID = 0;
let reducedMotion = false;
const timers = new Map<number, { at: number; callback: () => void }>();
const preferenceListeners = new Set<() => void>();
Object.defineProperties(dom, {
    setTimeout: { configurable: true, value: (callback: () => void, delay: number) => {
        const id = ++timerID;
        timers.set(id, { at: now + delay, callback });
        return id;
    } },
    clearTimeout: { configurable: true, value: (id: number) => timers.delete(id) },
    matchMedia: { configurable: true, value: () => ({
        get matches() { return reducedMotion; },
        addEventListener: (_type: string, listener: () => void) => preferenceListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => preferenceListeners.delete(listener),
    }) },
});
Object.defineProperty(dom.HTMLImageElement.prototype, "decode", { configurable: true, value: () => Promise.resolve() });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { LoginShowcase, LOGIN_SLIDES } = await import("../src/pages/auth/login-showcase");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    now = 0;
    timers.clear();
    reducedMotion = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    expect(timers.size).toBe(0);
    expect(preferenceListeners.size).toBe(0);
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render(active = true) {
    await act(async () => root.render(<LoginShowcase active={active} />));
}

async function loadImages(indices = LOGIN_SLIDES.map((_, index) => index)) {
    const images = host.querySelectorAll("img");
    await act(async () => {
        for (const index of indices) images[index].dispatchEvent(new Event("load"));
    });
}

async function press(label: string) {
    const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
}

async function advance(milliseconds: number) {
    const target = now + milliseconds;
    while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        await act(async () => next[1].callback());
    }
    now = target;
}

async function visibility(state: "hidden" | "visible") {
    await act(async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
        document.dispatchEvent(new Event("visibilitychange"));
    });
}

function expectSlide(index: number) {
    expect(host.querySelectorAll(".meiye-login-media.is-active").length).toBe(1);
    expect(host.querySelector(".meiye-login-media.is-active img")?.getAttribute("src")).toBe(`/login-showcase/${LOGIN_SLIDES[index].id}.webp`);
    expect(host.querySelector(".meiye-login-caption-item.is-active h3")?.textContent).toBe(LOGIN_SLIDES[index].title);
    expect(host.querySelector('.meiye-login-dots [aria-pressed="true"]')?.getAttribute("aria-label")).toBe(`第 ${index + 1} 张：${LOGIN_SLIDES[index].title}`);
}

describe("login showcase image carousel", () => {
    test("keeps all five images and captions mounted, preloads eagerly, and never renders video", async () => {
        await render();
        const images = [...host.querySelectorAll("img")];
        const captions = [...host.querySelectorAll(".meiye-login-caption-item")];
        expect(images.length).toBe(5);
        expect(captions.length).toBe(5);
        for (const image of images) {
            expect(image.getAttribute("loading")).toBe("eager");
            expect(image.getAttribute("decoding")).toBe("async");
            expect(image.getAttribute("width")).toBe("1024");
            expect(image.getAttribute("height")).toBe("1024");
        }
        expect(host.querySelector("video, source")).toBeNull();
        await loadImages();
        await press("下一张");
        expectSlide(1);
        images.forEach((image, index) => expect(host.querySelectorAll("img")[index]).toBe(image));
        captions.forEach((caption, index) => expect(host.querySelectorAll(".meiye-login-caption-item")[index]).toBe(caption));
        expect(host.querySelectorAll('.meiye-login-caption-item[aria-hidden="true"]').length).toBe(4);
    });

    test("automatically advances every seven seconds and wraps after the fifth image", async () => {
        await render();
        await loadImages();
        await advance(6999);
        expectSlide(0);
        await advance(1);
        expectSlide(1);
        await advance(21000);
        expectSlide(4);
        await advance(7000);
        expectSlide(0);
    });

    test("arrows and dots select images and manual navigation starts a fresh interval", async () => {
        await render();
        await loadImages();
        await advance(6000);
        await press("上一张");
        expectSlide(4);
        await advance(1000);
        expectSlide(4);
        await press("下一张");
        expectSlide(0);
        await press(`第 3 张：${LOGIN_SLIDES[2].title}`);
        expectSlide(2);
        await advance(7000);
        expectSlide(3);
    });

    test("retains the current image until a requested image finishes decoding", async () => {
        await render();
        await loadImages([0]);
        let finishDecode!: () => void;
        const decoded = new Promise<void>((resolve) => { finishDecode = resolve; });
        Object.defineProperty(host.querySelectorAll("img")[1], "decode", { configurable: true, value: () => decoded });
        await press("下一张");
        await loadImages([1]);
        expectSlide(0);
        expect(timers.size).toBe(0);
        await act(async () => finishDecode());
        expectSlide(1);
        expect(timers.size).toBe(1);
    });

    test("pause stops automatic changes while manual controls remain usable", async () => {
        await render();
        await loadImages();
        await press("暂停轮播");
        await advance(21000);
        expectSlide(0);
        await press("下一张");
        expectSlide(1);
        await advance(7000);
        expectSlide(1);
        await press("播放轮播");
        await advance(7000);
        expectSlide(2);
    });

    test("an image loaded after closing cannot change the hidden slide", async () => {
        await render();
        await loadImages([0]);
        await press("下一张");
        await render(false);
        await loadImages([1]);
        expectSlide(0);
        expect(timers.size).toBe(0);
        await render(true);
        expectSlide(1);
    });

    test("background and closed modal suspend rotation and resume with a full interval", async () => {
        await render();
        await loadImages();
        await advance(6000);
        await visibility("hidden");
        await advance(21000);
        expectSlide(0);
        await visibility("visible");
        await advance(6999);
        expectSlide(0);
        await advance(1);
        expectSlide(1);
        await render(false);
        await advance(21000);
        expectSlide(1);
        await render(true);
        await advance(7000);
        expectSlide(2);
    });

    test("reduced motion disables automatic rotation while retaining manual navigation", async () => {
        reducedMotion = true;
        await render();
        await loadImages();
        expect(host.querySelector('[aria-label="暂停轮播"]')).toBeNull();
        await advance(21000);
        expectSlide(0);
        await press("下一张");
        expectSlide(1);
        await act(async () => {
            reducedMotion = false;
            preferenceListeners.forEach((listener) => listener());
        });
        await advance(7000);
        expectSlide(2);
        await act(async () => {
            reducedMotion = true;
            preferenceListeners.forEach((listener) => listener());
        });
        await advance(21000);
        expectSlide(2);
    });
});
