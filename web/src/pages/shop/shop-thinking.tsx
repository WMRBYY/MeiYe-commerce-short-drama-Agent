import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import "./shop-thinking.css";

const CREATING_PHRASES = ["理解需求", "构思画面", "布光取景", "细节精修", "色彩校准", "即将完成"];

function useTicker(length: number, interval: number, active = true) {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        if (!active || length < 2) return;
        const timer = window.setInterval(() => setIndex((value) => (value + 1) % length), interval);
        return () => window.clearInterval(timer);
    }, [active, interval, length]);
    return index;
}

function useElapsed(since?: string | number) {
    const start = typeof since === "number" ? since : since ? Date.parse(since) : NaN;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return Number.isFinite(start) ? Math.max(0, Math.floor((Math.max(now, Date.now()) - start) / 1000)) : null;
}

function elapsedLabel(seconds: number | null) {
    if (seconds === null) return "";
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** 光球：外圈两道反向旋转的弧光 + 呼吸内核 + 绕行的小火花。 */
export function ShopOrb({ size = 46 }: { size?: number }) {
    const reduced = useReducedMotion();
    return (
        <span className="sk-orb" style={{ width: size, height: size, ["--sk-orbit" as string]: `${Math.round(size / 2) - 2}px` }} data-static={reduced || undefined} aria-hidden>
            <i className="sk-orb-ring" />
            <i className="sk-orb-ring is-back" />
            <i className="sk-orb-core" />
            <i className="sk-orb-spark" />
            <i className="sk-orb-spark is-2" />
        </span>
    );
}

/**
 * 作品创作中：生图 / 视频卡片里的占位动画（电商青柠绿极光 + 扫描线 + 光球 + 轮播状态词 + 进度）。
 * progress 有值时显示百分比和进度条；stage 是服务端阶段文案，没有时轮播通用状态词。
 */
export function ShopCreating({
    progress,
    stage,
    label = "作品创作中",
    since,
    compact,
    phrases = CREATING_PHRASES,
    tone,
}: {
    progress?: number | null;
    stage?: string;
    label?: string;
    since?: string | number;
    compact?: boolean;
    phrases?: string[];
    tone?: "wait";
}) {
    const reduced = useReducedMotion();
    const index = useTicker(phrases.length, 2200, !reduced && !stage);
    const elapsed = useElapsed(since);
    const hasProgress = typeof progress === "number" && Number.isFinite(progress) && progress > 0;
    const phrase = stage || phrases[index];
    return (
        <span className="sk-creating" data-compact={compact || undefined} data-tone={tone} role="status" aria-live="polite">
            <span className="sk-aurora" aria-hidden />
            <span className="sk-grid" aria-hidden />
            <span className="sk-scan" aria-hidden />
            <span className="sk-dust" aria-hidden>
                {Array.from({ length: compact ? 5 : 9 }, (_, i) => (
                    <i key={i} style={{ left: `${8 + ((i * 37) % 84)}%`, animationDelay: `${(i * 0.53) % 3.2}s`, animationDuration: `${3.2 + (i % 4) * 0.7}s` }} />
                ))}
            </span>
            <span className="sk-creating-body">
                <ShopOrb size={compact ? 34 : 48} />
                <strong className="sk-creating-label">
                    {label}
                    <span className="sk-dots" aria-hidden>
                        <i />
                        <i />
                        <i />
                    </span>
                </strong>
                <span className="sk-phrase-wrap">
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.small
                            key={phrase}
                            className="sk-phrase"
                            initial={reduced ? false : { opacity: 0, y: 6, filter: "blur(3px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
                            transition={{ duration: 0.32 }}
                        >
                            {phrase}
                            {hasProgress ? ` · ${Math.round(progress as number)}%` : elapsed !== null ? ` · ${elapsedLabel(elapsed)}` : ""}
                        </motion.small>
                    </AnimatePresence>
                </span>
            </span>
            <i className="sk-bar" data-indeterminate={!hasProgress || undefined} aria-hidden>
                {hasProgress ? <motion.b animate={{ width: `${Math.max(4, Math.min(100, progress as number))}%` }} transition={{ type: "spring", stiffness: 110, damping: 22 }} /> : <b />}
            </i>
        </span>
    );
}

export type ThinkingStep = { label: string; detail?: string };

export const COMMERCE_THINKING_STEPS: ThinkingStep[] = [
    { label: "读取商品图", detail: "识别主体、材质、颜色与包装" },
    { label: "提炼卖点", detail: "核对商品事实，筛选核心卖点" },
    { label: "匹配平台风格", detail: "按投放平台与市场确定视觉调性" },
    { label: "规划每一屏", detail: "构图、文案与画面逐屏成稿" },
    { label: "逐屏出图", detail: "每写完一屏立即开始生成" },
];

/**
 * 高级思考：Agent 分析 / 策划时的动画面板。光球 + 逐步点亮的思考链（每步打勾）+ 计时；
 * active 指定当前步（不传时按时间自动推进，但停在倒数第二步，等真实结果）。
 */
export function ShopThinking({
    title = "电商 Agent 深度思考中",
    steps = COMMERCE_THINKING_STEPS,
    active,
    since,
    note,
    compact,
    restoring,
}: {
    title?: string;
    steps?: ThinkingStep[];
    active?: number;
    since?: string | number;
    note?: string;
    compact?: boolean;
    restoring?: boolean;
}) {
    const reduced = useReducedMotion();
    const [mountedAt] = useState(() => Date.now());
    const elapsed = useElapsed(since ?? mountedAt);
    const auto = Math.min(steps.length - 2, Math.floor((elapsed || 0) / 7));
    const current = Math.max(0, Math.min(steps.length - 1, active ?? auto));
    return (
        <div className="sk-think" data-compact={compact || undefined} role="status" aria-live="polite">
            <span className="sk-aurora" aria-hidden />
            <header className="sk-think-head">
                <ShopOrb size={compact ? 30 : 38} />
                <span>
                    <strong className="sk-think-title">{title}</strong>
                    <small>
                        {restoring ? "正在同步任务进度" : `已思考 ${elapsedLabel(elapsed || 0)}`}
                        {note ? ` · ${note}` : ""}
                    </small>
                </span>
            </header>
            {!restoring && (
                <ol className="sk-steps">
                    {steps.map((step, index) => {
                        const state = index < current ? "done" : index === current ? "active" : "todo";
                        return (
                            <motion.li
                                key={step.label}
                                className="sk-step"
                                data-state={state}
                                initial={reduced ? false : { opacity: 0, x: -6 }}
                                animate={{ opacity: state === "todo" ? 0.45 : 1, x: 0 }}
                                transition={{ delay: reduced ? 0 : index * 0.06, duration: 0.3 }}
                            >
                                <span className="sk-step-dot">{state === "done" ? <Check className="size-3" strokeWidth={3} /> : null}</span>
                                <span className="sk-step-copy">
                                    <b>{step.label}</b>
                                    {step.detail && state !== "todo" ? <small>{step.detail}</small> : null}
                                </span>
                            </motion.li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
