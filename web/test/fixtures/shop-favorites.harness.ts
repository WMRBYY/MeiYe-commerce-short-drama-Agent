import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import localforage from "localforage";
import * as sync from "../../src/services/user-data-sync";
import * as assetStore from "../../src/stores/use-asset-store";
import { useUserStore } from "../../src/stores/use-user-store";
import { setActiveUserScope } from "../../src/lib/user-scope";
import { toggleShopFavorite } from "../../src/pages/shop/shop-edits";

const dom = new Window({ url: "http://localhost/" });
const memory = new Map<string, unknown>();
localforage.getItem = (async (key: string) => memory.get(key) ?? null) as typeof localforage.getItem;
localforage.setItem = (async (key: string, value: unknown) => {
    memory.set(key, value);
    return value;
}) as typeof localforage.setItem;
localforage.removeItem = async (key: string) => {
    memory.delete(key);
};
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
const asset = {
    id: "work",
    kind: "image",
    title: "商品图",
    tags: ["商品"],
    coverUrl: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    data: { dataUrl: "", storageKey: "resource:product", width: 100, height: 100, bytes: 0, mimeType: "image/png" },
} as assetStore.Asset;
let persist: () => Promise<void> = async () => undefined;
let save: () => Promise<void> = async () => undefined;
let list: () => Promise<any> = async () => ({ assets: [asset], hasMore: false });
let saves = 0;
let loads = 0;
const spies = [
    spyOn(assetStore, "flushAssetStorePersistence").mockImplementation(() => persist()),
    spyOn(sync, "saveRemoteUserDataNow").mockImplementation(async () => {
        saves++;
        await save();
    }),
    spyOn(sync, "loadAssetLibraryPage").mockImplementation(() => list()),
    spyOn(sync, "loadAssetsForUse").mockImplementation(async () => {
        loads++;
        return [];
    }),
];
beforeEach(() => {
    dom.localStorage.clear();
    setActiveUserScope("owner");
    useUserStore.setState({ user: { id: "owner" } as any });
    assetStore.useAssetStore.setState({ assets: [structuredClone(asset)] });
    persist = async () => undefined;
    save = async () => undefined;
    saves = 0;
    loads = 0;
});
afterAll(() => {
    spies.forEach((spy) => spy.mockRestore());
    dom.happyDOM.abort();
});

test("保存失败同时撤回收藏状态与素材标签", async () => {
    save = async () => {
        throw new Error("网络中断");
    };
    await expect(toggleShopFavorite("owner", "product")).rejects.toThrow("网络中断");
    expect(assetStore.useAssetStore.getState().assets[0].tags).toEqual(["商品"]);
    expect(JSON.parse(dom.localStorage.getItem("shop-favorites:owner") || "[]")).toEqual([]);
});

test("连续点击复用同一保存请求", async () => {
    let release!: () => void;
    persist = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    const first = toggleShopFavorite("owner", "product");
    const second = toggleShopFavorite("owner", "product");
    expect(first).toBe(second);
    await Promise.resolve();
    release();
    await first;
    expect(saves).toBe(1);
});

test("查找素材期间切换账号不把旧素材导入新账号", async () => {
    assetStore.useAssetStore.setState({ assets: [] });
    let release!: (value: any) => void;
    list = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    const pending = toggleShopFavorite("owner", "other-product");
    setActiveUserScope("other");
    useUserStore.setState({ user: { id: "other" } as any });
    release({ assets: [{ ...asset, data: { ...asset.data, storageKey: "resource:other-product" } }], hasMore: false });
    await expect(pending).rejects.toThrow("账号已切换");
    expect(loads).toBe(0);
    expect(saves).toBe(0);
    expect(assetStore.useAssetStore.getState().assets).toEqual([]);
});

test("持久化期间切换账号不继续执行远端写入", async () => {
    let release!: () => void;
    persist = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    const pending = toggleShopFavorite("owner", "product");
    await Promise.resolve();
    setActiveUserScope("other");
    useUserStore.setState({ user: { id: "other" } as any });
    assetStore.useAssetStore.setState({ assets: [] });
    release();
    await expect(pending).rejects.toThrow("账号已切换");
    expect(saves).toBe(0);
    expect(assetStore.useAssetStore.getState().assets).toEqual([]);
});
