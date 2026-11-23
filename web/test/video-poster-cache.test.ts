import { expect, mock, test } from "bun:test";
let scope = "poster-user";
let available = true;
let reads = 0;
let captures = 0;
let saved = 0;
let resolved = 0;
const variants: string[] = [];
mock.module("../src/lib/user-scope", () => ({ getActiveUserScope: () => scope }));
mock.module("../src/services/api/resources", () => ({
    getResourceAccess: async (_key: string, _purpose: string, variant: string) => { reads++; variants.push(variant); if (!available) throw new Error("no poster"); return { url: "/api/poster.jpg" }; },
    resolveResourceAccessURL: (url: string) => url,
    resourceIdFromStorageKey: (key?: string) => key?.startsWith("resource:") ? key.slice(9) : "",
    resourceStorageKeyFromUrl: () => "resource:video",
    saveVideoPoster: async () => { saved++; },
}));
mock.module("../src/services/file-storage", () => ({ resolveVideoMediaUrl: async () => { resolved++; return "https://example.test/video.mp4"; } }));
mock.module("../src/lib/video-poster", () => ({ captureVideoPoster: async () => { captures++; return { poster: new Blob(["poster"], { type: "image/jpeg" }) }; } }));
mock.module("../src/services/resource-blob-cache", () => ({ loadCachedResourceObjectUrl: async () => null }));
mock.module("../src/services/image-storage", () => ({ uploadImage: async () => ({ url: "/image", storageKey: "resource:poster", width: 2, height: 2, bytes: 6, mimeType: "image/jpeg" }) }));
mock.module("../src/services/canvas-image-loader", () => ({ prepareCanvasImage: async () => undefined }));
mock.module("../src/lib/canvas/canvas-media-preview", () => ({ canvasDirectVideoPosterUrl: () => "" }));
Object.assign(globalThis, { window: { requestIdleCallback: (callback: () => void) => setTimeout(callback, 0), cancelIdleCallback: clearTimeout } });
const { hydrateCanvasVideoPreview } = await import("../src/services/canvas-video-preview");
test("cached server cover never resolves or decodes the video, including a new component", async () => {
    const node = { id: "node", metadata: { storageKey: "resource:cached-video" } };
    expect((await hydrateCanvasVideoPreview(node))?.localUrl).toBe("/api/poster.jpg");
    expect((await hydrateCanvasVideoPreview(node))?.localUrl).toBe("/api/poster.jpg");
    expect(reads).toBe(1); expect(resolved).toBe(0); expect(captures).toBe(0);
});
test("missing cover retains automatic browser extraction and saves a server cover", async () => {
    available = false;
    const node = { id: "fallback", metadata: { storageKey: "resource:missing-video" } };
    const result = await hydrateCanvasVideoPreview(node);
    expect(result?.localUrl.startsWith("blob:")).toBe(true);
    await result?.persisted;
    expect(captures).toBe(1); expect(saved).toBe(1);
    const reused = await hydrateCanvasVideoPreview(node);
    expect(captures).toBe(1);
    if (result) URL.revokeObjectURL(result.localUrl);
    if (reused) URL.revokeObjectURL(reused.localUrl);
});
test("another user cannot reuse the previous user's cached poster", async () => {
    scope = "other-user"; available = true;
    const before = reads;
    await hydrateCanvasVideoPreview({ id: "node", metadata: { storageKey: "resource:cached-video" } });
    expect(reads).toBe(before + 1);
});
test("small list posters do not reuse the canvas preview size", async () => {
    available = true;
    const before = reads;
    await hydrateCanvasVideoPreview({ id: "node", metadata: { storageKey: "resource:cached-video" } }, undefined, "thumbnail-small");
    expect(reads).toBe(before + 1);
    expect(variants.at(-1)).toBe("thumbnail-small");
});
