import { App } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Gift, LoaderCircle } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { formatCredits } from "@/constant/credits";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { shouldShowSidebarCheckin } from "@/lib/sidebar-checkin";
import { cn } from "@/lib/utils";
import { ApiError } from "@/services/api/request";
import { checkinCredits } from "@/services/api/wallet";
import { useUserStore } from "@/stores/use-user-store";

export function WorkspaceSidebarCheckin({ collapsed }: { collapsed: boolean }) {
    const { t } = useTranslation();
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { policy, refresh } = useWalletBalance(user?.id, Boolean(user) && creditsEnabled);
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [claiming, setClaiming] = useState(false);
    const [claimedDay, setClaimedDay] = useState("");

    const visible = shouldShowSidebarCheckin({
        creditsEnabled,
        checkinBonusMicrocredits: policy?.checkinBonusMicrocredits,
        checkedInToday: policy?.checkedInToday,
    });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (!visible || !policy || claimedDay === today) return null;

    const amount = formatCredits(policy.checkinBonusMicrocredits, 2);
    const claimable = policy.pendingMicrocredits > 0;
    const summary = t("workspace.checkin.summary", { amount });

    const claim = async () => {
        if (!user) {
            navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            return;
        }
        if (!claimable) return;
        if (claiming) return;
        setClaiming(true);
        try {
            await checkinCredits();
            setClaimedDay(today);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            void refresh();
            message.success(t("workspace.checkin.claimed", { amount }));
        } catch (error) {
            const alreadyClaimed = error instanceof ApiError && error.status === 409;
            if (error instanceof ApiError && error.status === 401) {
                navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
                return;
            }
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            if (alreadyClaimed) {
                setClaimedDay(today);
                return;
            }
            message.error(error instanceof Error ? error.message : t("account.layout.checkin.failed"));
        } finally {
            setClaiming(false);
        }
    };

    if (collapsed) {
        return (
            <button type="button" className="app-workspace-sidebar-checkin is-collapsed" title={summary} aria-label={t("account.layout.checkin.claimToday", { amount })} aria-busy={claiming} disabled={claiming || !claimable} onClick={() => void claim()}>
                {claiming ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Gift className="size-5" aria-hidden="true" />}
            </button>
        );
    }

    return (
        <aside className="app-workspace-sidebar-checkin" aria-label={summary}>
            <div className="app-workspace-sidebar-checkin-copy">
                <strong className="app-workspace-sidebar-checkin-title">{t("workspace.checkin.title")}</strong>
                <span className="app-workspace-sidebar-checkin-offer">
                    <Trans i18nKey="workspace.checkin.offer" values={{ amount }} components={{ em: <em /> }} />
                </span>
            </div>
            <button type="button" className={cn("app-workspace-sidebar-checkin-claim", claiming && "is-loading")} disabled={claiming || !claimable} aria-label={t("account.layout.checkin.claimToday", { amount })} onClick={() => void claim()}>
                {claiming ? t("account.layout.checkin.claiming") : t("workspace.checkin.claim")}
            </button>
        </aside>
    );
}
