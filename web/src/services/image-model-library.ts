import { createClientUUID } from "@/lib/client-id";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { listRemoteAssetsPage, upsertRemoteAsset } from "@/services/api/user-data";
import type { ImageAsset } from "@/stores/use-asset-store";

export const IMAGE_MODEL_TAG = "剧本模特";
export const IMAGE_MODEL_SYSTEM_TAG = "剧本系统模特";
export const IMAGE_MODEL_FAVORITE = "收藏";
export const IMAGE_MODEL_MAX_BYTES = 30 * 1024 * 1024;
export const IMAGE_MODEL_SEARCH = "剧本";
export type ImageModelAsset = ImageAsset;

export function assertImageModelScope(scope: string) {
    if (!scope || scope === "guest") throw new Error("请先登录后使用模特库");
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开模特库");
}

export async function listImageModels(scope: string, signal?: AbortSignal) {
    assertImageModelScope(scope);
    const assets: ImageModelAsset[] = [];
    let page = 1;
    for (;;) {
        const result = await listRemoteAssetsPage({ page, pageSize: 100, kind: "image", status: "active", query: IMAGE_MODEL_SEARCH, signal });
        assertImageModelScope(scope);
        assets.push(...result.assets.filter((asset): asset is ImageModelAsset => asset.kind === "image" && (asset.tags.includes(IMAGE_MODEL_TAG) || asset.tags.includes(IMAGE_MODEL_SYSTEM_TAG)) && Boolean(resourceIdFromStorageKey(asset.data.storageKey))));
        if (!result.hasMore) return assets;
        page++;
    }
}

export function validateImageModelFile(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请上传 JPG、PNG 或 WebP 格式的模特图");
    if (!file.size) throw new Error("图片为空，请重新选择");
    if (file.size > IMAGE_MODEL_MAX_BYTES) throw new Error(`${file.name} 超过 30MB，请压缩后上传`);
}

export async function saveImageModel(scope: string, file: File, presetId?: string): Promise<ImageModelAsset> {
    assertImageModelScope(scope);
    validateImageModelFile(file);
    // 解码真实图片后再上传，避免仅扩展名正确的损坏文件进入个人库。
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    assertImageModelScope(scope);
    const resource = await uploadResourceFile(file, "image", {
        fileName: file.name,
        width,
        height,
        ...(presetId ? { idempotencyKey: `image-model-v1:${scope}:${presetId}` } : {}),
    });
    assertImageModelScope(scope);
    if (!resource.id || resource.status !== "ready") throw new Error("图片尚未保存完成，请稍后重试");
    const now = new Date().toISOString();
    const asset: ImageModelAsset = {
        id: presetId ? `image-model:${presetId}` : createClientUUID(),
        kind: "image",
        title: file.name.replace(/\.[^.]+$/, ""),
        category: "character",
        status: "confirmed",
        source: presetId ? "image-model-preset" : "image-model-upload",
        tags: presetId ? [IMAGE_MODEL_TAG, IMAGE_MODEL_SYSTEM_TAG] : [IMAGE_MODEL_TAG],
        coverUrl: "",
        data: { dataUrl: "", storageKey: resourceStorageKey(resource.id), width, height, bytes: resource.size || file.size, mimeType: file.type },
        metadata: presetId ? { scriptModelPresetId: presetId } : {},
        createdAt: now,
        updatedAt: now,
    };
    await upsertRemoteAsset(asset);
    assertImageModelScope(scope);
    return asset;
}

export async function setImageModelFavorite(scope: string, asset: ImageModelAsset): Promise<ImageModelAsset> {
    assertImageModelScope(scope);
    const favorite = asset.tags.includes(IMAGE_MODEL_FAVORITE);
    const next = { ...asset, tags: favorite ? asset.tags.filter((tag) => tag !== IMAGE_MODEL_FAVORITE) : [...asset.tags, IMAGE_MODEL_FAVORITE], updatedAt: new Date().toISOString() };
    await upsertRemoteAsset(next);
    assertImageModelScope(scope);
    return next;
}
