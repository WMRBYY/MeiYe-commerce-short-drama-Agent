import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://meiyeai.example/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, HTMLBodyElement: dom.HTMLBodyElement, HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot,
    Event: dom.Event, MouseEvent: dom.MouseEvent, CustomEvent: dom.CustomEvent, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { WorkspaceWalletHost } = await import("../src/components/layout/workspace-wallet-modal");
const { WorkspaceCommandPalette } = await import("../src/components/layout/workspace-command-palette");
const { openWorkspaceWallet } = await import("../src/lib/workspace-wallet");
const { useUserStore } = await import("../src/stores/use-user-store");
const { useLoginDialogStore } = await import("../src/stores/use-login-dialog-store");
const walletApi = await import("../src/services/api/wallet");
const paymentApi = await import("../src/services/api/payments");
const originalUser = useUserStore.getState();
const originalDialog = useLoginDialogStore.getState();
const calls: string[] = [];
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;

beforeEach(() => {
    calls.length = 0;
    useUserStore.setState({ user: null, hydrated: true, features: { ...originalUser.features, creditsEnabled: true } });
    useLoginDialogStore.setState({ open: false, next: "/" });
    spyOn(walletApi, "getWallet").mockImplementation(async () => {
        calls.push("wallet");
        return { account: { userId: "wallet-test", availableMicrocredits: 0, reservedMicrocredits: 0, version: 1, createdAt: "", updatedAt: "" }, entries: [], total: 0, page: 1, pageSize: 20,
            policy: { signupBonusMicrocredits: 0, checkinBonusMicrocredits: 0, checkedInToday: false, pendingMicrocredits: 0, oldestExpiresAt: null, nextRefreshAt: "" } };
    });
    spyOn(paymentApi, "listTopupProducts").mockImplementation(async () => { calls.push("products"); return { products: [] }; });
    spyOn(paymentApi, "listPaymentProviders").mockImplementation(async () => { calls.push("providers"); return { providers: [] }; });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

describe("wallet recharge history", () => {
    const account = { userId: "wallet-test", availableMicrocredits: 7_000_000, reservedMicrocredits: 0, version: 1, createdAt: "", updatedAt: "" };
    const policy = { signupBonusMicrocredits: 0, checkinBonusMicrocredits: 0, checkedInToday: false, pendingMicrocredits: 0, oldestExpiresAt: null, nextRefreshAt: "" };
    const requests: Array<[number, string]> = [];
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    test("shows online and redeemed credits and requests server-filtered pages", async () => {
        requests.length = 0;
        spyOn(walletApi, "getWallet").mockImplementation(async (page = 1, pageSize = 20, type = "all") => {
            requests.push([page, type]);
            return { account, policy, total: type === "topup" ? 21 : 0, page, pageSize, entries: type !== "topup" ? [] : [{
                id: `entry-${page}`, userId: account.userId, type: page === 1 ? "payment_topup" as const : "redeem" as const,
                amountMicrocredits: 5_000_000, availableAfterMicrocredits: 7_000_000, reservedAfterMicrocredits: 0,
                paymentOrderId: page === 1 ? "payment-123" : undefined, createdAt: "2026-11-02T10:00:00Z",
            }] };
        });
        useUserStore.setState({ user: { id: account.userId, username: "test", displayName: "Test", role: "user", status: "active" } });
        await render();
        await act(async () => openWorkspaceWallet());
        const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent?.includes("充值记录"));
        expect(tab).toBeDefined();
        await act(async () => tab!.click());
        await settle();
        expect(requests).toContainEqual([1, "topup"]);
        expect(document.body.textContent).toContain("在线充值");
        expect(document.body.textContent).toContain("关联订单：payment-123");
        expect(document.body.textContent).toContain("到账后可用积分 7");
        await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="充值记录下一页"]')!.click());
        await settle();
        expect(requests).toContainEqual([2, "topup"]);
        expect(document.body.textContent).toContain("兑换码充值");
        expect(document.body.textContent).not.toContain("payment-123");
        expect(document.querySelector<HTMLButtonElement>('[aria-label="充值记录下一页"]')!.disabled).toBe(true);
        await act(async () => useUserStore.setState({ user: null }));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.body.textContent).not.toContain("兑换码充值");
    });

    test("loads an empty history without displaying other wallet entries", async () => {
        useUserStore.setState({ user: { id: "empty-user", username: "empty", displayName: "Empty", role: "user", status: "active" } });
        await render();
        await act(async () => openWorkspaceWallet({ tab: "recharge-history" }));
        await settle();
        expect(document.body.textContent).toContain("还没有充值记录");
        expect(document.querySelector<HTMLButtonElement>('[aria-label="充值记录上一页"]')!.disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>('[aria-label="充值记录下一页"]')!.disabled).toBe(true);
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    mock.restore();
    useUserStore.setState(originalUser);
    useLoginDialogStore.setState(originalDialog);
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render(palette = false, initialPath = "/") {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={queryClient}><App><MemoryRouter initialEntries={[initialPath]}>
        <WorkspaceWalletHost />
        {palette ? <WorkspaceCommandPalette open onClose={() => {}} /> : null}
    </MemoryRouter></App></QueryClientProvider>));
}

describe("wallet access from the public homepage", () => {
    test("a wallet link waits for session restoration before opening", async () => {
        useUserStore.setState({ hydrated: false });
        await render(false, "/wallet");
        expect(useLoginDialogStore.getState().open).toBe(false);
        expect(calls).toEqual([]);
        await act(async () => useUserStore.setState({
            hydrated: true,
            user: { id: "wallet-test", username: "test", displayName: "Test", role: "user", status: "active" },
        }));
        expect(useLoginDialogStore.getState().open).toBe(false);
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(calls).toContain("wallet");
    });

    test("the command palette opens login instead of fetching an anonymous wallet", async () => {
        await render(true);
        const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "积分中心");
        expect(button).toBeDefined();
        await act(async () => button!.click());
        expect(useLoginDialogStore.getState().open).toBe(true);
        expect(useLoginDialogStore.getState().next).toBe("/wallet");
        expect(calls).toEqual([]);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    test("all wallet open events apply the same gate and retain payment return information", async () => {
        await render();
        await act(async () => openWorkspaceWallet({ paymentOrderId: "order /test", paymentInvalid: true }));
        expect(useLoginDialogStore.getState().open).toBe(true);
        expect(useLoginDialogStore.getState().next).toBe("/wallet?paymentOrder=order+%2Ftest&payment=invalid");
        expect(calls).toEqual([]);
    });

    test("authenticated users can still open wallets and logout removes the private modal", async () => {
        useUserStore.setState({ user: { id: "wallet-test", username: "test", displayName: "Test", role: "user", status: "active" } });
        await render();
        await act(async () => openWorkspaceWallet());
        expect(calls).toEqual(["wallet", "products", "providers"]);
        expect(useLoginDialogStore.getState().open).toBe(false);
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        await act(async () => useUserStore.setState({ user: null }));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        calls.length = 0;
        await act(async () => openWorkspaceWallet());
        expect(useLoginDialogStore.getState().open).toBe(true);
        expect(calls).toEqual([]);
    });
});
