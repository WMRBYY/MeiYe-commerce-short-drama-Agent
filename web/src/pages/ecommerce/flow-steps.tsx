import { useTranslation } from "react-i18next";
import type { CommerceFlowStep } from "./flow";

export function CommerceFlowSteps({ steps, restoring }: { steps: CommerceFlowStep[]; restoring: boolean }) {
    const { t } = useTranslation();
    const index = steps.findIndex((step) => step.status === "current");
    const current = steps[index];
    if (!current) return null;

    const analyzing = current.running && (current.key === "direction" || current.key === "plan");
    const label = restoring ? "恢复项目" : analyzing ? (current.key === "direction" ? "分析商品" : "策划图片") : current.label;
    const detail = restoring ? "正在恢复商品创作" : current.detail;
    const active = restoring || current.running;

    return (
        <div className="commerce-flow" role="status" aria-label={t("ecommerce.flowSteps.label")} data-step={current.key} data-running={active}>
            <span className="sr-only">{`${index + 1} / ${steps.length} · ${label} · ${detail}`}</span>
            <span className="commerce-flow-count" aria-hidden="true">
                <strong>{String(index + 1).padStart(2, "0")}</strong> / {String(steps.length).padStart(2, "0")}
            </span>
            <span className="commerce-flow-track" aria-hidden="true">
                {steps.map((step) => (
                    <span key={step.key} data-status={step.status} />
                ))}
            </span>
            <div className="commerce-flow-window" aria-hidden="true" title={detail}>
                <div className="commerce-flow-line" key={`${current.key}-${label}`}>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                </div>
            </div>
        </div>
    );
}
