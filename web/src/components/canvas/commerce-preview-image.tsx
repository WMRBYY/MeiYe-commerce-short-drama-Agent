import { memo } from "react";
import { ImageIcon } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import type { CanvasNodeData } from "@/types/canvas";

/** Display-only thumbnail: shares the canvas decode queue and user-scoped recent-source cache. */
export const CommercePreviewImage = memo(function CommercePreviewImage({ node, alt, className = "size-full", fit = "contain" }: {
    node: CanvasNodeData;
    alt: string;
    className?: string;
    fit?: "contain" | "cover";
}) {
    return <span className={`inline-flex items-center justify-center overflow-hidden ${className}`}>
        <CachedResourceImage storageKey={node.metadata?.storageKey} src={node.metadata?.previewContent || node.metadata?.content}
            variant="thumbnail" alt={alt} loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer"
            className={`pointer-events-none block size-full select-none ${fit === "cover" ? "object-cover" : "object-contain"}`}
            fallback={<ImageIcon aria-hidden className="size-5 opacity-35" />} />
    </span>;
});
