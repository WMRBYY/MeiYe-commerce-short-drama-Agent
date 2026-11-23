import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Infinity as InfinityIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { ModeSwitcher, modeTitle } from "@/components/mode/mode-switcher";
import { RailIcon, type RailIconName } from "@/components/mode/mode-icons";
import { CommerceRailIcon } from "@/components/mode/commerce-rail-icon";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { preloadShopPage } from "@/pages/shop/shop-preload";
import { useUserStore } from "@/stores/use-user-store";
import { WorkspaceSidebarCheckin } from "@/components/layout/workspace-sidebar-checkin";
import { WorkspaceSidebarConversations } from "@/components/layout/workspace-sidebar-conversations";
import type { WorkspaceMode } from "@/stores/use-workspace-mode-store";
import "./mode-shell.css";

type FlyoutKind = "chat";
type RailItem = { id: string; label: string; icon: RailIconName; to: string; badge?: string; match?: (pathname: string) => boolean; flyout?: FlyoutKind };

function railItems(mode: WorkspaceMode, features: ReturnType<typeof useUserStore.getState>["features"]): RailItem[] {
    if (mode === "create")
        return [
            { id: "home", label: "首页", icon: "home", to: "/", match: (p) => p === "/" || p === "/create" },
            { id: "chat", label: "对话", icon: "chat", to: "/?history=conversations", match: () => false, flyout: "chat" },
            ...(features.shortDramaEnabled ? [{ id: "studio", label: "短剧", icon: "drama" as const, to: "/projects", badge: "New" }] : []),
            { id: "canvas", label: "画布", icon: "canvas", to: "/canvas" },
            ...(features.ecommerceEnabled ? [{ id: "ecommerce", label: "电商", icon: "shop" as const, to: "/ecommerce" }] : []),
            ...(features.imageWorkbenchEnabled ? [{ id: "image", label: "生图", icon: "image" as const, to: "/toolbox/image" }] : []),
            ...(features.videoWorkbenchEnabled ? [{ id: "video", label: "视频", icon: "video" as const, to: "/toolbox/video" }] : []),
            { id: "skills", label: "技能", icon: "skills", to: "/skills" },
            ...(features.pluginCenterEnabled ? [{ id: "plugins", label: "插件", icon: "plugins" as const, to: "/plugins" }] : []),
            { id: "assets", label: "资产", icon: "assets", to: "/assets" },
            ...(features.taskCenterEnabled ? [{ id: "tasks", label: "作品", icon: "folder" as const, to: "/tasks" }] : []),
        ];
    if (mode === "ecommerce")
        return [
            { id: "home", label: "首页", icon: "home", to: "/shop", match: (p) => p === "/shop" },
            { id: "image", label: "生图", icon: "spark", to: "/shop/image" },
            { id: "templates", label: "模板", icon: "batch", to: "/shop/templates" },
            { id: "detail", label: "详情图", icon: "detail", to: "/shop/detail", match: (p) => p.startsWith("/shop/detail") || p === "/ecommerce" },
            { id: "canvas", label: "画布", icon: "canvas", to: "/shop/canvas" },
            { id: "works", label: "作品", icon: "folder", to: "/shop/works" },
        ];
    return [
        { id: "home", label: "首页", icon: "home", to: "/drama", match: (p) => p === "/drama" },
        ...(features.shortDramaEnabled ? [{ id: "studio", label: "短剧", icon: "drama" as const, to: "/projects", badge: "New" }] : []),
        { id: "canvas", label: "画布", icon: "canvas", to: "/canvas" },
        { id: "skills", label: "技能", icon: "skills", to: "/skills" },
        { id: "assets", label: "资产", icon: "assets", to: "/assets" },
        ...(features.taskCenterEnabled ? [{ id: "tasks", label: "作品", icon: "folder" as const, to: "/tasks" }] : []),
    ];
}

function isActive(item: RailItem, pathname: string) {
    if (item.match) return item.match(pathname);
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** 对话悬浮面板：创作首页的历史对话，置顶、重命名、删除都在面板里完成。 */
function ChatFlyout({ anchor, onEnter, onLeave, onDone }: { anchor: DOMRect; onEnter: () => void; onLeave: () => void; onDone: () => void }) {
    const reduced = useReducedMotion();
    const top = Math.max(12, Math.min(anchor.top - 40, window.innerHeight - 520));
    return createPortal(
        <motion.div
            className="ms-flyout ms-chat-flyout ms-scope"
            style={{ top, left: anchor.right + 8 }}
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
            initial={reduced ? false : { opacity: 0, x: -8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
            <WorkspaceSidebarConversations collapsed={false} onNavigate={onDone} />
        </motion.div>,
        document.body,
    );
}

const MODE_SHORT: Record<WorkspaceMode, string> = { create: "创作", ecommerce: "电商", drama: "短剧" };

export function ModeRail({ mode, mobileOpen, onNavigate }: { mode: WorkspaceMode; mobileOpen: boolean; onNavigate: () => void }) {
    const { pathname } = useLocation();
    const features = useUserStore((state) => state.features);
    const reduced = useReducedMotion();
    const items = useMemo(() => railItems(mode, features), [mode, features]);
    const [flyout, setFlyout] = useState<{ kind: FlyoutKind; rect: DOMRect } | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const open = (kind: FlyoutKind, rect: DOMRect) => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setFlyout({ kind, rect }), 120);
    };
    const keep = () => window.clearTimeout(timer.current);
    const close = () => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setFlyout(null), 160);
    };
    useEffect(() => () => window.clearTimeout(timer.current), []);
    // 进入某个模式后，在浏览器空闲时把这个模式导航里各页面的代码依次预下载好，点下去不用再等。
    useEffect(() => {
        let cancelled = false;
        const targets = items.map((item) => item.to);
        const idle = (callback: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(callback, { timeout: 3000 }) : globalThis.setTimeout(callback, 800));
        const next = (index: number) => {
            if (cancelled || index >= targets.length) return;
            idle(() => {
                if (cancelled) return;
                preloadWorkspaceRoute(targets[index]);
                preloadShopPage(targets[index]);
                next(index + 1);
            });
        };
        next(0);
        return () => {
            cancelled = true;
        };
    }, [items]);
    useEffect(() => setFlyout(null), [pathname]);

    return (
        <aside className="ms-rail ms-scope" data-mode={mode} data-mobile-open={mobileOpen || undefined} aria-label={`${modeTitle(mode)}导航`}>
            <ModeSwitcher
                align="rail"
                trigger={(isOpen) => (
                    <span className="ms-rail-brand" data-open={isOpen || undefined} title="切换工作模式">
                        <BrandLogoFrame className="ms-rail-logo" logoClassName="size-5 object-contain" alt="" fallback={<InfinityIcon className="size-4" strokeWidth={2.2} />} />
                        <span className="ms-rail-mode">{MODE_SHORT[mode]}</span>
                    </span>
                )}
            />
            <LayoutGroup id={`ms-rail-${mode}`}>
                <nav className="ms-rail-nav">
                    {items.map((item) => {
                        const active = isActive(item, pathname);
                        return (
                            <Link
                                key={item.id}
                                to={item.to}
                                className="ms-rail-item"
                                data-active={active || undefined}
                                aria-current={active ? "page" : undefined}
                                onClick={onNavigate}
                                onPointerEnter={(event) => {
                                    preloadWorkspaceRoute(item.to);
                                    preloadShopPage(item.to);
                                    if (item.flyout) open(item.flyout, event.currentTarget.getBoundingClientRect());
                                }}
                                onPointerLeave={() => item.flyout && close()}
                            >
                                {active ? <motion.span layoutId="ms-rail-active" className="ms-rail-active" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }} /> : null}
                                {item.badge ? (
                                    <span className="ms-rail-badge" data-kind={item.badge}>
                                        {item.badge}
                                    </span>
                                ) : null}
                                <span className="ms-rail-icon">{mode === "ecommerce" ? <CommerceRailIcon name={item.icon} /> : <RailIcon name={item.icon} className="size-5" />}</span>
                                <span className="ms-rail-label">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>
            </LayoutGroup>
            {mode === "create" ? (
                <div className="ms-rail-foot">
                    <WorkspaceSidebarCheckin collapsed />
                </div>
            ) : null}
            <AnimatePresence>
                {flyout?.kind === "chat" ? (
                    <ChatFlyout
                        key="chat"
                        anchor={flyout.rect}
                        onEnter={keep}
                        onLeave={close}
                        onDone={() => {
                            setFlyout(null);
                            onNavigate();
                        }}
                    />
                ) : null}
            </AnimatePresence>
        </aside>
    );
}
