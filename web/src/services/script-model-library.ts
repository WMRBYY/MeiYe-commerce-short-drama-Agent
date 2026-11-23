import { createClientUUID } from "@/lib/client-id";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { listRemoteAssetsPage, upsertRemoteAsset } from "@/services/api/user-data";
import type { ImageAsset } from "@/stores/use-asset-store";

export const SCRIPT_MODEL_TAG = "剧本模特";
export const SCRIPT_MODEL_SYSTEM_TAG = "剧本系统模特";
export const SCRIPT_MODEL_FAVORITE = "收藏";
export const SCRIPT_MODEL_MAX_BYTES = 30 * 1024 * 1024;
export const SCRIPT_MODEL_SEARCH = "剧本";
export type ScriptModelAsset = ImageAsset;

export function assertScriptModelScope(scope: string) {
    if (!scope || scope === "guest") throw new Error("请先登录后使用模特库");
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开模特库");
}

export async function listScriptModels(scope: string, signal?: AbortSignal) {
    assertScriptModelScope(scope);
    const assets: ScriptModelAsset[] = [];
    let page = 1;
    for (;;) {
        const result = await listRemoteAssetsPage({ page, pageSize: 100, kind: "image", status: "active", query: SCRIPT_MODEL_SEARCH, signal });
        assertScriptModelScope(scope);
        assets.push(
            ...result.assets.filter((asset): asset is ScriptModelAsset => asset.kind === "image" && (asset.tags.includes(SCRIPT_MODEL_TAG) || asset.tags.includes(SCRIPT_MODEL_SYSTEM_TAG)) && Boolean(resourceIdFromStorageKey(asset.data.storageKey))),
        );
        if (!result.hasMore) return assets;
        page++;
    }
}

export function validateScriptModelFile(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请上传 JPG、PNG 或 WebP 格式的模特图");
    if (!file.size) throw new Error("图片为空，请重新选择");
    if (file.size > SCRIPT_MODEL_MAX_BYTES) throw new Error(`${file.name} 超过 30MB，请压缩后上传`);
}

export async function saveScriptModel(scope: string, file: File, presetId?: string): Promise<ScriptModelAsset> {
    assertScriptModelScope(scope);
    validateScriptModelFile(file);
    // 解码真实图片后再上传，避免仅扩展名正确的损坏文件进入个人库。
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    assertScriptModelScope(scope);
    const resource = await uploadResourceFile(file, "image", {
        fileName: file.name,
        width,
        height,
        ...(presetId ? { idempotencyKey: `script-model-v1:${scope}:${presetId}` } : {}),
    });
    assertScriptModelScope(scope);
    if (!resource.id || resource.status !== "ready") throw new Error("图片尚未保存完成，请稍后重试");
    const now = new Date().toISOString();
    const asset: ScriptModelAsset = {
        id: presetId ? `script-model:${presetId}` : createClientUUID(),
        kind: "image",
        title: file.name.replace(/\.[^.]+$/, ""),
        category: "character",
        status: "confirmed",
        source: presetId ? "script-model-preset" : "script-model-upload",
        tags: presetId ? [SCRIPT_MODEL_TAG, SCRIPT_MODEL_SYSTEM_TAG] : [SCRIPT_MODEL_TAG],
        coverUrl: "",
        data: { dataUrl: "", storageKey: resourceStorageKey(resource.id), width, height, bytes: resource.size || file.size, mimeType: file.type },
        metadata: presetId ? { scriptModelPresetId: presetId } : {},
        createdAt: now,
        updatedAt: now,
    };
    await upsertRemoteAsset(asset);
    assertScriptModelScope(scope);
    return asset;
}

export async function setScriptModelFavorite(scope: string, asset: ScriptModelAsset): Promise<ScriptModelAsset> {
    assertScriptModelScope(scope);
    const favorite = asset.tags.includes(SCRIPT_MODEL_FAVORITE);
    const next = { ...asset, tags: favorite ? asset.tags.filter((tag) => tag !== SCRIPT_MODEL_FAVORITE) : [...asset.tags, SCRIPT_MODEL_FAVORITE], updatedAt: new Date().toISOString() };
    await upsertRemoteAsset(next);
    assertScriptModelScope(scope);
    return next;
}
