import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentLauncher } = await import("../src/components/canvas/canvas-cloud-agent-panel-parts");
const { canvasThemes } = await import("../src/lib/canvas-theme");
const { AGENT_LAUNCHER_POSITION_KEY } = await import("../src/lib/canvas/agent-launcher-position");
const { useAppearanceStore } = await import("../src/stores/use-appearance-store");
const { useGlobalAgentStore } = await import("../src/stores/use-global-agent-store");

const minimizedKey = "canvas-agent-launcher:minimized";
// 只比较样式规则本身，不受 Prettier 换行、空格和末尾分号影响。
const compactCss = (css: string) => css.replace(/\s+/g, "").replace(/;}/g, "}");
const launcherStyles = compactCss(readFileSync(new URL("../src/components/layout/yoru-widget.css", import.meta.url), "utf8"));
const savedPosition = { right: 180, bottom: 160 };

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function launcherFixture({ minimized = true, approvalPending = false } = {}) {
    const previousAgent = useGlobalAgentStore.getState();
    const previousAppearance = useAppearanceStore.getState();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let opens = 0;
    let bubbledClicks = 0;
    localStorage.clear();
    if (minimized) localStorage.setItem(minimizedKey, "1");
    localStorage.setItem(AGENT_LAUNCHER_POSITION_KEY, JSON.stringify(savedPosition));
    useGlobalAgentStore.getState().reset();
    useAppearanceStore.setState({ appearance: { ...previousAppearance.appearance, canvas: { ...previousAppearance.appearance.canvas, agentName: "小夜" } } });

    function LauncherHost() {
        const open = useGlobalAgentStore((state) => state.open);
        return (
            <div onClick={() => bubbledClicks++}>
                <AgentLauncher
                    theme={canvasThemes.dark}
                    statusColor={canvasThemes.dark.accent.primary}
                    approvalPending={approvalPending}
                    reducedMotion
                    status={approvalPending ? "waiting_approval" : "idle"}
                    hidden={open}
                    onOpen={() => {
                        opens++;
                        useGlobalAgentStore.getState().openAgent();
                    }}
                />
            </div>
        );
    }
    const render = () => act(async () => root.render(<LauncherHost />));
    const button = (selector: string) => {
        const element = host.querySelector<HTMLButtonElement>(selector);
        if (!element) throw new Error(`缺少入口按钮：${selector}`);
        return element;
    };
    const dispose = async () => {
        await act(async () => root.unmount());
        host.remove();
        useGlobalAgentStore.setState(previousAgent);
        useAppearanceStore.setState(previousAppearance);
        localStorage.clear();
    };
    try {
        await render();
        return {
            host,
            button,
            orb: () => button(".canvas-agent-orb-launcher__trigger"),
            expand: () => button(".canvas-agent-orb-launcher__expand"),
            avatar: () => button(".canvas-agent-launcher"),
            opens: () => opens,
            bubbledClicks: () => bubbledClicks,
            close: () => act(async () => useGlobalAgentStore.getState().closeAgent()),
            remount: async () => {
                await act(async () => root.render(null));
                await render();
            },
            dispose,
        };
    } catch (error) {
        await dispose();
        throw error;
    }
}

const click = (button: HTMLButtonElement, detail = 1) =>
    act(async () => {
        button.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, cancelable: true, detail }));
    });

function pointerControl(button: HTMLButtonElement, pointerType = "mouse") {
    let captured: number | null = null;
    button.setPointerCapture = (id) => {
        captured = id;
    };
    button.hasPointerCapture = (id) => captured === id;
    button.releasePointerCapture = () => {
        captured = null;
    };
    return {
        captured: () => captured,
        fire: (type: string, clientX = 500, clientY = 500) =>
            act(async () => {
                button.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, pointerType, clientX, clientY }));
            }),
    };
}

test("助手入口和形象放大按钮不复用小夜缩小/恢复样式", async () => {
    const fixture = await launcherFixture();
    try {
        expect(fixture.host.querySelector(".canvas-agent-orb-launcher")).not.toBeNull();
        expect(fixture.orb().className).toContain("canvas-agent-orb-launcher__trigger");
        expect(fixture.expand().className).toContain("canvas-agent-orb-launcher__expand");
        expect(fixture.host.querySelector(".yoru-restore, .yoru-hide, .yoru-expand, .yoru-compact-launcher")).toBeNull();
        expect(fixture.expand().previousElementSibling).toBe(fixture.orb());
        expect(launcherStyles).toContain(compactCss(".canvas-agent-orb-launcher__trigger{"));
        expect(launcherStyles).toContain(compactCss(".canvas-agent-orb-launcher__expand{"));
        expect(launcherStyles).toContain(compactCss(".canvas-agent-orb-launcher:focus-within .canvas-agent-orb-launcher__expand"));
        expect(launcherStyles).toContain(compactCss("@media(hover:none),(pointer:coarse){.canvas-agent-orb-launcher__expand{opacity:1;pointer-events:auto}}"));
        expect(launcherStyles).toContain(compactCss("@media(prefers-reduced-motion:reduce){.canvas-agent-orb-launcher__trigger,.canvas-agent-orb-launcher__label,.canvas-agent-orb-launcher__expand{transition:none}}"));
        expect(launcherStyles).toContain(compactCss(".canvas-agent-orb-launcher{visibility:hidden}"));
        expect(launcherStyles).toContain(compactCss(".canvas-agent-orb-launcher{position:fixed;"));
        expect(launcherStyles).toContain(compactCss("pointer-events:none"));
        expect(launcherStyles).toContain(compactCss(".canvas-agent-orb-launcher__trigger{pointer-events:auto;"));
        expect(launcherStyles).toContain(compactCss(".canvas-agent-orb-launcher__expand{position:relative;"));
        expect(launcherStyles).toContain(compactCss("@media(max-width:640px){.canvas-agent-orb-launcher{right:10px!important;bottom:76px!important;}}"));
    } finally {
        await fixture.dispose();
    }
});

for (const approvalPending of [false, true]) {
    test(`${approvalPending ? "待审批" : "空闲"}光球直接打开画布助手，关闭后仍为光球`, async () => {
        const fixture = await launcherFixture({ approvalPending });
        try {
            const orb = fixture.orb();
            expect(orb.getAttribute("aria-label")).toBe("打开画布 Agent 助手");
            expect(orb.textContent).toBe(approvalPending ? "待审批" : "Agent 助手");
            expect(orb.closest(".canvas-agent-orb-launcher[data-canvas-no-zoom]")).not.toBeNull();
            expect(fixture.host.querySelectorAll("[data-canvas-no-zoom]")).toHaveLength(1);
            expect(fixture.expand().parentElement).toBe(orb.parentElement);
            expect(orb.contains(fixture.expand())).toBe(false);
            await click(orb);
            expect(useGlobalAgentStore.getState().open).toBe(true);
            expect(fixture.opens()).toBe(1);
            expect(fixture.bubbledClicks()).toBe(0);
            expect(localStorage.getItem(minimizedKey)).toBe("1");
            expect(fixture.host.querySelector(".canvas-agent-orb-launcher")).toBeNull();
            expect(fixture.host.querySelector(".canvas-agent-launcher")).toBeNull();
            await fixture.close();
            expect(fixture.orb().classList.contains("is-pending")).toBe(approvalPending);
            expect(fixture.host.querySelector(".canvas-agent-launcher")).toBeNull();
            expect(localStorage.getItem(minimizedKey)).toBe("1");
        } finally {
            await fixture.dispose();
        }
    });
}

test("仅独立放大按钮恢复小夜形象，不打开助手且保持原位置", async () => {
    const fixture = await launcherFixture();
    try {
        expect(fixture.expand().getAttribute("aria-label")).toBe("放大小夜形象");
        await click(fixture.expand());
        expect(fixture.opens()).toBe(0);
        expect(fixture.bubbledClicks()).toBe(0);
        expect(useGlobalAgentStore.getState().open).toBe(false);
        expect(localStorage.getItem(minimizedKey)).toBeNull();
        expect(fixture.host.querySelector(".canvas-agent-orb-launcher")).toBeNull();
        expect(fixture.avatar().style.right).toBe(`${savedPosition.right}px`);
        expect(fixture.avatar().style.bottom).toBe(`${savedPosition.bottom}px`);
        await fixture.remount();
        expect(fixture.host.querySelector(".canvas-agent-orb-launcher__trigger")).toBeNull();
        expect(fixture.avatar()).not.toBeNull();
    } finally {
        await fixture.dispose();
    }
});

test("完整形象缩小后保存偏好，重新挂载仍可直接打开助手", async () => {
    const fixture = await launcherFixture({ minimized: false });
    try {
        await act(async () => fixture.avatar().focus());
        await click(fixture.button('[aria-label="缩小小夜"]'));
        expect(localStorage.getItem(minimizedKey)).toBe("1");
        expect(fixture.opens()).toBe(0);
        expect(fixture.orb()).not.toBeNull();
        await fixture.remount();
        expect(fixture.host.querySelector(".canvas-agent-launcher")).toBeNull();
        await click(fixture.orb());
        expect(fixture.opens()).toBe(1);
        expect(useGlobalAgentStore.getState().open).toBe(true);
    } finally {
        await fixture.dispose();
    }
});

test("键盘焦点显示放大入口，两个按钮的辅助激活职责独立", async () => {
    const fixture = await launcherFixture();
    try {
        await act(async () => fixture.orb().focus());
        expect(fixture.host.querySelector(".canvas-agent-orb-launcher")?.classList.contains("is-hovered")).toBe(true);
        await click(fixture.orb(), 0);
        expect(fixture.opens()).toBe(1);
        expect(localStorage.getItem(minimizedKey)).toBe("1");
        await fixture.close();
        await act(async () => fixture.expand().focus());
        expect(document.activeElement).toBe(fixture.expand());
        await click(fixture.expand(), 0);
        expect(fixture.opens()).toBe(1);
        expect(useGlobalAgentStore.getState().open).toBe(false);
        expect(fixture.avatar()).not.toBeNull();
        expect(fixture.avatar().style.right).toBe(`${savedPosition.right}px`);
        expect(fixture.avatar().style.bottom).toBe(`${savedPosition.bottom}px`);
    } finally {
        await fixture.dispose();
    }
});

for (const pointerType of ["mouse", "touch"]) {
    test(`${pointerType === "mouse" ? "鼠标" : "触屏"}拖动光球只调整位置，松手不打开助手或恢复形象`, async () => {
        const fixture = await launcherFixture();
        try {
            const pointer = pointerControl(fixture.orb(), pointerType);
            await pointer.fire("pointerdown");
            await pointer.fire("pointermove", 400, 450);
            expect(fixture.host.querySelector(".canvas-agent-orb-launcher")?.classList.contains("is-dragging")).toBe(true);
            await pointer.fire("pointerup", 400, 450);
            await click(fixture.orb());
            expect(pointer.captured()).toBeNull();
            expect(fixture.opens()).toBe(0);
            expect(localStorage.getItem(minimizedKey)).toBe("1");
            expect(JSON.parse(localStorage.getItem(AGENT_LAUNCHER_POSITION_KEY)!)).toEqual({ right: 280, bottom: 210 });
            expect(fixture.host.querySelector(".canvas-agent-launcher")).toBeNull();
            await click(fixture.expand());
            expect(fixture.avatar().style.right).toBe("280px");
            expect(fixture.avatar().style.bottom).toBe("210px");
            expect(fixture.opens()).toBe(0);
        } finally {
            await fixture.dispose();
        }
    });
}

test("光球取消手势不触发打开，下一次正常点击仍可打开助手", async () => {
    const fixture = await launcherFixture();
    try {
        const pointer = pointerControl(fixture.orb());
        await pointer.fire("pointerdown");
        await pointer.fire("pointercancel");
        await click(fixture.orb());
        expect(fixture.opens()).toBe(0);
        await pointer.fire("pointerdown");
        await pointer.fire("pointerup");
        await click(fixture.orb());
        expect(fixture.opens()).toBe(1);
        expect(localStorage.getItem(minimizedKey)).toBe("1");
    } finally {
        await fixture.dispose();
    }
});

test("光球方向键移动与放大操作互不干扰", async () => {
    const fixture = await launcherFixture();
    try {
        await act(async () => fixture.orb().dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })));
        await act(async () => fixture.orb().dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp", shiftKey: true })));
        expect(fixture.opens()).toBe(0);
        expect(JSON.parse(localStorage.getItem(AGENT_LAUNCHER_POSITION_KEY)!)).toEqual({ right: 190, bottom: 200 });
        await act(async () => fixture.expand().dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })));
        expect(JSON.parse(localStorage.getItem(AGENT_LAUNCHER_POSITION_KEY)!)).toEqual({ right: 190, bottom: 200 });
        await click(fixture.expand(), 0);
        expect(fixture.avatar().style.right).toBe("190px");
        expect(fixture.avatar().style.bottom).toBe("200px");
        expect(fixture.opens()).toBe(0);
    } finally {
        await fixture.dispose();
    }
});
