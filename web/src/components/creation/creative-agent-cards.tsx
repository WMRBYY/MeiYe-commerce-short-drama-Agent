import { useId, useRef, useState } from "react";
import { Alert, Button, Checkbox, Dropdown, Input, Popover, Radio, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { RollingCreditText } from "@/components/rolling-credit-text";
import { translate } from "@/i18n";
import { validateCreativeAnswers, type CreativeAnswers, type CreativeAssetOption, type CreativePlan, type CreativeProposal, type CreativeQuestionRequest, type CreativeQuote } from "@/lib/creation/creative-agent-contract";
import "./creative-agent-cards.css";

export type CreativeQuestionCardProps = {
    request: CreativeQuestionRequest; answers: CreativeAnswers; onAnswersChange: (answers: CreativeAnswers) => void;
    onSubmit: (answers: CreativeAnswers) => void | Promise<void>; onModify?: () => void; assets: CreativeAssetOption[]; busy?: boolean; disabled?: boolean; error?: string;
};
export function CreativeQuestionCard({ request, answers, onAnswersChange, onSubmit, onModify, assets, busy, disabled, error }: CreativeQuestionCardProps) {
    const { t } = useTranslation();
    const [page, setPage] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const detailId = useId();
    const [localError, setLocalError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const currentPage = Math.min(page, Math.max(request.questions.length - 1, 0));
    const question = request.questions[currentPage];
    if (!question) return null;
    const answer = answers[question.id] ?? { selected: [], custom: "" };
    const locked = request.status !== "pending" || busy || disabled || submitting;
    const options = question.type === "asset" ? assets : question.options;
    const archived = request.status !== "pending";
    const summary = request.questions.map((item) => {
        const value = answers[item.id];
        const choices = item.type === "asset" ? assets : item.options;
        return value ? [...value.selected.map((id) => choices.find((option) => option.id === id)?.label ?? t("home.agentCards.assetUnavailable")), value.custom].filter(Boolean).join(t("home.agentCards.listSeparator")) : "";
    }).filter(Boolean).join(" · ") || t("home.agentCards.question.summaryFallback", { count: request.questions.length });
    const change = (patch: Partial<typeof answer>) => { setLocalError(""); onAnswersChange({ ...answers, [question.id]: { ...answer, ...patch } }); };
    const move = (index: number) => { setPage(index); requestAnimationFrame(() => headingRef.current?.focus()); };
    const submit = async () => {
        const invalid = validateCreativeAnswers(request, answers, assets);
        if (invalid) { setLocalError(invalid.message); move(request.questions.findIndex((item) => item.id === invalid.questionId)); return; }
        setSubmitting(true); setLocalError("");
        try { await onSubmit(answers); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : t("home.agentCards.submitFailed")); } finally { setSubmitting(false); }
    };
    return <section className="creative-agent-card creative-agent-question-card" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={t("home.agentCards.question.label")}>
        {archived && <div className="creative-agent-archive-row"><span className="creative-agent-archive-summary" title={summary}>{request.status === "submitted" ? t("home.agentCards.question.answered") : t("home.agentCards.question.updated")} · {summary}</span><Button type="text" size="small" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? t("home.agentCards.collapse") : t("home.agentCards.question.view")}</Button>{onModify && <Button type="text" size="small" disabled={busy} onClick={onModify}>{t("home.agentCards.modify")}</Button>}</div>}
        {(!archived || expanded) && <div id={detailId} className="creative-agent-card-content">
        <div className="creative-agent-card-row creative-agent-overline"><span>{t("home.agentCards.question.progress", { current: currentPage + 1, total: request.questions.length })}</span><span className="creative-agent-step-dots" aria-hidden="true">{request.questions.map((item, index) => <i key={item.id} data-current={index === currentPage} />)}</span></div>
        {request.status === "submitted" ? <Tag>{t("home.agentCards.question.submitted")}</Tag> : request.status === "superseded" ? <Tag>{t("home.agentCards.question.superseded")}</Tag> : null}
        <h3 ref={headingRef} tabIndex={-1}>{question.title}</h3>
        {question.description && <p className="creative-agent-muted">{question.description}</p>}
        <div className="creative-agent-options">
            {options.map((option) => <label className="creative-agent-option" key={option.id} data-selected={answer.selected.includes(option.id)} data-disabled={Boolean(locked)}>
                {question.type === "single" ? <Radio checked={answer.selected.includes(option.id)} disabled={locked} onChange={() => change({ selected: [option.id], custom: "" })} /> : <Checkbox checked={answer.selected.includes(option.id)} disabled={locked} onChange={(event) => change({ selected: event.target.checked ? [...answer.selected, option.id] : answer.selected.filter((id) => id !== option.id) })} />}
                <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            </label>)}
        </div>
        {question.type === "asset" && !assets.length && <p className="creative-agent-muted">{t("home.agentCards.question.noAssets")}</p>}
        {question.allowCustom && <label className="creative-agent-custom-answer"><span>{question.type === "text" ? t("home.agentCards.question.yourIdea") : t("home.agentCards.question.customHint")}</span><Input.TextArea aria-label={question.type === "text" ? question.title : t("home.agentCards.question.customLabel")} value={answer.custom} disabled={locked} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(event) => change({ custom: event.target.value, ...(question.type === "single" ? { selected: [] } : {}) })} placeholder={t("home.agentCards.question.customPlaceholder")} /></label>}
        {(error || localError) && <Alert type="error" title={error || localError} showIcon />}
        <div className="creative-agent-actions">
            <Button disabled={currentPage === 0} onClick={() => move(currentPage - 1)}>{t("home.agentCards.question.previous")}</Button>
            {currentPage < request.questions.length - 1 ? <Button type={archived ? "default" : "primary"} onClick={() => move(currentPage + 1)}>{t("home.agentCards.question.next")}</Button> : !archived && <Button type="primary" disabled={locked} loading={busy || submitting} onClick={() => void submit()}>{t("home.agentCards.question.submit")}</Button>}
            {!question.required && !locked && <Button type="text" onClick={() => { change({ selected: [], custom: "" }); if (currentPage < request.questions.length - 1) move(currentPage + 1); }}>{t("home.agentCards.question.skip")}</Button>}
        </div>
        {request.status === "submitted" && <p className="creative-agent-muted">{[...answer.selected.map((id) => options.find((option) => option.id === id)?.label ?? t("home.agentCards.assetUnavailable")), answer.custom].filter(Boolean).join(t("home.agentCards.listSeparator")) || t("home.agentCards.question.skipped")}</p>}
        </div>}
    </section>;
}

export type CreativeProposalCardProps = { proposal: CreativeProposal; onApprove: () => void; onModify: () => void; onRedirect: () => void; busy?: boolean; disabled?: boolean; archived?: boolean; modifiable?: boolean };
export function CreativeProposalCard({ proposal, onApprove, onModify, onRedirect, busy, disabled, archived, modifiable }: CreativeProposalCardProps) {
    const { t } = useTranslation();
    const [detailExpanded, setDetailExpanded] = useState(false);
    const [archivedExpanded, setArchivedExpanded] = useState(false);
    const expanded = archived ? archivedExpanded : detailExpanded;
    const setExpanded = archived ? setArchivedExpanded : setDetailExpanded;
    const detailId = useId();
    return <section className="creative-agent-card creative-agent-proposal-card" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={t("home.agentCards.proposal.label")}>
        {archived ? <div className="creative-agent-archive-row"><strong className="creative-agent-archive-summary" title={proposal.title}>{proposal.title} · v{proposal.version}</strong><Button type="text" size="small" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? t("home.agentCards.proposal.collapse") : t("home.agentCards.proposal.view")}</Button>{modifiable && <Button type="text" size="small" disabled={disabled || busy} onClick={onModify}>{t("home.agentCards.modify")}</Button>}</div> : <div className="creative-agent-card-row creative-agent-overline"><span>{t("home.agentCards.proposal.label")}</span><span>{t("home.agentCards.proposal.version", { version: proposal.version })}</span></div>}
        {(!archived || expanded) && <>
        <h3>{proposal.title}</h3>
        <p className="creative-agent-proposal-summary">{proposal.summary}</p>
        {proposal.deliverables.length > 0 && <ul className="creative-agent-deliverables">{proposal.deliverables.map((item, index) => <li key={index}><span>{t("home.agentCards.proposal.deliverable", { index: index + 1 })}</span><strong>{item}</strong></li>)}</ul>}
        {!archived && <Button className="creative-agent-detail-toggle" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? t("home.agentCards.proposal.collapseDetail") : t("home.agentCards.proposal.viewDetail")}</Button>}
        {expanded && <div id={detailId} className="creative-agent-detail"><AIMessageMarkdown>{proposal.markdown}</AIMessageMarkdown></div>}
        {!archived && <><div className="creative-agent-scope-note">{t("home.agentCards.proposal.scopeNote")}</div>
        <div className="creative-agent-actions creative-agent-primary-actions"><Button type="primary" loading={busy} disabled={disabled || busy} onClick={onApprove}>{t("home.agentCards.proposal.approve")}</Button><Button disabled={disabled || busy} onClick={onModify}>{t("home.agentCards.modify")}</Button><Dropdown menu={{ items: [{ key: "redirect", label: t("home.agentCards.proposal.redirect") }], onClick: onRedirect }} trigger={["click"]} disabled={disabled || busy}><Button disabled={disabled || busy}>{t("home.agentCards.proposal.more")}</Button></Dropdown></div></>}
        </>}
    </section>;
}

const stepLabels = {
    get pending() { return translate("home.agentCards.plan.status.pending"); },
    get running() { return translate("home.agentCards.plan.status.running"); },
    get waiting() { return translate("home.agentCards.plan.status.waiting"); },
    get completed() { return translate("home.agentCards.plan.status.completed"); },
    get failed() { return translate("home.agentCards.plan.status.failed"); },
    get cancelled() { return translate("home.agentCards.plan.status.cancelled"); },
};
export function CreativePlanBar({ plan, onLocateNode }: { plan?: CreativePlan | null; onLocateNode?: (nodeId: string) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const panelId = useId();
    if (!plan?.steps.length) return null;
    const completed = plan.steps.filter((step) => step.status === "completed").length;
    const running = plan.steps.filter((step) => step.status === "running").length;
    const current = plan.steps.find((step) => step.status === "running" || step.status === "waiting" || step.status === "failed");
    const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
    return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) trigger.current?.focus(); }} afterOpenChange={(next) => { if (next) panel.current?.focus(); }} placement="top" trigger="click" content={<div id={panelId} ref={panel} tabIndex={-1} className="creative-agent-plan" data-canvas-no-zoom data-canvas-wheel-scroll onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        <div className="creative-agent-card-row"><strong>{t("home.agentCards.plan.title")}</strong><Button size="small" onClick={close}>{t("home.agentCards.collapse")}</Button></div>
        <ol>{plan.steps.map((step) => <li key={step.id} data-status={step.status}><div className="creative-agent-card-row"><strong>{step.title}</strong><Tag>{stepLabels[step.status]}</Tag></div>{step.detail && <p>{step.detail}</p>}{onLocateNode && step.nodeIds?.map((id, index) => <Button key={id} type="link" onClick={() => onLocateNode(id)}>{t("home.agentCards.plan.locateNode", { index: index + 1 })}</Button>)}</li>)}</ol>
    </div>}><Button ref={trigger} className="creative-agent-plan-trigger" aria-label={t("home.agentCards.plan.view")} aria-expanded={open} aria-controls={panelId} onKeyDown={(event) => { if (event.key === "Escape") close(); }}><span className="creative-agent-plan-count">{completed}/{plan.steps.length}</span><span className="creative-agent-plan-current">{running > 1 ? t("home.agentCards.plan.running", { count: running }) : current ? current.title : completed === plan.steps.length ? t("home.agentCards.plan.completed") : t("home.agentCards.plan.view")}</span><span className="creative-agent-plan-chevron" aria-hidden="true">{open ? "⌄" : "⌃"}</span></Button></Popover>;
}

export function CreativeQuoteCard({ quote, onApprove, onRefresh, busy, disabled }: { quote: CreativeQuote; onApprove: () => void; onRefresh?: () => void; busy?: boolean; disabled?: boolean }) {
    const { t } = useTranslation();
    const quantity = quote.items.reduce((total, item) => total + item.quantity, 0);
    return <section className="creative-agent-card creative-agent-quote-card" aria-label={t("home.agentCards.quote.label")} data-canvas-no-zoom data-canvas-wheel-scroll>
        <div className="creative-agent-overline">{t("home.agentCards.quote.overline")}</div>
        <h3>{quote.title}</h3><div className="creative-agent-quote-total"><span>{t("home.agentCards.quote.total", { count: quantity })}</span><strong><RollingCreditText text={quote.amountLabel} /></strong></div>
        <details className="creative-agent-quote-details"><summary>{t("home.agentCards.quote.details")}</summary><div className="creative-agent-card-content"><ul className="creative-agent-quote-items">{quote.items.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span>{item.model} · {item.specification}</span></div><b>× {item.quantity}</b></li>)}</ul><p className="creative-agent-muted">{quote.basis}</p>
        {quote.expiresAt && <p>{t("home.agentCards.quote.expiresAt", { time: quote.expiresAt })}</p>}{quote.approvedQuantity !== undefined && <p>{t("home.agentCards.quote.approved", { count: quote.approvedQuantity })}</p>}
        {onRefresh && <Button className="creative-agent-detail-toggle" type="text" disabled={disabled || busy} onClick={onRefresh}>{t("home.agentCards.quote.refresh")}</Button>}</div></details>
        {quote.externalBilling && <p>{t("home.agentCards.quote.externalBilling")}</p>}
        <div className="creative-agent-actions creative-agent-primary-actions"><Button type="primary" loading={busy} disabled={disabled || busy} onClick={onApprove}>{t("home.agentCards.quote.confirm")} · <RollingCreditText text={quote.amountLabel} /></Button></div>
    </section>;
}
