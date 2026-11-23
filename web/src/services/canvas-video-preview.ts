import { getActiveUserScope } from "@/lib/user-scope";
import { captureVideoPoster } from "@/lib/video-poster";
import { loadCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { resolveVideoMediaUrl } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { canvasDirectVideoPosterUrl } from "@/lib/canvas/canvas-media-preview";
import { prepareCanvasImage } from "@/services/canvas-image-loader";
import { getResourceAccess, resolveResourceAccessURL, resourceIdFromStorageKey, resourceStorageKeyFromUrl, saveVideoPoster } from "@/services/api/resources";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type VideoPreview = NonNullable<CanvasNodeMetadata["videoPreview"]>;
type HydratedPoster = { poster?: Blob; url?: string; expiresAt?: number; persisted: Promise<VideoPreview | null> };
type CanvasVideoHydrationEntry = {
    promise: Promise<HydratedPoster | null>;
    controller: AbortController;
    subscribers: number;
    settled: boolean;
};

const canvasVideoHydrationBySource = new Map<string, CanvasVideoHydrationEntry>();
// Small posters only; retain a bounded cache so references and nodes share one decode/upload.
const completedPosters = new Map<string, HydratedPoster>();

export type HydratedCanvasVideoPreview = {
    /** 页面使用静态 CDN 地址或本地 object URL 渲染首帧，不等待上传。 */
    localUrl: string;
    /** 持久化上传在首帧已经可见后后台完成；失败不影响本地首帧。 */
    persisted: Promise<VideoPreview | null>;
};

export async function hydrateCanvasVideoPreview(node: Pick<CanvasNodeData, "id" | "metadata">, signal?: AbortSignal, variant: "thumbnail" | "thumbnail-small" = "thumbnail") {
    const sourceKey = node.metadata?.storageKey || node.metadata?.content || "";
    if (!sourceKey) return Promise.resolve(null);
    const key = `${getActiveUserScope()}:${sourceKey}:${variant}`;
    const cached = completedPosters.get(key);
    if (cached && (!cached.expiresAt || cached.expiresAt > Date.now() + 30_000) && !signal?.aborted) return Promise.resolve({ localUrl: cached.url || URL.createObjectURL(cached.poster!), persisted: cached.persisted });
    if (cached) completedPosters.delete(key);
    let entry = canvasVideoHydrationBySource.get(key);
    if (!entry) {
        const controller = new AbortController();
        entry = { promise: Promise.resolve(null), controller, subscribers: 0, settled: false };
        const request = generateCanvasVideoPreview(node, controller.signal, variant).then(
            (result) => {
                entry!.settled = true;
                if (result) {
                    completedPosters.set(key, result);
                    while (completedPosters.size > 48) completedPosters.delete(completedPosters.keys().next().value!);
                }
                return result;
            },
            (error) => {
                entry!.settled = true;
                throw error;
            },
        );
        entry.promise = request;
        canvasVideoHydrationBySource.set(key, entry);
        void request.then(
            (result) => {
                if (result) return result.persisted.finally(() => clearCanvasVideoHydration(key, entry!));
                clearCanvasVideoHydration(key, entry!);
                return null;
            },
            () => {
                clearCanvasVideoHydration(key, entry!);
                return null;
            },
        );
    }
    entry.subscribers += 1;
    const shared = entry;
    return withAbort(shared.promise, signal)
        .then((result) => {
            if (!result) return null;
            const localUrl = result.url || URL.createObjectURL(result.poster!);
            return { localUrl, persisted: result.persisted };
        })
        .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            return null;
        })
        .finally(() => releaseCanvasVideoHydration(key, shared));
}

function releaseCanvasVideoHydration(key: string, entry: CanvasVideoHydrationEntry) {
    entry.subscribers = Math.max(0, entry.subscribers - 1);
    if (entry.subscribers || entry.settled || canvasVideoHydrationBySource.get(key) !== entry) return;
    entry.controller.abort();
    canvasVideoHydrationBySource.delete(key);
}

function clearCanvasVideoHydration(key: string, entry: CanvasVideoHydrationEntry) {
    if (canvasVideoHydrationBySource.get(key) === entry) canvasVideoHydrationBySource.delete(key);
}

async function generateCanvasVideoPreview(node: Pick<CanvasNodeData, "id" | "metadata">, signal: AbortSignal | undefined, variant: "thumbnail" | "thumbnail-small"): Promise<HydratedPoster | null> {
    await waitForBrowserIdle(signal);
    throwIfAborted(signal);
    const scope = getActiveUserScope();
    const storageKey = node.metadata?.storageKey || resourceStorageKeyFromUrl(node.metadata?.content);
    if (resourceIdFromStorageKey(storageKey)) {
        try {
            const access = await getResourceAccess(storageKey, "display", variant);
            const url = resolveResourceAccessURL(access.url);
            await prepareCanvasImage(url, signal || new AbortController().signal, 12_000);
            throwIfAborted(signal);
            if (getActiveUserScope() !== scope) throw abortError();
            return { url, expiresAt: access.expiresAt ? Date.parse(access.expiresAt) : undefined, persisted: Promise.resolve(null) };
        } catch {
            if (signal?.aborted || getActiveUserScope() !== scope) throw abortError();
        }
    }
    const lease = storageKey ? await loadCachedResourceObjectUrl(storageKey).catch(() => null) : null;
    let captured: Awaited<ReturnType<typeof captureVideoPoster>>;
    try {
        throwIfAborted(signal);
        const source = lease?.url || (await resolveVideoMediaUrl(node.metadata?.storageKey, node.metadata?.content || ""));
        if (!source) return null;
        const directPoster = canvasDirectVideoPosterUrl(source);
        if (directPoster) {
            try {
                const response = await fetch(directPoster, { signal, credentials: "omit" });
                if (!response.ok) throw new Error("视频快照不可用");
                const poster = await response.blob();
                throwIfAborted(signal);
                if (getActiveUserScope() !== scope) throw abortError();
                await saveVideoPoster(storageKey, poster).catch(() => undefined);
                return { poster, persisted: Promise.resolve(null) };
            } catch {
                if (signal?.aborted || getActiveUserScope() !== scope) throw abortError();
            }
        }
        captured = await captureVideoPoster(source, { signal, maxWidth: 400 });
    } finally {
        lease?.release();
    }
    throwIfAborted(signal);
    if (getActiveUserScope() !== scope) throw abortError();
    if (!captured.poster) return null;
    void saveVideoPoster(storageKey, captured.poster).catch(() => undefined);
    const persisted = uploadImage(captured.poster)
        .then((preview) => ({
            content: preview.url,
            storageKey: preview.storageKey,
            width: preview.width,
            height: preview.height,
            bytes: preview.bytes,
            mimeType: preview.mimeType,
        }))
        .catch((error) => {
            // 首帧已经在本地可见；预览图持久化失败只影响后续刷新，不阻断视频节点。
            console.warn("视频首帧持久化失败，保留本地首帧", { nodeId: node.id, error });
            return null;
        });
    return { poster: captured.poster, persisted };
}

function waitForBrowserIdle(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        let idleId: number | undefined;
        let timerId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const idleWindow = window as unknown as {
            requestIdleCallback?: Window["requestIdleCallback"];
            cancelIdleCallback?: Window["cancelIdleCallback"];
        };
        const cleanup = () => {
            signal?.removeEventListener("abort", handleAbort);
            if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
            if (timerId !== undefined) globalThis.clearTimeout(timerId);
        };
        const finish = () => {
            cleanup();
            resolve();
        };
        const handleAbort = () => {
            cleanup();
            reject(abortError());
        };
        signal?.addEventListener("abort", handleAbort, { once: true });
        if (idleWindow.requestIdleCallback) idleId = idleWindow.requestIdleCallback(finish, { timeout: 1_000 });
        else timerId = globalThis.setTimeout(finish, 250);
    });
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
        const handleAbort = () => {
            cleanup();
            reject(abortError());
        };
        const cleanup = () => signal.removeEventListener("abort", handleAbort);
        signal.addEventListener("abort", handleAbort, { once: true });
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
}

function abortError() {
    return new DOMException("Canvas video preview hydration aborted", "AbortError");
}
