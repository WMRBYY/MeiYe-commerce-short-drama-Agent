import type { Asset } from "@/stores/use-asset-store";

// 先收集完整名单再确认，避免一边删除一边翻页导致后续作品被跳过。
export async function collectShopWorkIds(loadPage: (page: number) => Promise<{ assets: Asset[]; hasMore: boolean }>, includes: (asset: Asset) => boolean, assertCurrentUser: () => void) {
    const ids = new Set<string>();
    for (let page = 1; ; page++) {
        assertCurrentUser();
        const result = await loadPage(page);
        assertCurrentUser();
        for (const asset of result.assets) {
            if ((asset.kind === "image" || asset.kind === "video") && asset.status !== "archived" && includes(asset)) {
                if (!asset.id.trim()) throw new Error("作品信息不完整，请刷新后重试");
                ids.add(asset.id);
            }
        }
        if (!result.hasMore) return [...ids];
        if (!result.assets.length) throw new Error("作品列表未读取完整，请重试");
    }
}

export async function deleteShopWorkIds(
    ids: string[],
    options: {
        assertCurrentUser: () => void;
        deleteBatch: (ids: string[]) => Promise<void>;
        onDeleted: (ids: string[]) => void;
    },
) {
    if (!ids.length || ids.some((id) => !id.trim())) throw new Error("请重新选择要删除的作品");
    const unique = [...new Set(ids)];
    for (let offset = 0; offset < unique.length; offset += 1000) {
        options.assertCurrentUser();
        const batch = unique.slice(offset, offset + 1000);
        await options.deleteBatch(batch);
        options.assertCurrentUser();
        options.onDeleted(batch);
    }
}
