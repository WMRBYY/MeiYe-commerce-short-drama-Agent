import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GenerationTask } from "@/services/api/task-center";
import "./planning-activity.css";
import "./loading.css";

export function PlanningActivity({ task, references, count, automaticScreens = false }: { task?: GenerationTask; references: number; count: number; automaticScreens?: boolean }) {
    const { t } = useTranslation();
    const [openedAt] = useState(Date.now);
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const started = Date.parse(task?.startedAt || task?.createdAt || "") || openedAt;
    const seconds = Math.max(0, Math.floor((now - started) / 1000));
    const status = !task ? t("ecommerce.planning.submitting") : task.status === "queued" ? t("ecommerce.planning.queued") : task.status === "succeeded" ? t("ecommerce.planning.validating") : t("ecommerce.planning.analyzing");
    return (
        <section className="commerce-planning-activity" aria-label={t("ecommerce.planning.label")} aria-busy="true" role="status">
            <div className="commerce-planning-emblem" aria-hidden="true">
                <span />
                <Sparkles size={24} strokeWidth={1.5} />
            </div>
            <div className="commerce-planning-title">
                <strong>{status}</strong>
                <span>{seconds >= 60 ? t("ecommerce.planning.elapsedMinutes", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }) : t("ecommerce.planning.elapsedSeconds", { seconds })}</span>
            </div>
            <p>{t("ecommerce.planning.intro")}</p>
            <ol>
                <li>
                    <Check size={14} />
                    <div>
                        <strong>{t("ecommerce.planning.materials")}</strong>
                        <small>
                            {t("ecommerce.planning.references", { count: references })} · {automaticScreens ? t("ecommerce.planning.autoScreens") : t("ecommerce.planning.imagePlans", { count })}
                        </small>
                    </div>
                </li>
                <li>
                    <LoaderCircle className="commerce-planning-spin" size={14} />
                    <div>
                        <strong>{task?.status === "succeeded" ? t("ecommerce.planning.checkStructure") : t("ecommerce.planning.understand")}</strong>
                        <small>{task?.status === "queued" ? t("ecommerce.planning.queuedDetail") : task?.textDraft ? t("ecommerce.planning.received", { count: task.textDraft.length }) : t("ecommerce.planning.waiting")}</small>
                    </div>
                </li>
                <li className="is-pending">
                    <span className="commerce-planning-dot" />
                    <div>
                        <strong>{t("ecommerce.planning.review")}</strong>
                        <small>{t("ecommerce.planning.reviewDetail")}</small>
                    </div>
                </li>
            </ol>
            <small className="commerce-planning-footnote">{t("ecommerce.planning.footnote")}</small>
        </section>
    );
}
