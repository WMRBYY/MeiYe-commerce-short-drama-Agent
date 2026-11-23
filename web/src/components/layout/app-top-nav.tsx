import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { BannerAnnouncementsSlider } from "@/components/layout/banner-announcements-slider";
import { ModelSetupGuide } from "@/components/layout/model-setup-guide";
import { WorkspaceSidebarNav } from "@/components/layout/workspace-sidebar-nav";
import { readWorkspaceSidebarCollapsed, writeWorkspaceSidebarCollapsed } from "@/components/layout/workspace-sidebar-state";
import { WorkspaceTopBar } from "@/components/layout/workspace-top-bar";
import { WorkspaceTopBarExtensionProvider } from "@/components/layout/workspace-top-bar-extension";
import { WorkspaceStorageLimitNotice } from "@/components/layout/workspace-storage-limit-notice";
import { WorkspaceWalletHost } from "@/components/layout/workspace-wallet-modal";
import { GenerationSuccessNotifier } from "@/components/layout/generation-success-notifier";
import { useWorkspaceDocumentTitle } from "@/hooks/use-workspace-document-title";
import { cn } from "@/lib/utils";
import { ModeRail } from "@/components/mode/mode-rail";
import { modeFromPath, useWorkspaceModeStore } from "@/stores/use-workspace-mode-store";
import { isSpatialWorkbenchPath, workspacePagePath } from "@/lib/workspace-routes";
import { DetailRunners } from "@/pages/shop/detail-runner";
import { useUserStore } from "@/stores/use-user-store";

const WorkspaceCommandPalette = lazy(() => import("@/components/layout/workspace-command-palette").then((module) => ({ default: module.WorkspaceCommandPalette })));

export function AppWorkspaceShell({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
    const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(readWorkspaceSidebarCollapsed);
    const [paletteOpen, setPaletteOpen] = useState(false);
    useWorkspaceDocumentTitle();
    // 电商模式详情图在后台跑的电商 Agent 挂在外壳上：离开详情图、切到别的页面也会把这一轮出完。
    const userScope = useUserStore((state) => state.user?.id);

    const pagePath = workspacePagePath(pathname);
    const hideChrome = pathname.startsWith("/admin") || /^\/(?:shop\/)?canvas\/[^/]+/.test(pagePath);
    const showGlobalTopBar = !hideChrome;
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const creationWorkspace = pagePath === "/" || pagePath === "/create";
    // 工作模式：地址属于某个模式时以地址为准并记住；画布、资产等共用页面沿用当前模式的侧栏。
    const storedMode = useWorkspaceModeStore((state) => state.mode);
    const setMode = useWorkspaceModeStore((state) => state.setMode);
    const pathMode = modeFromPath(pathname);
    const mode = pathMode || storedMode;
    useEffect(() => {
        if (pathMode) setMode(pathMode);
    }, [pathMode, setMode]);
    // 三个模式都用窄图标栏；创作模式额外带对话悬浮面板与每日签到。
    const teamWorkspace = pathname.startsWith("/teams/");
    const modeShell = !hideChrome && !teamWorkspace;

    const isMobileViewport = () => window.innerWidth < 1024;

    const toggleSidebar = () => {
        if (isMobileViewport()) {
            setMobileSidebarExpanded((current) => !current);
            return;
        }
        setDesktopSidebarCollapsed((current) => {
            const next = !current;
            writeWorkspaceSidebarCollapsed(next);
            return next;
        });
    };

    const expandDesktopSidebar = () => {
        setDesktopSidebarCollapsed(false);
        writeWorkspaceSidebarCollapsed(false);
    };

    const collapseDesktopSidebar = () => {
        setDesktopSidebarCollapsed(true);
        writeWorkspaceSidebarCollapsed(true);
    };

    const handleNavClick = () => {
        if (isMobileViewport()) setMobileSidebarExpanded(false);
    };

    // ⌘K / Ctrl+K 全局呼出搜索面板。
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (teamWorkspace) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setPaletteOpen((open) => !open);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [teamWorkspace]);

    useEffect(() => {
        const handleWorkspaceNavigation = (rawEvent: Event) => {
            const event = rawEvent as CustomEvent<{ to?: string }>;
            if (!event.detail?.to) return;
            event.preventDefault();
            navigate(event.detail.to);
        };
        window.addEventListener("workspace:navigate", handleWorkspaceNavigation);
        return () => window.removeEventListener("workspace:navigate", handleWorkspaceNavigation);
    }, [navigate]);

    return (
        <>
            <WorkspaceTopBarExtensionProvider>
                <div className={cn("app-workspace-shell flex h-dvh min-h-0 w-full flex-col overflow-hidden", spatialWorkbench && "is-spatial", creationWorkspace && "is-creation-workspace", modeShell && "is-mode-shell ms-scope")}>
                    {!hideChrome && mobileSidebarExpanded ? <button type="button" className="app-workspace-sidebar-scrim lg:hidden" aria-label={t("shell.collapseSidebar")} onClick={() => setMobileSidebarExpanded(false)} /> : null}

                    {showGlobalTopBar ? <BannerAnnouncementsSlider /> : null}

                    <div className="app-workspace-main-row flex min-h-0 min-w-0 flex-1 overflow-hidden">
                        {modeShell ? (
                            <ModeRail mode={mode} mobileOpen={mobileSidebarExpanded} onNavigate={handleNavClick} />
                        ) : !hideChrome ? (
                            <aside className={cn("app-workspace-sidebar flex h-full shrink-0 flex-col overflow-hidden", mobileSidebarExpanded && "is-mobile-expanded", desktopSidebarCollapsed && "is-collapsed")}>
                                <WorkspaceSidebarNav collapsed={desktopSidebarCollapsed} onNavigate={handleNavClick} onOpenSearch={() => setPaletteOpen(true)} onExpand={expandDesktopSidebar} onCollapse={collapseDesktopSidebar} />
                            </aside>
                        ) : null}

                        <div className="app-workspace-stage relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                            {showGlobalTopBar ? <WorkspaceTopBar sidebarOpen={isMobileViewport() ? mobileSidebarExpanded : !desktopSidebarCollapsed} onToggleSidebar={toggleSidebar} /> : null}
                            <div className={cn("relative min-h-0 min-w-0 flex-1 overflow-hidden", showGlobalTopBar && "workspace-route-content")}>{children}</div>
                        </div>
                    </div>

                    {paletteOpen && !teamWorkspace ? (
                        <Suspense fallback={null}>
                            <WorkspaceCommandPalette open onClose={() => setPaletteOpen(false)} />
                        </Suspense>
                    ) : null}
                </div>
            </WorkspaceTopBarExtensionProvider>
            <WorkspaceWalletHost />
            <WorkspaceStorageLimitNotice />
            <GenerationSuccessNotifier />
            {userScope ? <DetailRunners key={userScope} scope={userScope} /> : null}
            <ModelSetupGuide hidden={hideChrome || teamWorkspace || pathname === "/login" || pathname === "/register"} />
        </>
    );
}
