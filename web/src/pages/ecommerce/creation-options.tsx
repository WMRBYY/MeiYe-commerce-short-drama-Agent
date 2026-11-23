import { Input, Select } from "antd";
import { useTranslation } from "react-i18next";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { ecommerceText } from "./display-text";
import { creationOptions } from "./type-config";

export function CreationOptions({ draft, onChange, className = "ecommerce-field" }: { draft: EcommerceDraft; onChange: (value: Record<string, string>) => void; className?: string }) {
    const { t } = useTranslation();
    return (
        <div className="ecommerce-creation-options" aria-label={t("ecommerce.creationOptions.label")}>
            {(creationOptions[draft.imageType] || []).map((item) => (
                <label className={className} key={item.key}>
                    <span>
                        {ecommerceText(item.label)}
                        {item.required ? ` · ${t("ecommerce.creationOptions.required")}` : ""}
                    </span>
                    {item.choices ? (
                        <Select
                            aria-label={ecommerceText(item.label)}
                            allowClear
                            placeholder={t("ecommerce.creationOptions.agentPlaceholder")}
                            value={draft.typeOptions?.[item.key] || undefined}
                            options={item.choices.map((value) => ({ value, label: ecommerceText(value) }))}
                            onChange={(value) => onChange({ ...draft.typeOptions, [item.key]: value || "" })}
                        />
                    ) : (
                        <Input.TextArea rows={2} value={draft.typeOptions?.[item.key] || ""} placeholder={item.placeholder ? ecommerceText(item.placeholder) : item.placeholder} onChange={(event) => onChange({ ...draft.typeOptions, [item.key]: event.target.value })} />
                    )}
                </label>
            ))}
        </div>
    );
}
