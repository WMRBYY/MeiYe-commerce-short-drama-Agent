import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://preview.example.com" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    ResizeObserver: dom.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
let originalLookup: (key?: string, fallback?: string) => Promise<string> = async () => "/original.png";
let thumbnailLookup: (key?: string) => Promise<string> = async () => "/thumbnail.jpg";
const originalCalls: string[] = [];
const thumbnailCalls: string[] = [];
let cached = "";
mock.module("@/components/ui/product/app-modal", () => ({ AppModal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
mock.module("@/services/image-storage", () => ({
    resolveImageUrl: (key?: string, fallback?: string) => {
        originalCalls.push(key || "");
        return originalLookup(key, fallback);
    },
    resolveImagePreviewUrl: (key?: string) => {
        thumbnailCalls.push(key || "");
        return thumbnailLookup(key);
    },
}));
mock.module("@/services/resource-blob-cache", () => ({ peekCachedResourceObjectUrl: () => cached }));
mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => "test-user" }));
const { CanvasImagePreview } = await import("@/components/canvas/canvas-image-preview");
let host = document.createElement("div");
let root = createRoot(host);
document.body.append(host);
function deferred() {
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
async function render(props: { storageKey?: string; src?: string; previewSrc?: string }) {
    await act(async () => root.render(<CanvasImagePreview {...props} alt="角色参考图" onClose={() => {}} />));
}
async function imageEvent(src: string, type: "load" | "error") {
    const img = host.querySelector(`img[src="${src}"]`);
    expect(img).not.toBeNull();
    await act(async () => img!.dispatchEvent(new dom.Event(type)));
}
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    originalCalls.length = 0;
    thumbnailCalls.length = 0;
    cached = "";
    originalLookup = async () => "/original.png";
    thumbnailLookup = async () => "/thumbnail.jpg";
});
afterAll(async () => {
    await act(async () => root.unmount());
    host.remove();
    mock.restore();
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("an already visible card image appears while the original is still resolving, then upgrades on load", async () => {
    const pending = deferred();
    originalLookup = () => pending.promise;
    await render({ storageKey: "resource:a", previewSrc: "/card.jpg" });
    expect(host.querySelector('img[src="/card.jpg"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="图片加载中"]')).toBeNull();
    expect(thumbnailCalls).toHaveLength(0);
    await act(async () => pending.resolve("/original.png"));
    expect(host.querySelector('img[src="/card.jpg"]')).not.toBeNull();
    await imageEvent("/original.png", "load");
    expect(host.querySelector('img[src="/card.jpg"]')).toBeNull();
    expect(host.querySelector('img[src="/original.png"]')?.getAttribute("aria-hidden")).toBe("false");
});

test("thumbnail lookup does not wait for the original and removes the blocking placeholder once decoded", async () => {
    originalLookup = () => deferred().promise;
    await render({ storageKey: "resource:a" });
    expect(originalCalls).toHaveLength(1);
    expect(thumbnailCalls).toHaveLength(1);
    await imageEvent("/thumbnail.jpg", "load");
    expect(host.querySelector('[aria-label="图片加载中"]')).toBeNull();
    expect(host.textContent).toContain("正在载入高清图片");
});

test("a failed original keeps the readable thumbnail instead of covering it with an error", async () => {
    await render({ storageKey: "resource:a", previewSrc: "/card.jpg" });
    await imageEvent("/original.png", "error");
    expect(host.querySelector('img[src="/card.jpg"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("当前显示预览图");
});

test("thumbnail failure still permits the original to load", async () => {
    thumbnailLookup = async () => {
        throw new Error("no thumbnail");
    };
    await render({ storageKey: "resource:a" });
    await imageEvent("/original.png", "load");
    expect(host.querySelector('[aria-label="图片加载中"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("switching resources discards a late original response", async () => {
    const old = deferred();
    originalLookup = (key) => (key === "resource:a" ? old.promise : Promise.resolve("/new.png"));
    await render({ storageKey: "resource:a", previewSrc: "/old-card.jpg" });
    await render({ storageKey: "resource:b", previewSrc: "/new-card.jpg" });
    await act(async () => old.resolve("/old.png"));
    expect(host.querySelector('img[src="/old.png"]')).toBeNull();
    expect(host.querySelector('img[src="/old-card.jpg"]')).toBeNull();
    expect(host.querySelector('img[src="/new-card.jpg"]')).not.toBeNull();
});

test("session-local originals skip both address lookups", async () => {
    cached = "blob:local-original";
    await render({ storageKey: "resource:a" });
    expect(originalCalls).toHaveLength(0);
    expect(thumbnailCalls).toHaveLength(0);
    await imageEvent("blob:local-original", "load");
    expect(host.querySelector('[role="status"]')).toBeNull();
});

test("a late card thumbnail does not restart an already loaded original", async () => {
    await render({ storageKey: "resource:a" });
    await imageEvent("/original.png", "load");
    await render({ storageKey: "resource:a", previewSrc: "/card.jpg" });
    expect(originalCalls).toHaveLength(1);
    expect(host.querySelector('img[src="/card.jpg"]')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
});
