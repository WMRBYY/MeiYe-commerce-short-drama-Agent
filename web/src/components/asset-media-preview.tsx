import type { ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { PassiveVideoPoster } from "@/components/passive-video-poster";
import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
    /** 解析授权地址期间显示的内容，缺省与 fallback 相同。 */
    loadingFallback?: ReactNode;
    /** 图片或视频首帧可以显示时调用，供卡片结束加载骨架。 */
    onLoad?: () => void;
    onError?: () => void;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null, loadingFallback = fallback, onLoad, onError }: AssetMediaPreviewProps) {
    if (!asset) return fallback;

    if (asset.kind === "video" && asset.data.url) {
        const poster = asset.coverUrl && asset.coverUrl !== asset.data.url ? asset.coverUrl : undefined;
        return <PassiveVideoPoster src={asset.data.url} storageKey={asset.data.storageKey} poster={poster} alt={alt} className={className} fallback={fallback} />;
    }

    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={imageUrl} variant="thumbnail-small" alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} loadingFallback={loadingFallback} onLoad={onLoad} onError={onError} />;
}
