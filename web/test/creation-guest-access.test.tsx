import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://meiyeai.example/" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement, HTMLBodyElement: dom.HTMLBodyElement, HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot,
    Event: dom.Event, MouseEvent: dom.MouseEvent, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { useUserStore } = await import("../src/stores/use-user-store");
const { useCreationPreferencesStore } = await import("../src/stores/use-creation-preferences-store");
const { setActiveUserScope } = await import("../src/lib/user-scope");
const { http } = await import("../src/services/api/request");
const conversations = await import("../src/services/creation-conversation-store");
const workspace = await import("../src/pages/create/creation-workspace");
const discovery = await import("../src/pages/create/creation-skill-discovery");
const loginDialog = await import("../src/pages/create/creation-login-dialog");
const inspirations = await import("../src/pages/inspirations");
const { default: CreatePage } = await import("../src/pages/create/index");

const originalUser = useUserStore.getState();
const originalPreferences = useCreationPreferencesStore.getState();
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let privateReads: string[] = [];
let apiCalls: string[] = [];

async function render() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(<App><MemoryRouter><CreatePage /></MemoryRouter></App>); });
}

async function unmount() {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    host?.remove();
}

async function press(label: string) {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
}

beforeEach(() => {
    privateReads = [];
    apiCalls = [];
    window.sessionStorage.clear();
    setActiveUserScope(null);
    useUserStore.setState({ user: null, hydrated: true });
    useCreationPreferencesStore.setState({ hydrated: true, preferences: {} });
    spyOn(conversations, "loadCreationConversations").mockImplementation(async () => { privateReads.push("history"); return null; });
    spyOn(conversations, "saveCreationConversations").mockImplementation(async () => { privateReads.push("save-history"); });
    for (const method of ["get", "post", "put"] as const) {
        spyOn(http, method).mockImplementation((async (path: string) => { apiCalls.push(`${method} ${path}`); throw new Error("Unexpected private API"); }) as typeof http[typeof method]);
    }
    // Exercise the real page lifecycle and guards without media rendering or model pricing requests.
    spyOn(workspace, "CreationComposer").mockImplementation((props) => <div>
        <textarea aria-label="测试提示词" value={props.prompt} onInput={(event) => props.setPrompt(event.currentTarget.value)} onFocus={props.onPromptFocus} />
        <button aria-label="发送创作" onClick={props.onSubmit}>发送</button>
        <button aria-label="打开素材库" onClick={props.onOpenLibrary}>素材库</button>
        <button aria-label="替换参考图片" onClick={() => void props.onReplaceReferenceFiles("reference", [new File(["image"], "reference.png", { type: "image/png" })])}>替换</button>
    </div>);
    spyOn(workspace, "CreationModeTabs").mockImplementation((props) => <button aria-label="进入 Agent" onClick={props.onAgentSelect}>Agent</button>);
    spyOn(workspace, "CreationHistoryDrawer").mockImplementation(() => null);
    spyOn(discovery, "CreationSkillDiscovery").mockImplementation(() => null);
    spyOn(loginDialog, "CreationLoginDialog").mockImplementation(({ open, onClose }) => open ? <div role="dialog"><button aria-label="关闭登录" onClick={onClose}>关闭</button></div> : null);
    spyOn(inspirations, "default").mockImplementation(() => <section>公开精选作品</section>);
});

afterEach(async () => {
    await unmount();
    mock.restore();
    useUserStore.setState(originalUser);
    useCreationPreferencesStore.setState(originalPreferences);
    window.sessionStorage.clear();
    setActiveUserScope(null);
});

afterAll(() => {
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.happyDOM.abort();
});

describe("public creation homepage", () => {
    test("anonymous browsing and prompt focus never read private history or skills", async () => {
        await render();
        expect(host.textContent).toContain("公开精选作品");
        const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="测试提示词"]')!;
        await act(async () => input.focus());
        expect(privateReads).toEqual([]);
        expect(apiCalls).toEqual([]);
    });

    test("history, library, reference uploads, Agent and generation open login before private work", async () => {
        await render();
        const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="测试提示词"]')!;
        await act(async () => { input.value = "保留我的产品海报想法"; input.dispatchEvent(new Event("input", { bubbles: true })); });
        for (const label of ["查看历史对话", "打开素材库", "替换参考图片", "进入 Agent", "发送创作"]) {
            await press(label);
            expect(host.querySelector('[role="dialog"]')).not.toBeNull();
            expect(input.value).toBe("保留我的产品海报想法");
            await press("关闭登录");
        }
        expect(privateReads).toEqual([]);
        expect(apiCalls).toEqual([]);
    });

    test("the anonymous prompt survives the session hydration unmount and is consumed after login", async () => {
        await render();
        const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="测试提示词"]')!;
        await act(async () => { input.value = "一张留白的香水海报"; input.dispatchEvent(new Event("input", { bubbles: true })); });
        await unmount();
        setActiveUserScope("guest-login-test");
        useUserStore.setState({ user: { id: "guest-login-test", username: "test", displayName: "Test", role: "user", status: "active" }, hydrated: true });
        await render();
        expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="测试提示词"]')!.value).toBe("一张留白的香水海报");
        expect(window.sessionStorage.getItem("meiye:guest-creation-draft")).toBeNull();
        expect(privateReads).toContain("history");
        expect(apiCalls).toEqual([]);
    });

    test("dropping local images and pasting remote images cannot upload or import while anonymous", async () => {
        await render();
        const page = host.querySelector<HTMLElement>(".creation-home")!;
        for (const [eventName, property, transfer] of [
            ["drop", "dataTransfer", { files: [new File(["image"], "product.png", { type: "image/png" })], items: [], getData: () => "" }],
            ["paste", "clipboardData", { files: [], items: [], getData: (type: string) => type === "text/uri-list" ? "https://assets.example/product.png" : "" }],
        ] as const) {
            const event = new Event(eventName, { bubbles: true, cancelable: true });
            Object.defineProperty(event, property, { value: transfer });
            await act(async () => page.dispatchEvent(event));
            expect(host.querySelector('[role="dialog"]')).not.toBeNull();
            await press("关闭登录");
        }
        expect(privateReads).toEqual([]);
        expect(apiCalls).toEqual([]);
    });
});
