import { expect, test } from "bun:test";
import { placeShopCanvasComposer, resizeShopImage, SHOP_IMAGE_RESIZE_HANDLES } from "../src/pages/shop/shop-canvas-geometry";

test("all image handles retain aspect ratio and their opposite anchor", () => {
    const box = { x: 180, y: 90, width: 240, height: 360 };
    for (const handle of SHOP_IMAGE_RESIZE_HANDLES) {
        const next = resizeShopImage(box, handle, 80, 100);
        expect(next.width / next.height).toBeCloseTo(2 / 3, 8);
        if (handle.includes("w")) expect(next.x + next.width).toBeCloseTo(box.x + box.width);
        else if (handle.includes("e")) expect(next.x).toBe(box.x);
        else expect(next.x + next.width / 2).toBeCloseTo(box.x + box.width / 2);
        if (handle.includes("n")) expect(next.y + next.height).toBeCloseTo(box.y + box.height);
        else if (handle.includes("s")) expect(next.y).toBe(box.y);
        else expect(next.y + next.height / 2).toBeCloseTo(box.y + box.height / 2);
    }
});

test("image resizing never flips at the minimum or grows beyond the limit", () => {
    const box = { x: 0, y: 0, width: 200, height: 400 };
    expect(resizeShopImage(box, "se", -500, -1000)).toMatchObject({ width: 64, height: 128 });
    expect(resizeShopImage(box, "se", 100000, 100000)).toMatchObject({ width: 2048, height: 4096 });
});

test("opening a large composer reframes canvas and keeps exact center below the node", () => {
    const node = { x: 980, y: 470, width: 240, height: 240 };
    const panel = { width: 880, height: 300 };
    const bounds = { left: 100, top: 100, right: 1380, bottom: 800 };
    const placed = placeShopCanvasComposer(node, panel, bounds, true);
    expect(placed.left + panel.width / 2).toBe(node.x + placed.dx + node.width / 2);
    expect(placed.top).toBe(node.y + placed.dy + node.height + 16);
    expect(placed.left + panel.width).toBeLessThanOrEqual(bounds.right);
    expect(placed.top + panel.height).toBeLessThanOrEqual(bounds.bottom);
    const followed = placeShopCanvasComposer({ ...node, x: node.x + placed.dx, y: node.y + placed.dy }, panel, bounds, false);
    expect(followed.left).toBe(placed.left);
    expect(followed.top).toBe(placed.top);
    expect(followed.dx).toBe(0);
    expect(followed.dy).toBe(0);
});
