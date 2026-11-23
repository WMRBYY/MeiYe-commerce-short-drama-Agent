import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { avoidCanvasNodePanels, canvasOverlayBounds } from "@/lib/canvas/canvas-overlay-layout";

export function ShopNodeToolbar({ className, label, children }: { className: string; label: string; children: ReactNode }) {
    const anchor = useRef<HTMLSpanElement>(null),
        panel = useRef<HTMLDivElement>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        setHost(anchor.current?.closest("main") || null);
    }, []);
    useLayoutEffect(() => {
        const node = anchor.current?.closest<HTMLElement>("[data-node-id]"),
            el = panel.current;
        if (!host || !node || !el) return;
        const place = () => {
            const rect = node.getBoundingClientRect();
            const topbar = host.querySelector(".sp-canvas-topbar")?.getBoundingClientRect();
            const dock = host.querySelector(".commerce-canvas-toolbar")?.getBoundingClientRect();
            const rail = host.querySelector(".sp-canvas-rail")?.getBoundingClientRect();
            const bounds = canvasOverlayBounds(
                { width: window.innerWidth, height: window.innerHeight },
                { left: window.innerWidth < 700 ? 12 : (rail?.right || 80) + 12, top: (topbar?.bottom || 90) + 12, right: window.innerWidth - 12, bottom: (dock?.top || window.innerHeight - 65) - 12 },
            );
            el.style.maxWidth = `${bounds.right - bounds.left}px`;
            const size = { width: el.offsetWidth, height: el.offsetHeight };
            const clamped = { left: Math.min(bounds.right - size.width / 2, Math.max(bounds.left + size.width / 2, rect.x + rect.width / 2)), top: Math.min(bounds.bottom, Math.max(bounds.top + size.height, rect.top - 34)) };
            const panels = Array.from(host.querySelectorAll(".sp-canvas-floating-composer")).map((n) => n.getBoundingClientRect());
            const position = avoidCanvasNodePanels(clamped, size, bounds, panels);
            el.style.left = `${Math.max(bounds.left, Math.min(bounds.right - size.width, position.left - size.width / 2))}px`;
            el.style.top = `${Math.max(bounds.top, Math.min(bounds.bottom - size.height, position.top - size.height))}px`;
        };
        const resize = new ResizeObserver(place);
        resize.observe(el);
        resize.observe(node);
        const observer = new MutationObserver(place);
        observer.observe(node, { attributes: true, attributeFilter: ["style"] });
        const world = host.querySelector("[data-canvas-world-layer]");
        if (world) observer.observe(world, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", place);
        place();
        return () => {
            resize.disconnect();
            observer.disconnect();
            window.removeEventListener("resize", place);
        };
    }, [host]);
    return (
        <>
            <span ref={anchor} hidden />
            {host
                ? createPortal(
                      <div ref={panel} className={`${className} sp-node-toolbar-floating`} role="toolbar" aria-label={label} data-canvas-no-zoom onPointerDown={(e) => e.stopPropagation()}>
                          {children}
                      </div>,
                      host,
                  )
                : null}
        </>
    );
}
