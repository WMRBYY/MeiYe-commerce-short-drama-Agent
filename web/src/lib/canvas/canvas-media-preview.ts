import { buildLibTVVideoPreviewUrl } from "@/lib/canvas/libtv-import";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasVideoPreviewReference = {
    src: string;
    storageKey?: string;
};

/** This configured OSS CDN supports snapshots without opening a browser video decoder. */
export function canvasDirectVideoPosterUrl(source: string) {
    const libtv = buildLibTVVideoPreviewUrl(source);
    if (libtv) return libtv;
    try {
        const url = new URL(source);
        if (url.protocol !== "https:" || url.hostname !== "service-32b21ee7.example.invalid" || !/\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return "";
        url.searchParams.set("x-oss-process", "video/snapshot,t_0,f_jpg,w_640,m_fast,ar_auto");
        return url.toString();
    } catch { return ""; }
}

/**
 * Returns the passive preview image reference for a video node.
 *
 * `storageKey` is kept separate from the fallback URL so UI callers can
 * resolve a fresh OSS/CDN display URL instead of mounting a stale historical
 * `/api/resources/:id/file` URL stored in older canvas data.
 */
export function canvasNodeVideoPreviewReference(node: CanvasNodeData): CanvasVideoPreviewReference | null {
    if (node.type !== CanvasNodeType.Video) return null;
    const content = node.metadata?.content || "";
    const generatedPreview = node.metadata?.videoPreview;
    if (generatedPreview?.storageKey || (generatedPreview?.content && generatedPreview.content !== content)) {
        return { src: generatedPreview.content || "", storageKey: generatedPreview.storageKey };
    }
    const explicitPreview = node.metadata?.previewContent || "";
    if (explicitPreview && explicitPreview !== content) return { src: explicitPreview };
    const importedPreview = buildLibTVVideoPreviewUrl(content);
    return importedPreview ? { src: importedPreview } : null;
}

/**
 * Returns an image source that is safe to mount for a passive video preview.
 * The original video URL is deliberately never returned: callers must fall
 * back to a video icon instead of creating a decoder outside the active node.
 */
export function canvasNodeVideoPreviewUrl(node: CanvasNodeData) {
    return canvasNodeVideoPreviewReference(node)?.src || "";
}

export function canvasVideoAssetPreviewUrl(videoUrl: string, coverUrl?: string) {
    const explicitCover = coverUrl?.trim() || "";
    if (explicitCover && explicitCover !== videoUrl) return explicitCover;
    return buildLibTVVideoPreviewUrl(videoUrl);
}
