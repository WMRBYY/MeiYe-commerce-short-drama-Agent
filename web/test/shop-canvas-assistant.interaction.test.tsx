import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
let saved = "";
let sentBody: Record<string, unknown> | undefined;
let handler: ((event: unknown) => void) | undefined;
let failOnce = false;
const submittedKeys: unknown[] = [];
mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: () => ({
        getItem: async () => null,
        setItem: async (_key: string, value: string) => {
            saved = value;
        },
    }),
}));
mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => "test-user" }));
mock.module("@/lib/canvas/cloud-agent-events", () => ({ upsertTextMessage: (messages: unknown[], id: string, text: string) => [...messages, { id, role: "assistant", text }] }));
mock.module("@/pages/ecommerce/admin-models", () => ({ useCommerceAdminModels: () => ({ planningModel: "shop-model", loaded: true, problem: "" }) }));
mock.module("@/stores/use-config-store", () => ({
    logicalModelIDForConfig: () => "logical-1",
    modelOptionName: () => "shop-model",
    resolveModelRequestConfig: () => ({}),
    selectableModelsByCapability: () => ["shop-model"],
    modelDisplayName: () => "商品策划",
}));
mock.module("@/services/api/agent", () => ({
    cancelAgentRun: async () => ({ accepted: true }),
    getAgentProfile: async () => ({ revision: "revision-1" }),
    createAgentRun: async (input: Record<string, unknown>) => {
        expect(JSON.parse(saved).pending.input.idempotencyKey).toBe(input.idempotencyKey);
        submittedKeys.push(input.idempotencyKey);
        if (failOnce) {
            failOnce = false;
            throw new Error("网络中断");
        }
        sentBody = input;
        return { run: { id: "run-1", status: "running", canvasId: "", permissionMode: "read_only" } };
    },
    sendAgentMessage: async () => {
        throw new Error("unexpected continuation");
    },
    subscribeAgentEvents: (_id: string, callback: (event: unknown) => void) => {
        handler = callback;
        return () => {};
    },
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ShopCanvasAssistant } = await import("../src/pages/shop/shop-canvas-assistant");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

test("未确认请求重试使用同一个幂等标识", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    submittedKeys.length = 0;
    failOnce = true;
    try {
        await act(async () => root.render(<ShopCanvasAssistant scope="test-user" config={{} as never} />));
        const area = host.querySelector("textarea")!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(area, "商品视觉方案");
            area.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
        });
        await act(async () => {
            host.querySelector<HTMLButtonElement>('button[aria-label="发送给电商助手"]')!.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(host.textContent).toContain("重试未确认的请求");
        await act(async () => {
            Array.from(host.querySelectorAll("button"))
                .find((button) => button.textContent?.includes("重试未确认"))!
                .click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(submittedKeys).toHaveLength(2);
        expect(submittedKeys[1]).toBe(submittedKeys[0]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("电商助手先保存请求再发送并显示真实流式回复", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<ShopCanvasAssistant scope="test-user" config={{} as never} />));
        const area = host.querySelector("textarea")!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(area, "规划商品主图");
            area.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
        });
        await act(async () => {
            host.querySelector<HTMLButtonElement>('button[aria-label="发送给电商助手"]')!.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(sentBody?.canvasId).toBe("");
        expect(sentBody?.permissionMode).toBe("read_only");
        expect(sentBody?.logicalModelId).toBe("logical-1");
        expect(sentBody?.pinnedSkillIds).toEqual([]);
        expect(handler).toBeDefined();
        await act(async () => handler?.({ runId: "run-1", seq: 1, eventId: "evt-1", type: "assistant_message", payload: { messageId: "answer-1", text: "突出商品材质" } }));
        expect(host.textContent).toContain("突出商品材质");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
