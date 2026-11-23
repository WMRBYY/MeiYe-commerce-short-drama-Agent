import { Select } from "antd";
import { useTranslation } from "react-i18next";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { commerceAllowsText, commerceTextConstraint, commerceTextOnlyCreativeFields, creativeControlFields, normalizeCreativeOptions } from "./creative-controls";
import { ecommerceText } from "./display-text";

export function CreativeOptionsPanel({ draft, onChange }: { draft: EcommerceDraft; onChange: (patch: Partial<EcommerceDraft>) => void }) {
    const { t } = useTranslation();
    const selected = normalizeCreativeOptions(draft);
    const constraint = commerceTextConstraint(draft);
    const allowsText = commerceAllowsText(draft);
    return (
        <section className="ecommerce-creative-options" aria-label={t("ecommerce.creativeOptions.label")}>
            <div className="ecommerce-creative-grid">
                {creativeControlFields.map((field) => (
                    <label className="ecommerce-field" key={field.key}>
                        <span>{ecommerceText(field.label)}</span>
                        <Select<string>
                            variant="filled"
                            aria-label={ecommerceText(field.label)}
                            value={!allowsText && field.key === "textMode" ? "none" : selected[field.key]}
                            options={field.options.map((option) => ({ ...option, label: ecommerceText(option.label) }))}
                            disabled={field.key === "textMode" ? Boolean(constraint) : !allowsText && commerceTextOnlyCreativeFields.has(field.key)}
                            onChange={(value) => onChange({ creativeOptions: { ...selected, [field.key]: value }, ...(field.key === "textMode" ? { noText: value === "none" } : {}) })}
                        />
                    </label>
                ))}
            </div>
            {!allowsText ? (
                <p className="ecommerce-creative-note">{constraint === "platform" ? t("ecommerce.creativeOptions.platformNoText") : constraint ? t("ecommerce.creativeOptions.typeNoText") : t("ecommerce.creativeOptions.noTextSelected")}</p>
            ) : null}
        </section>
    );
}
