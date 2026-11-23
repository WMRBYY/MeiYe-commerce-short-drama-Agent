import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { RollingCreditAmount } = await import("../src/components/rolling-credit-text");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("积分变化时滚动数字，重复渲染同一金额不重启动画", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<RollingCreditAmount value={12} />));
    expect(host.querySelector(".sr-only")?.textContent).toBe("12");
    expect(host.querySelectorAll(".rolling-credit-digit")).toHaveLength(0);

    await act(async () => root.render(<RollingCreditAmount value={27} />));
    expect(host.querySelector(".sr-only")?.textContent).toBe("27");
    expect(Array.from(host.querySelectorAll(".rolling-credit-digit-new"), (node) => node.textContent)).toEqual(["2", "7"]);
    const firstDigit = host.querySelector(".rolling-credit-digit");

    await act(async () => root.render(<RollingCreditAmount value={27} />));
    expect(host.querySelector(".rolling-credit-digit")).toBe(firstDigit);

    await act(async () => root.render(<RollingCreditAmount value={null} />));
    expect(host.querySelector(".rolling-credit-text")?.hasAttribute("hidden")).toBe(true);
    await act(async () => root.render(<RollingCreditAmount value={35} />));
    expect(host.querySelector(".sr-only")?.textContent).toBe("35");
    expect(host.querySelectorAll(".rolling-credit-digit")).toHaveLength(2);
    await act(async () => root.unmount());
});

test("减少动态效果时直接展示新积分", async () => {
    Object.defineProperty(dom, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<RollingCreditAmount value={1} />));
    await act(async () => root.render(<RollingCreditAmount value={9} />));
    expect(host.querySelector(".sr-only")?.textContent).toBe("9");
    expect(host.querySelectorAll(".rolling-credit-digit")).toHaveLength(0);
    await act(async () => root.unmount());
});
