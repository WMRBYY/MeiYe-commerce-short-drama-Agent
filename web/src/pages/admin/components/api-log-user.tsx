import { UserAvatar } from "@/components/layout/user-avatar";
import type { ApiCallLog } from "@/services/api/auth";

export function ApiLogUser({ log, showAccount = false }: { log: ApiCallLog; showAccount?: boolean }) {
    const name = log.userDisplayName || log.userAccount || "未知用户";
    const account = log.userAccount ? `@${log.userAccount}` : "";
    const avatar = { avatarUrl: log.userAvatarUrl, avatarMode: log.userAvatarMode, avatarPreset: log.userAvatarPreset };

    return (
        <div className="flex min-w-0 items-center gap-2" title={[name, account].filter(Boolean).join(" · ")}>
            <UserAvatar user={avatar} className="size-6 rounded-full bg-[var(--admin-layer-2)]" iconClassName="max-h-4 max-w-4 text-[var(--admin-text-muted)]" />
            <div className="min-w-0">
                <div className="truncate">{name}</div>
                {showAccount ? <div className="truncate text-xs text-[var(--admin-text-muted)]">{account || "账号未记录"}</div> : null}
            </div>
        </div>
    );
}
