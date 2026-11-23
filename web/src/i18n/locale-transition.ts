import { flushSync } from "react-dom";

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

const TRANSITION_CLASS = "app-locale-transition";
const REFRESH_CLASS = "app-locale-refresh";
const REFRESH_MS = 240;

let refreshTimer = 0;

/**
 * 切换界面语言：点击后立即同步提交新语言的渲染（flushSync），不等待任何动画或额外帧；
 * 过渡只是叠加在已经换好的画面上的短暂淡入（样式见 language-menu.css），不会推迟切换。
 * 支持 View Transitions 时做约 0.2 秒的交叉淡入；不支持时内容区快速淡入；系统开启「减少动态效果」时不做动画。
 */
export function runLocaleTransition(apply: () => void) {
    const commit = () => flushSync(apply);
    if (typeof window === "undefined" || typeof document === "undefined") {
        apply();
        return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        commit();
        return;
    }
    const root = document.documentElement;
    const doc = document as ViewTransitionDocument;
    if (typeof doc.startViewTransition === "function") {
        root.classList.add(TRANSITION_CLASS);
        // 新的过渡会让浏览器跳过上一次未结束的过渡，连续点击始终以最后一次为准。
        doc.startViewTransition(commit).finished.finally(() => root.classList.remove(TRANSITION_CLASS));
        return;
    }
    commit();
    root.classList.remove(REFRESH_CLASS);
    void root.offsetWidth; // 重新触发淡入动画
    root.classList.add(REFRESH_CLASS);
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => root.classList.remove(REFRESH_CLASS), REFRESH_MS);
}
