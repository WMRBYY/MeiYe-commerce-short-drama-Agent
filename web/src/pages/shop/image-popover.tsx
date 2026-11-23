// Copyright (c) 2026 meiyeai. MIT licensed.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function ImagePopover({
    trigger,
    children,
    placement = "top",
    align = "start",
    className,
}: {
    trigger: (open: boolean, toggle: () => void) => ReactNode;
    children: (close: () => void) => ReactNode;
    placement?: "top" | "bottom";
    align?: "start" | "end" | "center";
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    }, [open]);
    const offset = placement === "top" ? 10 : -10;
    return (
        <div ref={root} className={`ss-pop ${className || ""}`} data-placement={placement} data-align={align}>
            {trigger(open, () => setOpen((value) => !value))}
            <AnimatePresence>
                {open ? (
                    <motion.div
                        className="ss-pop-panel"
                        initial={reduced ? false : { opacity: 0, y: offset, scale: 0.97, filter: "blur(3px)" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: offset / 2, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {children(() => setOpen(false))}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
