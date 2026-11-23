import { Button, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./fact-review.css";

export function CommerceFactReview({ facts, onApply, onExclude, excludeLabel }: { facts: string[]; onApply: (verified: string) => void; onExclude: () => void; excludeLabel?: string }) {
    const { t } = useTranslation();
    const [verified, setVerified] = useState("");
    if (!facts.length) return null;
    return (
        <div className="ecommerce-fact-review">
            <strong>{t("ecommerce.factReview.title")}</strong>
            <ul>
                {facts.map((fact, index) => (
                    <li key={index}>{fact}</li>
                ))}
            </ul>
            <label>
                {t("ecommerce.factReview.supplement")}
                <Input.TextArea rows={3} value={verified} placeholder={t("ecommerce.factReview.placeholder")} onChange={(event) => setVerified(event.target.value)} />
            </label>
            <p>{t("ecommerce.factReview.hint")}</p>
            <Button size="small" disabled={!verified.trim()} onClick={() => onApply(verified.trim())}>
                {t("ecommerce.factReview.save")}
            </Button>{" "}
            <Button size="small" onClick={onExclude}>
                {excludeLabel || t("ecommerce.factReview.exclude")}
            </Button>
        </div>
    );
}
