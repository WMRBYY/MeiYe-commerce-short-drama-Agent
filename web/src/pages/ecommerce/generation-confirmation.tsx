import { Button, Modal } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EcommerceDraft, EcommercePlan } from "@/services/api/ecommerce";
import { assertCommerceClaimsGrounded, assertCommercePlanCurrent, excludeCommerceFacts } from "./planner";
import { CommerceFactReview } from "./fact-review";

export function GenerationConfirmation({
    plan,
    draft,
    busy,
    completed,
    label,
    onConfirm,
    onSupplement,
}: {
    plan: EcommercePlan;
    draft: EcommerceDraft;
    busy: boolean;
    completed: boolean;
    label?: string;
    onConfirm: (reviewed: EcommercePlan) => Promise<void>;
    onSupplement: (value: string) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState("");
    const locked = useRef(false);
    const remaining = plan.images.filter((image) => !image.taskId).length;
    const submit = async (reviewed: EcommercePlan) => {
        if (locked.current) return;
        locked.current = true;
        setConfirming(true);
        setError("");
        try {
            assertCommercePlanCurrent(reviewed, draft);
            assertCommerceClaimsGrounded(reviewed, draft);
            await onConfirm(reviewed);
            setOpen(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("ecommerce.confirmation.submitFailed"));
        } finally {
            locked.current = false;
            setConfirming(false);
        }
    };
    return (
        <>
            {error ? (
                <p className="ecommerce-confirmation-note" role="alert">
                    {error}
                </p>
            ) : null}
            {!completed && plan.uncertainFacts.length ? <p className="ecommerce-confirmation-note">{t("ecommerce.confirmation.uncertain", { count: plan.uncertainFacts.length })}</p> : null}
            <Button
                type="primary"
                block
                loading={busy || confirming}
                disabled={busy || completed}
                onClick={() => {
                    setError("");
                    try {
                        assertCommercePlanCurrent(plan, draft);
                    } catch (cause) {
                        setError((cause as Error).message);
                        return;
                    }
                    if (plan.uncertainFacts.length) setOpen(true);
                    else void submit(plan);
                }}
            >
                {label ||
                    (completed
                        ? t("ecommerce.confirmation.submitted")
                        : remaining < plan.images.length
                          ? t("ecommerce.confirmation.continueRemaining", { count: remaining })
                          : t("ecommerce.confirmation.confirmAll", { count: plan.images.length }))}
            </Button>
            <Modal
                title={t("ecommerce.confirmation.title")}
                open={open}
                footer={null}
                onCancel={() => {
                    if (!confirming) setOpen(false);
                }}
                closable={!confirming}
                maskClosable={!confirming}
            >
                <p>{t("ecommerce.confirmation.intro")}</p>
                {error ? (
                    <p className="ecommerce-confirmation-note" role="alert">
                        {error}
                    </p>
                ) : null}
                <div inert={confirming}>
                    <CommerceFactReview
                        facts={plan.uncertainFacts}
                        onApply={(value) => {
                            onSupplement(value);
                            setOpen(false);
                        }}
                        onExclude={() => void submit(excludeCommerceFacts(plan))}
                        excludeLabel={t("ecommerce.confirmation.excludeAndGenerate")}
                    />
                </div>
                {confirming ? <p role="status">{t("ecommerce.confirmation.saving")}</p> : null}
            </Modal>
        </>
    );
}
