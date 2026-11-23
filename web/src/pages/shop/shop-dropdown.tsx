import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Place = { left: number; top?: number; bottom?: number; maxHeight: number; up: boolean; origin: string };

/**
 * 输入框底部工具条的下拉：按钮 + 浮层面板。
 * 面板挂到 body 上用固定定位，不会被下面的卡片、页面滚动容器或变换过的父级挡住；
 * 优先按 placement 方向弹出，空间不够时自动翻到另一侧，并限制最大高度。
 */
export function ShopDropdown({
    label,
    icon,
    tone,
    placement = "bottom",
    align = "start",
    width,
    title,
    className,
    ariaLabel,
    disabled,
    children,
}: {
    label: ReactNode;
    icon?: ReactNode;
    tone?: "accent" | "danger";
    placement?: "top" | "bottom";
    align?: "start" | "end";
    width?: number;
    title?: string;
    className?: string;
    ariaLabel?: string;
    disabled?: boolean;
    children: (close: () => void) => ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<Place | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const triggerButton = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    const reduced = useReducedMotion();

    const measure = useCallback(() => {
        const trigger = root.current?.getBoundingClientRect();
        if (!trigger) return;
        const gap = 8;
        const panelWidth = Math.min(width || panel.current?.offsetWidth || 220, Math.max(0, window.innerWidth - 24));
        const above = trigger.top - gap - 12;
        const below = window.innerHeight - trigger.bottom - gap - 12;
        const wanted = Math.min(panel.current?.scrollHeight || 360, 520);
        const up = placement === "top" ? above >= Math.min(wanted, 240) || above > below : below < Math.min(wanted, 240) && above > below;
        let left = align === "end" ? trigger.right - panelWidth : trigger.left;
        left = Math.max(12, Math.min(window.innerWidth - panelWidth - 12, left));
        setPlace(
            up
                ? { left, bottom: window.innerHeight - trigger.top + gap, maxHeight: Math.max(0, above), up, origin: align === "end" ? "bottom right" : "bottom left" }
                : { left, top: trigger.bottom + gap, maxHeight: Math.max(0, below), up, origin: align === "end" ? "top right" : "top left" },
        );
    }, [align, placement, width]);

    useLayoutEffect(() => {
        if (!open) return;
        measure();
        // 面板内容渲染后再量一次真实高度。
        const frame = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(frame);
    }, [measure, open]);

    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            const target = event.target as Node;
            if (root.current?.contains(target) || panel.current?.contains(target)) return;
            // 面板里再弹出的浮层（例如 antd 下拉）挂在 body 上，点它们不算点外面。
            if ((target as Element).closest?.(".ant-select-dropdown, .ant-popover, .ant-dropdown")) return;
            setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            setOpen(false);
            triggerButton.current?.focus();
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [measure, open]);

    const offset = place?.up ? 8 : -8;
    const style: CSSProperties = {
        width,
        maxWidth: "calc(100vw - 24px)",
        left: place?.left ?? -9999,
        top: place?.top,
        bottom: place?.bottom,
        maxHeight: place?.maxHeight,
        transformOrigin: place?.origin,
        visibility: place ? undefined : "hidden",
    };
    return (
        <div ref={root} className={`sp-dd ${className || ""}`} data-placement={placement} data-align={align}>
            <button ref={triggerButton} type="button" className="sp-chip" data-tone={tone} data-open={open || undefined} title={title} aria-label={ariaLabel} disabled={disabled} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}>
                {icon}
                <span className="sp-chip-label">{label}</span>
                <ChevronDown className="sp-chip-caret size-3.5" strokeWidth={2} />
            </button>
            {createPortal(
                <AnimatePresence>
                    {open ? (
                        <motion.div
                            ref={panel}
                            id={panelId}
                            className="sp-dd-panel sp-dd-float ms-scope"
                            data-canvas-no-zoom
                            data-canvas-wheel-scroll
                            data-up={place?.up || undefined}
                            style={style}
                            initial={reduced ? false : { opacity: 0, y: offset, scale: 0.97, filter: "blur(2px)" }}
                            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                            exit={reduced ? { opacity: 0 } : { opacity: 0, y: offset / 2, scale: 0.98 }}
                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {children(() => setOpen(false))}
                        </motion.div>
                    ) : null}
                </AnimatePresence>,
                document.body,
            )}
        </div>
    );
}
