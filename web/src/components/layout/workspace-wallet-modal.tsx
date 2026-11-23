import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Skeleton, Tooltip } from "antd";
import { ChevronLeft, ChevronRight, CircleAlert, Coins, CreditCard, Gift, HardDrive, History, RefreshCw, Sparkles, TicketCheck, Undo2, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";
import { generationErrorMessage } from "@/lib/generation-error";
import { CreditStar } from "@/components/ui/credit-star";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useLocation, useNavigate } from "react-router";
import { Trans, useTranslation } from "react-i18next";

import { WalletTopupPanel, type TopupCategory } from "@/components/layout/workspace-wallet-topup";
import "./workspace-wallet-ledger.css";
import { WalletHistoryRow } from "@/components/layout/workspace-wallet-history-row";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { PaymentOrdersPanel, paymentOrdersQueryKey } from "@/components/payment/payment-orders-panel";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { currentLocale, translate } from "@/i18n";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter } from "@/lib/account-storage-usage";
import { estimatePaymentCharge, paymentOptionsFromProviders, type PaymentOption } from "@/lib/payment-options";
import { getPaymentSettings, listPaymentProviders, listTopupProducts, type PaymentOrder, type TopupProduct, type TopupProductKind } from "@/services/api/payments";
import { listMyStorageGrants } from "@/services/api/storage-grants";
import { getWallet, redeemCredits, type CreditLedgerEntry, type WalletHistoryEntry, type WalletHistoryType, type WalletSummary } from "@/services/api/wallet";
import { WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { useLoginDialogStore } from "@/stores/use-login-dialog-store";

type WalletModalTab = NonNullable<WorkspaceWalletOpenDetail["tab"]>;

const storageGrantsQueryKey = ["account-storage-grants"] as const;

export function WorkspaceWalletHost() {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const userId = useUserStore((state) => state.user?.id);
    const hydrated = useUserStore((state) => state.hydrated);
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [openDetail, setOpenDetail] = useState<WorkspaceWalletOpenDetail>({});
    const walletRoute = pathname === "/wallet";
    const routeOpen = walletRoute && hydrated && Boolean(userId) && creditsEnabled;
    const routeParams = routeOpen ? new URLSearchParams(search) : undefined;

    useEffect(() => {
        setOpen(false);
        setOpenDetail({});
    }, [userId]);

    // 积分关闭时仍要能打开充值页购买存储空间，只是隐藏积分余额、兑换和积分记录。
    const applyOpen = (detail: WorkspaceWalletOpenDetail = {}) => {
        const session = useUserStore.getState();
        if (!session.hydrated || !session.user) {
            const params = new URLSearchParams();
            if (detail.paymentOrderId) params.set("paymentOrder", detail.paymentOrderId);
            if (detail.paymentInvalid) params.set("payment", "invalid");
            useLoginDialogStore.getState().show("/wallet" + (params.size ? "?" + params.toString() : ""));
            return;
        }
        if (!session.features.creditsEnabled && detail.category !== "storage") return;
        setOpenDetail(detail);
        setOpen(true);
    };

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            applyOpen((raw as CustomEvent<WorkspaceWalletOpenDetail>).detail || {});
        };
        window.addEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (walletRoute && hydrated && userId && !creditsEnabled) navigate("/", { replace: true });
    }, [creditsEnabled, hydrated, navigate, userId, walletRoute]);

    if (!userId) return null;
    return (
        <WorkspaceWalletModal
            key={userId}
            open={open || routeOpen}
            creditsEnabled={creditsEnabled}
            initialTab={openDetail.tab}
            initialCategory={openDetail.category}
            pendingPaymentOrderId={routeOpen ? routeParams?.get("paymentOrder") || undefined : openDetail.paymentOrderId}
            paymentInvalid={routeOpen ? routeParams?.get("payment") === "invalid" : openDetail.paymentInvalid}
            onClose={() => {
                setOpen(false);
                setOpenDetail({});
                if (walletRoute) navigate("/", { replace: true });
            }}
        />
    );
}

export function WorkspaceWalletModal({
    open,
    onClose,
    creditsEnabled = true,
    initialTab,
    initialCategory,
    pendingPaymentOrderId,
    paymentInvalid,
}: {
    open: boolean;
    onClose: () => void;
    creditsEnabled?: boolean;
    initialTab?: WalletModalTab;
    initialCategory?: TopupCategory;
    pendingPaymentOrderId?: string;
    paymentInvalid?: boolean;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const redeemPurchaseUrl = useAppearanceStore((state) => state.appearance.redeemPurchaseUrl);
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [focusKind, setFocusKind] = useState<TopupProductKind | undefined>();
    const [focusToken, setFocusToken] = useState(0);
    const [walletResult, setWalletResult] = useState<{ type: WalletHistoryType; data: WalletSummary } | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [page, setPage] = useState(1);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
    const [usdCnyRate, setUsdCnyRate] = useState("");
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedOptionKey, setSelectedOptionKey] = useState("");
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const requestSequence = useRef(0);
    const storageQuery = useAccountFileStorageUsage(open);
    const grantsQuery = useQuery({ queryKey: storageGrantsQueryKey, queryFn: listMyStorageGrants, enabled: open });
    const storageMeter = accountStorageMeter(storageQuery.data);

    const selectedProduct = useMemo(() => products.find((item) => item.id === selectedProductId), [products, selectedProductId]);
    const selectedOption = useMemo(() => paymentOptions.find((item) => item.key === selectedOptionKey), [paymentOptions, selectedOptionKey]);
    const activeTab: WalletModalTab = creditsEnabled || tab === "orders" ? tab : "topup";
    const historyType = activeTab === "income" ? "income" : "expenses";
    const wallet = walletResult?.data;
    const historyWallet = walletResult?.type === historyType ? wallet : undefined;

    const reloadWallet = async (targetPage = page, targetType: WalletHistoryType = historyType) => {
        if (!creditsEnabled) return;
        const sequence = ++requestSequence.current;
        setWalletLoading(true);
        setWalletError("");
        try {
            const result = await getWallet(targetPage, 20, targetType);
            if (sequence === requestSequence.current) setWalletResult({ type: targetType, data: result });
        } catch (error) {
            if (sequence === requestSequence.current) setWalletError(error instanceof Error ? error.message : t("account.wallet.loadFailed"));
        } finally {
            if (sequence === requestSequence.current) setWalletLoading(false);
        }
    };

    const openHistory = (nextTab: "income" | "history") => {
        setTab(nextTab);
        setPage(1);
        void reloadWallet(1, nextTab === "income" ? "income" : "expenses");
    };

    useEffect(() => {
        if (!open) return;
        setTab(initialTab || "topup");
        setFocusKind(initialCategory && initialCategory !== "all" ? initialCategory : undefined);
        setPage(1);
        void reloadWallet(1, initialTab === "income" ? "income" : "expenses");
        setPaymentsLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders(), getPaymentSettings()])
            .then(([productResult, providerResult, settingsResult]) => {
                const enabledProducts = productResult.products.filter((item) => item.enabled);
                const usableProviders = providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured);
                const options = paymentOptionsFromProviders(usableProviders);
                setProducts(enabledProducts);
                setPaymentOptions(options);
                setUsdCnyRate(settingsResult.settings.usdCnyRate || "");
                // 从容量入口进入时优先选中存储空间套餐。
                const preferred = enabledProducts.filter((item) => !initialCategory || initialCategory === "all" || item.kind === initialCategory);
                setSelectedProductId((current) =>
                    current && enabledProducts.some((item) => item.id === current) && !initialCategory ? current : preferred.find((item) => item.canPurchase)?.id || enabledProducts.find((item) => item.canPurchase)?.id || "",
                );
                setSelectedOptionKey((current) => (current && options.some((item) => item.key === current) ? current : options[0]?.key || ""));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("account.wallet.configLoadFailed")))
            .finally(() => setPaymentsLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error(t("account.wallet.paymentInvalid"));
    }, [open, paymentInvalid]);

    const announceWalletUpdated = async () => {
        setPage(1);
        await queryClient.invalidateQueries({ queryKey: ["wallet-recharge-history"] });
        await reloadWallet(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    };

    const announceGranted = async (order: PaymentOrder) => {
        if (order.productKind === "storage") {
            await Promise.all([queryClient.invalidateQueries({ queryKey: accountFileStorageUsageQueryKey }), queryClient.invalidateQueries({ queryKey: storageGrantsQueryKey })]);
            return;
        }
        await announceWalletUpdated();
    };

    const payment = usePaymentOrderFlow({ onGranted: announceGranted });

    useEffect(() => {
        if (payment.order) void queryClient.invalidateQueries({ queryKey: paymentOrdersQueryKey });
    }, [payment.order, queryClient]);

    useEffect(() => {
        payment.resetIdempotency();
    }, [selectedProductId, selectedOptionKey]);

    // 换了套餐后，当前支付入口可能因币种无法换算而不可用，改选第一个可用入口。
    useEffect(() => {
        if (!selectedProduct || !paymentOptions.length) return;
        const payable = (option: PaymentOption) => Boolean(estimatePaymentCharge(selectedProduct.amountFen, selectedProduct.currency, option.settlementCurrency, usdCnyRate));
        if (selectedOption && payable(selectedOption)) return;
        const next = paymentOptions.find(payable);
        if (next) setSelectedOptionKey(next.key);
    }, [selectedProduct, paymentOptions, selectedOption, usdCnyRate]);

    useEffect(() => {
        if (!open || !pendingPaymentOrderId) return;
        void payment.showOrder(pendingPaymentOrderId);
    }, [open, pendingPaymentOrderId]);

    const redeem = async () => {
        const normalized = code.trim().toLowerCase();
        if (normalized.length !== 32) {
            message.error(t("account.wallet.redeemCodeInvalid"));
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            await announceWalletUpdated();
            message.success(t("account.wallet.redeemSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.wallet.redeemFailed"));
        } finally {
            setRedeeming(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedOption) {
            message.error(t("account.wallet.selectRequired"));
            return;
        }
        if (!selectedProduct.canPurchase) {
            message.error(t("account.wallet.productUnavailable"));
            return;
        }
        await payment.start(selectedProduct.id, selectedOption.providerId, selectedOption.method);
    };

    // 定位到某类套餐：滚动到分组，并在当前选中项不属于该类时改选该类第一个可买套餐。
    const focusProducts = (kind: TopupProductKind) => {
        setTab("topup");
        setFocusKind(kind);
        setFocusToken((value) => value + 1);
        if (selectedProduct?.kind === kind) return;
        const next = products.find((item) => item.kind === kind && item.canPurchase);
        if (next) setSelectedProductId(next.id);
    };

    const available = wallet?.account.availableMicrocredits ?? 0;
    const totalPages = Math.max(1, Math.ceil((historyWallet?.total || 0) / 20));
    const pageSummary = useMemo(() => {
        if (!historyWallet?.entries.length) return null;
        let spent = 0;
        let earned = 0;
        for (const entry of historyWallet.entries) {
            const amount = entry.type === "billing" ? -entry.chargedMicrocredits : entry.amountMicrocredits;
            if (amount < 0) spent += amount;
            else earned += amount;
        }
        return { spent, earned };
    }, [historyWallet]);

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width="min(920px, calc(100vw - 28px))" onCancel={onClose} rootClassName="workspace-wallet-modal">
                <div className="workspace-wallet-shell">
                    <header className="workspace-wallet-header">
                        <div>
                            <span className="workspace-wallet-kicker">
                                <CreditStar />
                                {creditsEnabled ? t("nav.tools.wallet") : t("account.wallet.topupCenter")}
                            </span>
                            <h2>{creditsEnabled ? t("account.wallet.title") : t("account.wallet.titleStorage")}</h2>
                            <p>{creditsEnabled ? t("account.wallet.description") : t("account.wallet.descriptionStorage")}</p>
                        </div>
                        <div className="workspace-wallet-stats">
                            {creditsEnabled ? (
                                <div className="workspace-wallet-balance">
                                    <span>{t("shell.account.availableCredits")}</span>
                                    <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                                    <small>{t("account.wallet.reserved", { amount: wallet ? formatCredits(wallet.account.reservedMicrocredits, 6) : "--" })}</small>
                                </div>
                            ) : null}
                            <button type="button" className="workspace-wallet-balance is-storage" aria-label={t("account.wallet.viewStorage")} onClick={() => focusProducts("storage")}>
                                <span>
                                    <HardDrive className="inline size-3 align-[-1px]" aria-hidden="true" /> {t("account.wallet.storage")}
                                </span>
                                <strong>{storageQuery.data ? `${storageMeter.usedLabel} / ${storageMeter.totalLabel}` : "--"}</strong>
                                <span className="wallet-topup-storage-track" aria-hidden="true">
                                    <span style={{ width: `${storageMeter.percent}%` }} />
                                </span>
                                <small>
                                    {storageMeter.state === "read_only"
                                        ? t("account.wallet.storageReadOnly")
                                        : storageMeter.state === "grace"
                                          ? t("account.wallet.storageGrace")
                                          : storageMeter.purchasedLabel
                                            ? t("account.wallet.storagePurchased", { size: storageMeter.purchasedLabel })
                                            : t("account.layout.storage.remaining", { size: storageMeter.remainingLabel })}
                                </small>
                            </button>
                        </div>
                    </header>

                    <div className="workspace-wallet-tabs" role="tablist" aria-label={t("nav.tools.wallet")}>
                        <button type="button" role="tab" aria-selected={activeTab === "topup"} onClick={() => setTab("topup")}>
                            <WalletCards />
                            {t("account.wallet.tabTopup")}
                        </button>
                        <button type="button" role="tab" aria-selected={activeTab === "orders"} onClick={() => setTab("orders")}>
                            <CreditCard />
                            {t("account.payment.ordersTitle")}
                        </button>
                        {creditsEnabled ? (
                            <>
                                <button type="button" role="tab" aria-selected={activeTab === "redeem"} onClick={() => setTab("redeem")}>
                                    <TicketCheck />
                                    {t("account.wallet.tabRedeem")}
                                </button>
                                <button type="button" role="tab" aria-selected={activeTab === "recharge-history"} onClick={() => setTab("recharge-history")}>
                                    <WalletCards />
                                    {t("workspace.wallet.rechargeHistory")}
                                </button>
                                <button type="button" role="tab" aria-selected={activeTab === "income"} onClick={() => openHistory("income")}>
                                    <Coins />
                                    {t("account.wallet.tabIncome")}
                                </button>
                                <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => openHistory("history")}>
                                    <History />
                                    {t("account.wallet.tabHistory")}
                                </button>
                            </>
                        ) : null}
                    </div>

                    {activeTab === "orders" ? (
                        <PaymentOrdersPanel onOpen={(id) => void payment.showOrder(id)} />
                    ) : activeTab === "topup" ? (
                        <WalletTopupPanel
                            loading={paymentsLoading}
                            products={products}
                            paymentOptions={paymentOptions}
                            usdCnyRate={usdCnyRate}
                            focusKind={focusKind}
                            focusToken={focusToken}
                            selectedProduct={selectedProduct}
                            onSelectProduct={setSelectedProductId}
                            selectedOptionKey={selectedOptionKey}
                            onSelectOption={setSelectedOptionKey}
                            creating={payment.creating}
                            onPay={() => void startPayment()}
                            storageUsage={storageQuery.data}
                            storageGrants={grantsQuery.data?.grants || []}
                            onCleanAssets={() => {
                                onClose();
                                navigate("/assets");
                            }}
                        />
                    ) : activeTab === "redeem" ? (
                        <div className="workspace-wallet-content is-redeem">
                            <section className="workspace-wallet-section is-redeem">
                                <div className="workspace-wallet-section-heading">
                                    <div>
                                        <h3>{t("account.wallet.redeemTitle")}</h3>
                                        <p>
                                            {t("account.wallet.redeemDescription")}
                                            {redeemPurchaseUrl ? (
                                                <a className="workspace-wallet-redeem-link" href={redeemPurchaseUrl} target="_blank" rel="noopener noreferrer">
                                                    {t("account.wallet.redeemGet")}
                                                </a>
                                            ) : null}
                                        </p>
                                    </div>
                                    <TicketCheck />
                                </div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder={t("account.wallet.redeemPlaceholder")} onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>
                                        {t("account.wallet.redeemSubmit")}
                                    </Button>
                                </div>
                            </section>
                        </div>
                    ) : activeTab === "recharge-history" ? (
                        <WalletRechargeHistory />
                    ) : (
                        <div className="workspace-wallet-content is-history is-ledger-v2">
                            <div className="workspace-wallet-history-toolbar">
                                <div>
                                    <h3>{t(activeTab === "income" ? "account.wallet.tabIncome" : "account.wallet.tabHistory")}</h3>
                                    <p>{t(activeTab === "income" ? "account.wallet.incomeDescription" : "account.wallet.historyDescription")}</p>
                                </div>
                                <div className="workspace-wallet-history-summary">
                                    {pageSummary ? (
                                        <>
                                            <span className="is-consume">
                                                <Trans i18nKey="workspace.wallet.pageSpent" values={{ amount: formatCredits(pageSummary.spent, 6) }} components={{ b: <b /> }} />
                                            </span>
                                            <span className="is-income">
                                                <Trans i18nKey="workspace.wallet.pageEarned" values={{ amount: formatCredits(pageSummary.earned, 6) }} components={{ b: <b /> }} />
                                            </span>
                                        </>
                                    ) : null}
                                    <Tooltip title={t("common.refresh")}>
                                        <button type="button" className="workspace-wallet-history-refresh" aria-label={t("common.refresh")} disabled={walletLoading} onClick={() => void reloadWallet(page)}>
                                            <RefreshCw className={walletLoading ? "is-spinning" : undefined} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                            <div className="workspace-wallet-history-scroll">
                                {walletError ? (
                                    <div className="workspace-wallet-inline-state is-error">
                                        <CircleAlert />
                                        <div>
                                            <strong>{t("account.wallet.historyLoadFailed")}</strong>
                                            <span>{walletError}</span>
                                        </div>
                                        <Button onClick={() => void reloadWallet(page)}>{t("common.retry")}</Button>
                                    </div>
                                ) : walletLoading && !historyWallet ? (
                                    <Skeleton active paragraph={{ rows: 6 }} />
                                ) : historyWallet?.entries.length ? (
                                    <div className="workspace-wallet-ledger">
                                        {groupLedgerByDay(historyWallet.entries).map((group) => (
                                            <section key={group.key} className="workspace-wallet-ledger-day">
                                                <h4>
                                                    <span>{group.label}</span>
                                                    <small>{t("workspace.wallet.dayCount", { count: group.entries.length })}</small>
                                                </h4>
                                                <div className="workspace-wallet-ledger-day-list">
                                                    {group.entries.map((entry) => (
                                                        <WalletHistoryRow key={`${entry.type}:${entry.id}`} entry={entry} />
                                                    ))}
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="workspace-wallet-empty">
                                        <History />
                                        <strong>{t(activeTab === "income" ? "account.wallet.incomeEmpty" : "account.wallet.historyEmpty")}</strong>
                                        <span>{t(activeTab === "income" ? "account.wallet.incomeEmptyHint" : "account.wallet.historyEmptyHint")}</span>
                                    </div>
                                )}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>{t("account.wallet.pageOf", { page, total: totalPages })}</span>
                                <button
                                    type="button"
                                    disabled={page <= 1 || walletLoading}
                                    aria-label={t("account.layout.pagination.prev")}
                                    onClick={() => {
                                        const next = page - 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronLeft />
                                </button>
                                <button
                                    type="button"
                                    disabled={page >= totalPages || walletLoading}
                                    aria-label={t("account.layout.pagination.next")}
                                    onClick={() => {
                                        const next = page + 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronRight />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </AppModal>

            {payment.dialog}
        </>
    );
}

// 显示名称用 getter 在读取时取当前语言。
const LEDGER_TYPE_META: Record<CreditLedgerEntry["type"], { title: string; tone: "consume" | "income" | "refund" | "bonus"; icon: ComponentType<{ className?: string }> }> = {
    consume: {
        get title() {
            return translate("account.wallet.ledger.consume");
        },
        tone: "consume",
        icon: Sparkles,
    },
    refund: {
        get title() {
            return translate("account.wallet.ledger.refund");
        },
        tone: "refund",
        icon: Undo2,
    },
    payment_topup: {
        get title() {
            return translate("account.wallet.ledger.paymentTopup");
        },
        tone: "income",
        icon: WalletCards,
    },
    redeem: {
        get title() {
            return translate("account.wallet.ledger.redeem");
        },
        tone: "income",
        icon: TicketCheck,
    },
    referral_commission: {
        get title() {
            return translate("account.wallet.ledger.referral");
        },
        tone: "bonus",
        icon: Gift,
    },
    signup_bonus: {
        get title() {
            return translate("workspace.ledger.signupBonus");
        },
        tone: "bonus",
        icon: Gift,
    },
    checkin_bonus: {
        get title() {
            return translate("workspace.ledger.checkinBonus");
        },
        tone: "bonus",
        icon: Gift,
    },
    admin_grant: {
        get title() {
            return translate("workspace.ledger.adminGrant");
        },
        tone: "bonus",
        icon: CreditStar,
    },
    team_transfer: { title: "团队转账", tone: "income", icon: CreditStar },
    admin_adjustment: {
        get title() {
            return translate("account.wallet.ledger.adjust");
        },
        tone: "income",
        icon: CreditStar,
    },
};

const LEDGER_SCENE_LABELS: Record<string, string> = {
    get image() {
        return translate("workspace.wallet.scene.image");
    },
    get video() {
        return translate("workspace.wallet.scene.video");
    },
    get text() {
        return translate("workspace.wallet.scene.text");
    },
    get audio() {
        return translate("workspace.wallet.scene.audio");
    },
    agent: "Agent",
    viral_plan: "爆款策划",
};

function ledgerDayKey(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "unknown";
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function ledgerDayLabel(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return translate("time.unknown");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - target.getTime()) / 86400000);
    if (days === 0) return translate("workspace.wallet.today");
    if (days === 1) return translate("workspace.wallet.yesterday");
    return date.toLocaleDateString(currentLocale(), { year: date.getFullYear() === today.getFullYear() ? undefined : "numeric", month: "long", day: "numeric", weekday: "short" });
}

function groupLedgerByDay<T extends { createdAt: string }>(entries: T[]) {
    const groups: { key: string; label: string; entries: T[] }[] = [];
    for (const entry of entries) {
        const key = ledgerDayKey(entry.createdAt);
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.entries.push(entry);
        else groups.push({ key, label: ledgerDayLabel(entry.createdAt), entries: [entry] });
    }
    return groups;
}

function WalletLedgerRow({ entry, showBalance = false }: { entry: CreditLedgerEntry; showBalance?: boolean }) {
    const { t } = useTranslation();
    const positive = entry.amountMicrocredits > 0;
    const note = entry.note ? generationErrorMessage(entry.note) : "";
    const meta = LEDGER_TYPE_META[entry.type];
    const Icon = meta?.icon || (positive ? CreditStar : CreditCard);
    const tone = meta?.tone || (positive ? "income" : "consume");
    const title = meta && entry.type !== "admin_adjustment" ? meta.title : note || meta?.title || t("account.wallet.ledger.adjust");
    const scene = entry.scene ? LEDGER_SCENE_LABELS[entry.scene] || entry.scene : "";
    const detail = note && note !== title ? note : "";
    const time = new Date(entry.createdAt);
    return (
        <article className={cn("workspace-wallet-ledger-row", `is-${tone}`)}>
            <span className="workspace-wallet-ledger-icon" aria-hidden="true">
                <Icon />
            </span>
            <div className="workspace-wallet-ledger-main">
                <div className="workspace-wallet-ledger-title">
                    <strong>{title}</strong>
                    {scene ? <em>{scene}</em> : null}
                    {entry.model ? <code title={entry.model}>{entry.model}</code> : null}
                </div>
                {detail ? <span title={detail}>{detail}</span> : !scene && !entry.model ? <span>{t("account.wallet.ledger.change")}</span> : null}
                {showBalance ? <span>{t("workspace.wallet.availableAfter", { amount: formatCredits(entry.availableAfterMicrocredits, 6) })}</span> : null}
                {showBalance && entry.paymentOrderId ? <span title={entry.paymentOrderId}>{t("workspace.wallet.relatedOrder", { id: entry.paymentOrderId })}</span> : null}
            </div>
            <div className="workspace-wallet-ledger-side">
                <b className={positive ? "is-income" : "is-consume"}>
                    {positive ? "+" : ""}
                    {formatCredits(entry.amountMicrocredits, 6)}
                </b>
                <time dateTime={entry.createdAt} title={time.toLocaleString(currentLocale(), { hour12: false })}>
                    {Number.isFinite(time.getTime()) ? time.toLocaleTimeString(currentLocale(), { hour12: false }) : "--"}
                </time>
            </div>
        </article>
    );
}

function WalletRechargeHistory() {
    const { t } = useTranslation();
    const userId = useUserStore((state) => state.user?.id);
    const [page, setPage] = useState(1);
    const records = useQuery({
        queryKey: ["wallet-recharge-history", userId, page],
        queryFn: () => getWallet(page, 20, "topup"),
        enabled: !!userId,
        staleTime: 0,
    });
    const totalPages = Math.max(1, Math.ceil((records.data?.total || 0) / 20));

    return (
        <div className="workspace-wallet-content is-history is-ledger-v2" aria-label={t("workspace.wallet.rechargeHistory")} aria-busy={records.isFetching}>
            <div className="workspace-wallet-history-toolbar">
                <div>
                    <h3>{t("workspace.wallet.rechargeHistory")}</h3>
                    <p>{t("workspace.wallet.rechargeDescription")}</p>
                </div>
                <button type="button" className="workspace-wallet-history-refresh" aria-label={t("workspace.wallet.refreshRecharge")} disabled={records.isFetching} onClick={() => void records.refetch()}>
                    <RefreshCw className={records.isFetching ? "is-spinning" : undefined} />
                </button>
            </div>
            <div className="workspace-wallet-history-scroll">
                {records.isError ? (
                    <div className="workspace-wallet-inline-state is-error" role="alert">
                        <CircleAlert />
                        <div>
                            <strong>{t("workspace.wallet.rechargeLoadFailed")}</strong>
                            <span>{records.error instanceof Error ? records.error.message : t("workspace.wallet.tryLater")}</span>
                        </div>
                        <Button onClick={() => void records.refetch()}>{t("common.retry")}</Button>
                    </div>
                ) : records.isFetching ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                ) : records.data?.entries.length ? (
                    <div className="workspace-wallet-ledger">
                        {groupLedgerByDay(records.data.entries).map((group) => (
                            <section key={group.key} className="workspace-wallet-ledger-day">
                                <h4>
                                    <span>{group.label}</span>
                                    <small>{t("workspace.wallet.dayCount", { count: group.entries.length })}</small>
                                </h4>
                                <div className="workspace-wallet-ledger-day-list">{group.entries.map((entry) => (entry.type !== "billing" ? <WalletLedgerRow key={entry.id} entry={entry} showBalance /> : null))}</div>
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="workspace-wallet-empty">
                        <WalletCards />
                        <strong>{t("workspace.wallet.rechargeEmpty")}</strong>
                        <span>{t("workspace.wallet.rechargeEmptyHint")}</span>
                    </div>
                )}
            </div>
            <div className="workspace-wallet-pagination">
                <span>{t("workspace.wallet.rechargePageSummary", { total: records.data?.total || 0, page, pages: totalPages })}</span>
                <button type="button" aria-label={t("workspace.wallet.rechargePrev")} disabled={page <= 1 || records.isFetching} onClick={() => setPage((value) => value - 1)}>
                    <ChevronLeft />
                </button>
                <button type="button" aria-label={t("workspace.wallet.rechargeNext")} disabled={page >= totalPages || records.isFetching || records.isError} onClick={() => setPage((value) => value + 1)}>
                    <ChevronRight />
                </button>
            </div>
        </div>
    );
}
