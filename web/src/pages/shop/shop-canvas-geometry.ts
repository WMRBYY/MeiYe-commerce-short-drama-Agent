import type { CanvasOverlayBounds } from "@/lib/canvas/canvas-overlay-layout";

export const SHOP_IMAGE_RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ShopImageResizeHandle = (typeof SHOP_IMAGE_RESIZE_HANDLES)[number];

/** Resize in world coordinates; the opposite corner or edge midpoint stays fixed. */
export function resizeShopImage(box: { x: number; y: number; width: number; height: number }, handle: ShopImageResizeHandle, dx: number, dy: number) {
    const horizontal = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
    const vertical = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
    const delta = horizontal && vertical ? (dx * horizontal * box.width + dy * vertical * box.height) / (box.width ** 2 + box.height ** 2) : horizontal ? (dx * horizontal) / box.width : (dy * vertical) / box.height;
    const scale = Math.max(64 / Math.min(box.width, box.height), Math.min(4096 / Math.max(box.width, box.height), 1 + delta));
    const width = box.width * scale;
    const height = box.height * scale;
    return { x: box.x + (box.width - width) * (horizontal < 0 ? 1 : horizontal === 0 ? 0.5 : 0), y: box.y + (box.height - height) * (vertical < 0 ? 1 : vertical === 0 ? 0.5 : 0), width, height };
}

/** Keep the panel below its node; reveal moves the canvas instead of detaching the panel. */
export function placeShopCanvasComposer(node: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, bounds: CanvasOverlayBounds, reveal: boolean) {
    const left = node.x + (node.width - size.width) / 2;
    const top = node.y + node.height + 16;
    const dx = reveal ? Math.max(bounds.left, Math.min(left, bounds.right - size.width)) - left : 0;
    const dy = reveal ? Math.max(bounds.top, Math.min(top, bounds.bottom - size.height)) - top : 0;
    return { left: left + dx, top: top + dy, dx, dy };
}
