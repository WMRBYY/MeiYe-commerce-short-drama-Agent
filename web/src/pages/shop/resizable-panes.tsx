import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import "./resizable-panes.css";

type Limits = { min: number; max: number };

function readWidths(key: string, fallback: { left: number; right: number }) {
    try {
        const raw = window.localStorage.getItem(`meiye.panes.${key}`);
        const parsed = raw ? (JSON.parse(raw) as { left?: unknown; right?: unknown }) : {};
        return { left: typeof parsed.left === "number" && Number.isFinite(parsed.left) ? parsed.left : fallback.left, right: typeof parsed.right === "number" && Number.isFinite(parsed.right) ? parsed.right : fallback.right };
    } catch {
        return fallback;
    }
}

const clamp = (value: number, limits: Limits) => Math.round(Math.min(limits.max, Math.max(limits.min, value)));

/**
 * 三栏布局：左、右两栏可拖动分隔条改宽度（有上下限，中间栏至少保留 centerMin），双击分隔条恢复默认。
 * 宽度按 storageKey 记在本机，换页面回来保持。窄屏（≤1024px）由各页面 CSS 改成上下排列，分隔条隐藏。
 */
export function ResizablePanes({
    storageKey,
    className,
    left,
    center,
    right,
    defaults,
    leftLimits: { min: leftMin, max: leftMax } = { min: 200, max: 420 },
    rightLimits: { min: rightMin, max: rightMax } = { min: 260, max: 620 },
    centerMin = 520,
}: {
    storageKey: string;
    className: string;
    left: ReactNode;
    center: ReactNode;
    right: ReactNode;
    defaults: { left: number; right: number };
    leftLimits?: Limits;
    rightLimits?: Limits;
    centerMin?: number;
}) {
    const root = useRef<HTMLDivElement>(null);
    const [widths, setWidths] = useState(() => {
        const saved = readWidths(storageKey, defaults);
        return { left: clamp(saved.left, { min: leftMin, max: leftMax }), right: clamp(saved.right, { min: rightMin, max: rightMax }) };
    });
    const [dragging, setDragging] = useState<"left" | "right" | null>(null);

    useEffect(() => {
        try {
            window.localStorage.setItem(`meiye.panes.${storageKey}`, JSON.stringify(widths));
        } catch {
            /* 不能保存时只影响下次打开的默认宽度 */
        }
    }, [storageKey, widths]);

    // 窗口变窄时先压缩两侧，保证中间栏不被挤没。
    const fit = useCallback(
        (next: { left: number; right: number }) => {
            const total = root.current?.clientWidth || window.innerWidth;
            const room = Math.max(0, total - centerMin - 12);
            let l = clamp(next.left, { min: leftMin, max: leftMax });
            let r = clamp(next.right, { min: rightMin, max: rightMax });
            if (l + r > room) {
                const over = l + r - room;
                const shrinkRight = Math.min(over, r - rightMin);
                r -= shrinkRight;
                l -= Math.min(over - shrinkRight, l - leftMin);
            }
            return { left: l, right: r };
        },
        [centerMin, leftMin, leftMax, rightMin, rightMax],
    );
    useEffect(() => {
        const onResize = () => {
            // 上下排列时保留桌面宽度，避免切到手机尺寸后覆盖用户的拖拽设置。
            if (window.innerWidth <= 1024) return;
            setWidths((current) => {
                const next = fit(current);
                return next.left === current.left && next.right === current.right ? current : next;
            });
        };
        onResize();
        const observer = new ResizeObserver(onResize);
        if (root.current) observer.observe(root.current);
        window.addEventListener("resize", onResize);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", onResize);
        };
    }, [fit]);

    const start = (side: "left" | "right") => (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const origin = widths;
        setDragging(side);
        const move = (e: PointerEvent) => {
            const delta = e.clientX - startX;
            setWidths(fit(side === "left" ? { ...origin, left: origin.left + delta } : { ...origin, right: origin.right - delta }));
        };
        const up = () => {
            setDragging(null);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            document.body.style.removeProperty("cursor");
            document.body.style.removeProperty("user-select");
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const reset = (side: "left" | "right") => () => setWidths((current) => fit({ ...current, [side]: defaults[side] }));
    const keyboard = (side: "left" | "right") => (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = (event.shiftKey ? 40 : 12) * (event.key === "ArrowLeft" ? -1 : 1);
        setWidths((current) => fit(side === "left" ? { ...current, left: current.left + step } : { ...current, right: current.right - step }));
    };

    return (
        <div ref={root} className={`rp-panes ${className}`} data-dragging={dragging || undefined} style={{ "--rp-left": `${widths.left}px`, "--rp-right": `${widths.right}px` } as CSSProperties}>
            {left}
            <div
                className="rp-handle is-left"
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整左栏宽度"
                tabIndex={0}
                data-active={dragging === "left" || undefined}
                onPointerDown={start("left")}
                onDoubleClick={reset("left")}
                onKeyDown={keyboard("left")}
            >
                <i />
            </div>
            {center}
            <div
                className="rp-handle is-right"
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整右栏宽度"
                tabIndex={0}
                data-active={dragging === "right" || undefined}
                onPointerDown={start("right")}
                onDoubleClick={reset("right")}
                onKeyDown={keyboard("right")}
            >
                <i />
            </div>
            {right}
        </div>
    );
}
