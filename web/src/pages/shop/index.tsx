import { lazy, Suspense, useEffect, useLayoutEffect, useState, type ComponentType } from "react";
import { Navigate, useLocation } from "react-router";

import { WorkspaceRouteLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";
import "@/components/mode/mode-shell.css";
import "./shop.css";
import { preloadShopPage, SHOP_PAGE_LOADERS, shopPageKey, type ShopPageKey } from "./shop-preload";

const pages = Object.fromEntries(Object.entries(SHOP_PAGE_LOADERS).map(([key, load]) => [key, lazy(load)])) as unknown as Record<ShopPageKey, ComponentType>;

/**
 * 电商模式：/shop 下各页面按第二段地址切换。
 * 路由跳转在 React 过渡里进行：新页面代码没下载完时旧页面会停在原地，看起来像「点了没反应」。
 * 这里把页面切换放到过渡之外——地址一变侧栏高亮立即更新，内容区马上出现加载动画；
 * 进入电商模式后还会在浏览器空闲时依次预下载其余页面。
 */
export default function ShopPage() {
    const { pathname } = useLocation();
    const scope = useUserStore((state) => state.user?.id);
    const target = shopPageKey(pathname);
    const [active, setActive] = useState<ShopPageKey>(target);
    useLayoutEffect(() => {
        setActive(target);
    }, [target]);
    useEffect(() => {
        let cancelled = false;
        const order = ["/shop/canvas", "/shop/image", "/shop/detail", "/shop/works", "/shop"];
        const idle = (callback: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(callback, { timeout: 4000 }) : globalThis.setTimeout(callback, 1200));
        const next = (index: number) => {
            if (cancelled || index >= order.length) return;
            idle(() => {
                if (cancelled) return;
                preloadShopPage(order[index]);
                next(index + 1);
            });
        };
        next(0);
        return () => {
            cancelled = true;
        };
    }, []);
    const Page = pages[active];
    if (!scope) return null;
    if (!Object.hasOwn(SHOP_PAGE_LOADERS, pathname.split("/")[2] || "home")) return <Navigate to="/shop" replace />;
    return (
        <div className="ms-stage-body h-full min-h-0 overflow-hidden">
            <Suspense fallback={<WorkspaceRouteLoader />}>
                <Page key={`${scope}:${active}`} />
            </Suspense>
        </div>
    );
}
