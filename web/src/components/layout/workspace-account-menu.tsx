import { Popover } from "antd";
import { ArrowUpRight, Bell, ChevronRight, CircleHelp, HardDrive, History, Inbox, LogOut, ScrollText, Settings, ShieldCheck, UserRound } from "lucide-react";
import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { refreshPublicAppearance } from "@/services/appearance-bootstrap";

import { FeedbackModal } from "@/components/feedback/feedback-modal";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { accountStorageMeter, accountStorageStateMessage } from "@/lib/account-storage-usage";
import { useUserFeedbackEnabled } from "@/lib/plugins/builtin/user-feedback";
import { progressFillStyle } from "@/lib/progress-fill";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useLoginDialogStore } from "@/stores/use-login-dialog-store";
import { useUserStore } from "@/stores/use-user-store";
import { openSystemAnnouncements } from "./system-announcement-center";
import { UserAvatar } from "./user-avatar";
import { UserGroupAvatarRing, UserGroupBadge } from "./user-group-badge";
import "./workspace-account-menu.css";

const AppChangelogDialog = lazy(() => import("@/components/layout/app-changelog-dialog").then((module) => ({ default: module.AppChangelogDialog })));

/** 右上角头像菜单：身份、账号容量、个人入口、管理员后台与退出登录。 */
export function WorkspaceAccountMenu() {
    const { t } = useTranslation();
    const location = useLocation();
    const showLogin = useLoginDialogStore((state) => state.show);
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const referralAvailable = useUserStore((state) => state.referralAvailable);
    const taskCenterEnabled = useUserStore((state) => state.features.taskCenterEnabled);
    const feedbackEnabled = useUserFeedbackEnabled();
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    const [menuOpen, setMenuOpen] = useState(false);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [changelogOpen, setChangelogOpen] = useState(false);

    if (!hydrated) {
        return <span className="size-9 animate-pulse rounded-[var(--r-md)] bg-foreground/[.06]" aria-hidden />;
    }

    if (!user) {
        return <button type="button" onClick={() => showLogin(location.pathname + location.search)} className="meiye-home-login-button" aria-label={t("shell.login")} title={t("shell.login")}><span>{t("shell.login")}</span><ArrowUpRight size={15} aria-hidden="true" /></button>;
    }

    const close = () => setMenuOpen(false);
    const profileName = user.displayName || user.username;
    let itemIndex = 0;
    const nextDelay = () => ({ "--menu-item-index": itemIndex++ }) as CSSProperties;

    const content = (
        <div className="workspace-account-dropdown" role="menu" aria-label={t("shell.accountMenu")}>
            <Link to="/settings?section=profile" onClick={close} className="workspace-account-dropdown-identity" style={nextDelay()} role="menuitem">
                <UserGroupAvatarRing><UserAvatar user={user} className="workspace-account-dropdown-avatar" /></UserGroupAvatarRing>
                <span className="workspace-account-dropdown-name">
                    <strong>{profileName}</strong>
                    <UserGroupBadge compact />
                </span>
                <ChevronRight className="workspace-account-dropdown-chevron" aria-hidden />
            </Link>

            <div style={nextDelay()} className="workspace-account-dropdown-stagger">
                <AccountStorageCard onNavigate={close} />
            </div>

            <nav className="workspace-account-dropdown-list">
                <MenuItem style={nextDelay()} to="/settings?section=profile" icon={<UserRound />} label={t("workspace.accountMenu.profile")} onClick={close} />
                <MenuItem style={nextDelay()} to="/settings?section=account" icon={<Settings />} label={t("workspace.accountMenu.accountSettings")} onClick={close} />
                <MenuItem style={nextDelay()} icon={<Bell />} label={t("workspace.accountMenu.notifications")} onClick={() => { close(); openSystemAnnouncements(); }} />
                {feedbackEnabled ? <MenuItem style={nextDelay()} icon={<CircleHelp />} label={t("workspace.accountMenu.helpFeedback")} onClick={() => { close(); setFeedbackOpen(true); }} /> : null}
                <MenuItem style={nextDelay()} icon={<ScrollText />} label={t("workspace.changelog.title")} onClick={() => { close(); void refreshPublicAppearance(); setChangelogOpen(true); }} />
                {taskCenterEnabled ? <MenuItem style={nextDelay()} to="/tasks" icon={<History />} label={t("nav.sidebar.history")} onClick={close} /> : null}
                {referralAvailable ? <MenuItem style={nextDelay()} to="/referral" icon={<Inbox />} label={t("shell.account.referral")} onClick={close} /> : null}
                {user.role === "admin" ? <MenuItem style={nextDelay()} to="/admin" icon={<ShieldCheck />} label={t("shell.account.adminConsole")} onClick={close} /> : null}
            </nav>

            <div className="workspace-account-dropdown-list is-footer">
                <MenuItem style={nextDelay()} icon={<LogOut />} label={loggingOut ? t("workspace.accountMenu.loggingOut") : t("shell.account.logout")} disabled={loggingOut} onClick={() => void handleLogout()} />
            </div>
        </div>
    );

    return (
        <>
            <Popover
                trigger="click"
                placement="bottomRight"
                arrow={false}
                rootClassName="workspace-account-popover workspace-account-dropdown-popover"
                open={menuOpen}
                onOpenChange={setMenuOpen}
                content={content}
            >
                <button type="button" className={cn("app-workspace-topbar-icon-button app-workspace-account-trigger", menuOpen && "is-open")} aria-label={t("shell.accountMenu")} aria-expanded={menuOpen} title={profileName}>
                    <UserGroupAvatarRing className="workspace-account-trigger-ring"><UserAvatar user={user} className="workspace-account-trigger-avatar" /></UserGroupAvatarRing>
                </button>
            </Popover>
            {feedbackEnabled ? <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} /> : null}
            {changelogOpen ? <Suspense fallback={null}><AppChangelogDialog open onClose={() => setChangelogOpen(false)} /></Suspense> : null}
        </>
    );
}

function MenuItem({ to, icon, label, onClick, style, disabled }: { to?: string; icon: ReactNode; label: string; onClick: () => void; style?: CSSProperties; disabled?: boolean }) {
    const body = <>{icon}<span>{label}</span></>;
    if (to) {
        return <Link to={to} onClick={onClick} style={style} className="workspace-account-dropdown-item" role="menuitem" onPointerEnter={() => preloadWorkspaceRoute(to)}>{body}</Link>;
    }
    return <button type="button" onClick={onClick} style={style} disabled={disabled} className="workspace-account-dropdown-item" role="menuitem">{body}</button>;
}

/** 与原侧栏容量条同源：同一查询、同一计算与状态提示。 */
function AccountStorageCard({ onNavigate }: { onNavigate: () => void }) {
    const { t } = useTranslation();
    const query = useAccountFileStorageUsage();
    const meter = accountStorageMeter(query.data);

    if (query.isError && !query.data) {
        return (
            <div className="workspace-account-storage is-error">
                <span className="workspace-account-storage-icon" aria-hidden><HardDrive /></span>
                <span className="workspace-account-storage-error">{t("account.layout.storage.unavailable")}</span>
                <button type="button" onClick={() => void query.refetch()}>{t("common.retry")}</button>
            </div>
        );
    }

    const usedText = query.data ? t("account.layout.storage.used", { size: meter.usedLabel }) : t("account.layout.storage.counting");
    const totalText = query.data ? t("account.layout.storage.total", { size: meter.totalLabel }) : "";
    const remainingText = query.data ? (meter.state === "read_only" ? t("account.layout.storage.readOnly") : meter.state === "grace" ? t("account.layout.storage.over") : meter.full ? t("account.layout.storage.full") : t("account.layout.storage.remaining", { size: meter.remainingLabel })) : "";
    const summary = query.data ? t("account.layout.storage.summary", { used: usedText, remaining: remainingText, total: totalText }) : usedText;
    const stateMessage = accountStorageStateMessage(meter);

    return (
        <Link
            to="/assets"
            onClick={onNavigate}
            className={cn(
                "workspace-account-storage",
                meter.tone === "warn" && "is-warn",
                (meter.tone === "critical" || meter.state !== "ok") && "is-critical",
                query.isPending && !query.data && "is-pending",
            )}
            title={stateMessage ? t("account.layout.storage.titleWithState", { summary, state: stateMessage }) : t("account.layout.storage.title", { summary })}
            aria-label={t("account.layout.storage.label", { summary })}
            aria-busy={query.isPending && !query.data}
            onPointerEnter={() => preloadWorkspaceRoute("/assets")}
        >
            <span className="workspace-account-storage-icon" aria-hidden><HardDrive /></span>
            <span className="workspace-account-storage-body">
                <span className="workspace-account-storage-row">
                    <strong>{usedText}</strong>
                    {totalText ? <span>{totalText}</span> : null}
                </span>
                <span
                    className="workspace-account-storage-track"
                    role="progressbar"
                    aria-label={t("account.layout.storage.progress")}
                    aria-valuemin={0}
                    aria-valuemax={query.data?.totalBytes ?? 0}
                    aria-valuenow={query.data ? Math.min(query.data.usedBytes, query.data.totalBytes) : 0}
                    aria-valuetext={summary}
                >
                    <span style={progressFillStyle(meter.percent)} />
                </span>
                {remainingText ? <span className="workspace-account-storage-remain">{remainingText}</span> : null}
            </span>
        </Link>
    );
}
