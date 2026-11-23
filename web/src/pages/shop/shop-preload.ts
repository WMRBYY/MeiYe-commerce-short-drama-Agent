/** 电商模式各页面的代码入口。单独成一个小模块：侧栏悬停预下载时只引入这里，不把页面本身打进外壳。 */
export const SHOP_PAGE_LOADERS = {
    home: () => import("./shop-home"),
    canvas: () => import("./shop-canvas"),
    image: () => import("./shop-image"),
    templates: () => import("./shop-templates"),
    detail: () => import("./shop-detail"),
    batch: () => import("./shop-batch"),
    works: () => import("./shop-works"),
    covers: () => import("./shop-covers-studio"),
};
export type ShopPageKey = keyof typeof SHOP_PAGE_LOADERS;

export function shopPageKey(pathname: string): ShopPageKey {
    const key = pathname.split("/")[2] || "home";
    return Object.hasOwn(SHOP_PAGE_LOADERS, key) ? (key as ShopPageKey) : "home";
}

const warmed = new Set<ShopPageKey>();

/** 预先下载某个电商页面的代码：导航悬停时调用，点下去就不用再等下载。 */
export function preloadShopPage(pathname: string) {
    if (!pathname.startsWith("/shop")) return;
    const key = shopPageKey(pathname);
    if (warmed.has(key)) return;
    warmed.add(key);
    void SHOP_PAGE_LOADERS[key]().catch(() => warmed.delete(key));
}
