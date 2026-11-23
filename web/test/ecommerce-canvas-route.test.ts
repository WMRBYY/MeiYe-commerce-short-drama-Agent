import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const router = readFileSync(new URL("../src/router.tsx", import.meta.url), "utf8");

describe("ecommerce canvas route isolation", () => {
    test("loads the ecommerce canvas lazily behind the authenticated workspace guard", () => {
        expect(router).toContain('const ShopCanvasPage = lazy(() => import("@/pages/shop/shop-canvas"));');
        expect(router).toContain('{ path: "/shop/canvas", element: <RequireAuth>{deferred(<ShopCanvasHomePage />)}</RequireAuth> },');
        expect(router).toContain('{ path: "/shop/canvas/:projectId", element: <RequireAuth>{deferred(<ShopCanvasPage />)}</RequireAuth> },');
    });

    test("keeps the exact ecommerce canvas route ahead of the legacy shop wildcard", () => {
        const ecommerceCanvas = router.indexOf('{ path: "/shop/canvas",');
        const shopWildcard = router.indexOf('{ path: "/shop/*",');

        expect(ecommerceCanvas).toBeGreaterThan(-1);
        expect(shopWildcard).toBeGreaterThan(-1);
        expect(ecommerceCanvas).toBeLessThan(shopWildcard);
        expect(router).toContain('{ path: "/shop", element: <RequireAuth>{deferred(<ShopPage />)}</RequireAuth> },');
    });

    test("does not replace the creative canvas route", () => {
        expect(router).toContain('{ path: "/canvas", element: <RequireAuth>{deferred(<CanvasPage />)}</RequireAuth> },');
        expect(router).toContain('path: "/canvas/:id"');
        expect(router).not.toContain('path: "/canvas", element: <RequireAuth>{deferred(<ShopCanvasPage />)}</RequireAuth>');
    });

    test("keeps admin on the shared creative administration shell", () => {
        expect(router).toContain('path: "/drama"');
        expect(router).toContain('path: "/drama/*"');
        expect(router).toContain('path: "/admin"');
        expect(router).toContain("element: <RequireAuth>{deferred(<AdminPage />)}</RequireAuth>");
        expect(router).toContain('{ path: "channels", element: <ChannelsPage /> }');
        expect(router).not.toContain('path: "ecommerce-suite"');
        expect(router).not.toContain("EcommerceAdminShell");
        expect(router).not.toContain("EcommerceModelLabelsPage");
    });
});
