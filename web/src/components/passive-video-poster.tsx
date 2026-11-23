import { useEffect, useRef, useState, type ReactNode } from "react";
import { Video } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { hydrateCanvasVideoPreview } from "@/services/canvas-video-preview";
import { resourceStorageKeyFromUrl } from "@/services/api/resources";
import { getActiveUserScope } from "@/lib/user-scope";

/** List previews reuse server posters. Browser extraction remains the fallback. */
export function PassiveVideoPoster({ src, storageKey, poster, alt = "视频预览", className, fallback }: {
    src: string; storageKey?: string; poster?: string; alt?: string; className?: string; fallback?: ReactNode;
}) {
    const container = useRef<HTMLSpanElement>(null);
    const scope = getActiveUserScope();
    const identity = `${scope}:${storageKey || src}`;
    const [preview, setPreview] = useState<{ identity: string; url: string }>();
    useEffect(() => {
        if (poster && poster !== src) return;
        const controller = new AbortController();
        let started = false;
        let objectUrl = "";
        const load = () => {
            if (started || controller.signal.aborted) return;
            started = true;
            void hydrateCanvasVideoPreview({ id: "video-preview", metadata: { storageKey: storageKey || resourceStorageKeyFromUrl(src), content: src } }, controller.signal, "thumbnail-small").then((result) => {
                if (!result) return;
                objectUrl = result.localUrl;
                if (controller.signal.aborted || getActiveUserScope() !== scope) {
                    if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
                    return;
                }
                setPreview({ identity, url: objectUrl });
            }).catch(() => undefined);
        };
        const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); load(); }
        }, { rootMargin: "160px" });
        if (observer && container.current) observer.observe(container.current);
        else load();
        return () => {
            controller.abort(); observer?.disconnect();
            if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
        };
    }, [identity, poster, scope, src, storageKey]);
    if (poster && poster !== src) return <CachedResourceImage storageKey={resourceStorageKeyFromUrl(poster)} src={poster} alt={alt} variant="thumbnail-small" loading="lazy" className={className} fallback={fallback} />;
    return <span ref={container} className={`block ${className || ""}`}>
        {preview?.identity === identity ? <img src={preview.url} alt={alt} className={className} decoding="async" /> : fallback ?? <Video aria-label={alt} />}
    </span>;
}
