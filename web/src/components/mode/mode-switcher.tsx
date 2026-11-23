import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { useWorkspaceModeStore, WORKSPACE_MODE_HOME, type WorkspaceMode } from "@/stores/use-workspace-mode-store";
import { useUserStore } from "@/stores/use-user-store";
import "./mode-shell.css";

export const MODE_OPTIONS: Array<{ id: WorkspaceMode; title: string; description: string }> = [
    { id: "create", title: "创作模式", description: "对话生成、画布、技能，全能创作" },
    { id: "ecommerce", title: "电商模式", description: "换装、详情图、商品视频一站完成" },
    { id: "drama", title: "短剧模式", description: "剧本、分镜、角色到成片" },
];

export function ModeGlyph({ mode, className }: { mode: WorkspaceMode; className?: string }) {
    const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true };
    if (mode === "ecommerce")
        return (
            <svg {...common}>
                <path d="M5 8h14l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3z" />
                <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
                <path d="M9.5 13.5c.8 1.2 1.6 1.8 2.5 1.8s1.7-.6 2.5-1.8" />
            </svg>
        );
    if (mode === "drama")
        return (
            <svg {...common}>
                <rect x="3" y="7" width="18" height="13" rx="2" />
                <path d="m3.5 7 3-4M10 7l3-4M16.5 7l3-4" />
                <path d="m10.5 11.2 4 2.3-4 2.3z" fill="currentColor" fillOpacity={0.25} />
            </svg>
        );
    return (
        <svg {...common}>
            <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9z" />
            <path d="M19 3v3M17.5 4.5h3" />
        </svg>
    );
}

/** 品牌区下拉：在创作 / 电商 / 短剧三个模式之间切换，切换后进入该模式的首页。 */
export function ModeSwitcher({ trigger, align = "left", compact = false }: { trigger: (open: boolean) => ReactNode; align?: "left" | "rail"; compact?: boolean }) {
    const mode = useWorkspaceModeStore((state) => state.mode);
    const setMode = useWorkspaceModeStore((state) => state.setMode);
    const features = useUserStore((state) => state.features);
    const navigate = useNavigate();
    const reduced = useReducedMotion();
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const options = MODE_OPTIONS.filter((item) => (item.id === "ecommerce" ? features.ecommerceEnabled !== false : item.id === "drama" ? features.shortDramaEnabled !== false : true));

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

    const pick = (next: WorkspaceMode) => {
        setOpen(false);
        setMode(next);
        navigate(WORKSPACE_MODE_HOME[next]);
    };

    return (
        <div ref={root} className={`ms-switcher${compact ? " is-compact" : ""}`} data-align={align}>
            <div role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={open} className="ms-switcher-trigger" onClick={() => setOpen((value) => !value)} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), setOpen((value) => !value))}>
                {trigger(open)}
            </div>
            <AnimatePresence>
                {open ? (
                    <motion.div
                        role="menu"
                        className="ms-switcher-menu"
                        initial={reduced ? false : { opacity: 0, y: -6, scale: 0.97, filter: "blur(3px)" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98, filter: "blur(2px)" }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className="ms-switcher-menu-title">切换工作模式</div>
                        {options.map((item, index) => {
                            const active = item.id === mode;
                            return (
                                <motion.button
                                    key={item.id}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={active}
                                    className={`ms-switcher-item${active ? " is-active" : ""}`}
                                    data-mode={item.id}
                                    onClick={() => pick(item.id)}
                                    initial={reduced ? false : { opacity: 0, x: -6 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.03 * index, duration: 0.22 }}
                                >
                                    <span className="ms-switcher-item-icon">
                                        <ModeGlyph mode={item.id} className="size-4.5" />
                                    </span>
                                    <span className="ms-switcher-item-text">
                                        <strong>{item.title}</strong>
                                        <small>{item.description}</small>
                                    </span>
                                    {active ? <Check className="ms-switcher-item-check size-4" strokeWidth={2.2} /> : null}
                                </motion.button>
                            );
                        })}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

export function ModeChevron({ open }: { open: boolean }) {
    return <ChevronDown className="ms-switcher-chevron size-3.5" data-open={open || undefined} strokeWidth={2} />;
}

export function modeTitle(mode: WorkspaceMode) {
    return MODE_OPTIONS.find((item) => item.id === mode)?.title || "创作模式";
}
