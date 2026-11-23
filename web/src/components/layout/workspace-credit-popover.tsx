import { Popover, Skeleton } from "antd";
import { CreditStar } from "@/components/ui/credit-star";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCredits } from "@/constant/credits";
import { currentLocale } from "@/i18n";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { WalletHistoryRow } from "./workspace-wallet-history-row";
import { getWallet, type WalletSummary } from "@/services/api/wallet";
import "./workspace-credit-popover.css";

// 积分流水类型 → 显示名称的文案键。
const labelKeys: Record<string, string> = {
    redeem: "account.wallet.ledger.redeem",
    payment_topup: "account.wallet.ledger.paymentTopup",
    admin_grant: "workspace.ledger.adminGrant",
    consume: "workspace.ledger.creationConsume",
    refund: "workspace.ledger.creditRefund",
    admin_adjustment: "account.wallet.ledger.adjust",
    signup_bonus: "workspace.ledger.signupCredits",
    checkin_bonus: "workspace.ledger.checkinCredits",
};

export function WorkspaceCreditPopover({ userId, availableMicrocredits }: { userId: string; availableMicrocredits: number | null }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setWallet(null);
    }, [userId]);
    useEffect(() => {
        if (!open) return;
        let current = true;
        setLoading(true);
        setError("");
        getWallet(1, 20, "all")
            .then((result) => {
                if (current) setWallet(result);
            })
            .catch((cause) => {
                if (current) setError(cause instanceof Error ? cause.message : t("workspace.credits.loadFailed"));
            })
            .finally(() => {
                if (current) setLoading(false);
            });
        return () => {
            current = false;
        };
    }, [open, userId]);

    const balance = wallet?.account.availableMicrocredits ?? availableMicrocredits;
    const content = (
        <div className="workspace-credit-popover-content">
            <div className="workspace-credit-popover-head">
                <div>
                    <span>{t("workspace.credits.balance")}</span>
                    <strong>{balance === null ? "--" : formatCredits(balance, 6)}</strong>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setOpen(false);
                        openWorkspaceWallet();
                    }}
                >
                    {t("shell.creditMarket")}
                </button>
            </div>
            <div className="workspace-credit-popover-title">
                <span>{t("workspace.credits.history")}</span>
                <button
                    type="button"
                    onClick={() => {
                        setOpen(false);
                        openWorkspaceWallet({ tab: "history" });
                    }}
                >
                    {t("workspace.credits.viewDetails")}
                </button>
            </div>
            <div className="workspace-credit-popover-list" role="list" aria-label={t("workspace.credits.recentLabel")}>
                {loading && !wallet ? (
                    <Skeleton active paragraph={{ rows: 4 }} title={false} />
                ) : error ? (
                    <p role="alert">{error}</p>
                ) : wallet?.entries.length ? (
                    wallet.entries.map((entry) => <WalletHistoryRow key={`${entry.type}:${entry.id}`} entry={entry} />)
                ) : (
                    <p>{t("workspace.credits.empty")}</p>
                )}
            </div>
        </div>
    );

    return (
        <Popover open={open} onOpenChange={setOpen} trigger={["hover", "click"]} placement="bottomRight" arrow={false} rootClassName="workspace-credit-popover" content={content}>
            <button type="button" className="app-workspace-topbar-credit-balance" aria-label={t("workspace.credits.triggerLabel")} aria-expanded={open}>
                <CreditStar className="app-workspace-topbar-credit-star" />
                <strong>{availableMicrocredits === null ? "--" : formatCredits(availableMicrocredits, 6)}</strong>
            </button>
        </Popover>
    );
}
