import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AxiosRequestConfig } from "axios";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { PhoneLoginCard } = await import("../src/pages/auth/phone-login-card");
const { useUserStore } = await import("../src/stores/use-user-store");
const { apiClient } = await import("../src/services/api/request");
const originalAdapter = apiClient.defaults.adapter;

afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const settings = {
    phoneAuthAvailable: true,
    phoneRegistrationEnabled: true,
    wechatAvailable: true,
    wechatRegistrationEnabled: true,
    agreementTitle: "测试服务协议",
    agreementContent: "这是后台维护的真实协议内容。",
};

async function fixture(options: { settingsFailed?: boolean; pendingSMS?: Promise<unknown>; agreementContent?: string } = {}) {
    useUserStore.setState({ user: null, hydrated: true });
    const calls: AxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
        calls.push(config);
        let data: unknown = { ...settings, agreementContent: options.agreementContent ?? settings.agreementContent };
        let code = 0;
        let msg = "ok";
        if (config.url === "/auth/settings" && options.settingsFailed) {
            code = 500;
            msg = "配置读取失败";
        }
        if (config.url === "/auth/phone/start") data = options.pendingSMS ? await options.pendingSMS : { ticket: "test-ticket", expiresIn: 300, retryAfter: 60 };
        if (config.url === "/auth/phone/confirm") {
            code = 400;
            msg = "验证码不正确";
        }
        return { status: 200, statusText: "OK", headers: {}, config, data: { code, data, msg } };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let successes = 0;
    const render = () => act(async () => root.render(<MemoryRouter><App><PhoneLoginCard next="/canvas" onSuccess={() => { successes += 1; }} /></App></MemoryRouter>));
    await render();
    const click = async (selector: string) => {
        const element = host.querySelector<HTMLElement>(selector);
        expect(element).not.toBeNull();
        await act(async () => element!.click());
    };
    const input = async (label: string, value: string) => {
        const element = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(element, value);
            element.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
    };
    const dispose = async () => {
        await act(async () => root.unmount());
        host.remove();
        apiClient.defaults.adapter = originalAdapter;
        useUserStore.setState({ user: null, hydrated: false });
    };
    return { host, calls, click, input, dispose, render, successes: () => successes };
}

test("登录、微信和短信在未勾选时均提示协议，且不请求认证接口", async () => {
    const f = await fixture();
    try {
        expect(f.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
        for (const selector of [".phone-auth-submit", ".phone-auth-wechat", ".phone-auth-send"]) {
            await f.click(selector);
            expect(f.host.querySelector('[role="alert"]')?.textContent).toBe("请先勾选同意后再进行登录");
        }
        expect(f.calls.map((call) => call.url)).toEqual(["/auth/settings"]);
        expect(f.host.querySelector(".phone-auth-wechat")?.textContent).toBe("");
        expect(f.host.querySelector(".phone-auth-wechat")?.getAttribute("aria-label")).toBe("微信登录");
        await f.click('input[type="checkbox"]');
        expect(f.host.querySelector(".phone-auth-consent-tip")).toBeNull();
    } finally { await f.dispose(); }
});

test("勾选后校验手机号和验证码，保留短信 ticket、冷却与服务端错误", async () => {
    const f = await fixture();
    try {
        await f.click('input[type="checkbox"]');
        await f.click(".phone-auth-submit");
        expect(f.host.textContent).toContain("请输入有效的中国大陆 11 位手机号");
        await f.input("手机号码", "13800138000");
        await f.click(".phone-auth-submit");
        expect(f.host.textContent).toContain("请先获取短信验证码");
        await f.click(".phone-auth-send");
        expect(f.host.querySelector<HTMLButtonElement>(".phone-auth-send")!.disabled).toBe(true);
        expect(f.host.textContent).toContain("60 秒后重发");
        await f.input("验证码", "123456");
        await f.click('input[type="checkbox"]');
        await f.click(".phone-auth-submit");
        expect(f.calls.some((call) => call.url === "/auth/phone/confirm")).toBe(false);
        expect(f.host.textContent).toContain("请先勾选同意后再进行登录");
        await f.click('input[type="checkbox"]');
        await f.click(".phone-auth-submit");
        const confirm = f.calls.find((call) => call.url === "/auth/phone/confirm");
        expect(JSON.parse(String(confirm?.data))).toEqual({ ticket: "test-ticket", phone: "+8613800138000", code: "123456" });
        expect(f.host.textContent).toContain("验证码不正确");
        expect(f.successes()).toBe(0);
    } finally { await f.dispose(); }
});

test("空手机号切换焦点不提前报错，已输入的无效号码仍在失焦后提示", async () => {
    const f = await fixture();
    try {
        const phone = f.host.querySelector<HTMLInputElement>('input[aria-label="手机号码"]')!;
        await act(async () => { phone.dispatchEvent(new dom.FocusEvent("focusout", { bubbles: true })); });
        expect(phone.getAttribute("aria-invalid")).toBe("false");
        expect(f.host.querySelector(".phone-auth-field-note")?.textContent?.trim()).toBe("");
        await f.input("手机号码", "138");
        await act(async () => { phone.dispatchEvent(new dom.FocusEvent("focusout", { bubbles: true })); });
        expect(phone.getAttribute("aria-invalid")).toBe("true");
        expect(f.host.querySelector(".phone-auth-field-note")?.textContent).toContain("请输入有效的中国大陆 11 位手机号");
        await f.input("手机号码", "13800138000");
        expect(phone.getAttribute("aria-invalid")).toBe("false");
        expect(f.calls.map((call) => call.url)).toEqual(["/auth/settings"]);
    } finally { await f.dispose(); }
});

test("切换手机号不会让上一号码的迟到短信结果成为新号码的登录 ticket", async () => {
    let resolveSMS!: (value: unknown) => void;
    const pendingSMS = new Promise((resolve) => { resolveSMS = resolve; });
    const f = await fixture({ pendingSMS });
    try {
        await f.click('input[type="checkbox"]');
        await f.input("手机号码", "13800138000");
        await f.click(".phone-auth-send");
        await f.input("手机号码", "13900139000");
        await act(async () => resolveSMS({ ticket: "old-phone-ticket", expiresIn: 300, retryAfter: 60 }));
        await f.input("验证码", "123456");
        await f.click(".phone-auth-submit");
        expect(f.host.textContent).toContain("请先获取短信验证码");
        expect(f.calls.some((call) => call.url === "/auth/phone/confirm")).toBe(false);
    } finally { await f.dispose(); }
});

test("配置失败清晰显示原因，同时仍先执行协议提示", async () => {
    const f = await fixture({ settingsFailed: true });
    try {
        expect(f.host.textContent).toContain("登录方式加载失败");
        await f.click(".phone-auth-wechat");
        expect(f.host.textContent).toContain("请先勾选同意后再进行登录");
        await f.click('input[type="checkbox"]');
        await f.click(".phone-auth-wechat");
        expect(f.host.textContent).toContain("登录方式加载失败，请刷新页面后重试");
        expect(f.calls.map((call) => call.url)).toEqual(["/auth/settings"]);
    } finally { await f.dispose(); }
});

test("查看协议使用后台内容且不会替用户勾选同意", async () => {
    const f = await fixture();
    try {
        const terms = Array.from(f.host.querySelectorAll("button")).find((button) => button.textContent === "用户服务协议")!;
        await act(async () => terms.click());
        expect(document.body.textContent).toContain("这是后台维护的真实协议内容。");
        expect(document.body.textContent).not.toContain("一、账号与验证码安全");
        expect(f.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
        expect(f.host.querySelector('a[href="/privacy"]')?.getAttribute("target")).toBe("_blank");
    } finally { await f.dispose(); }
});

test("后台协议正文为空时展示完整默认协议和隐私入口", async () => {
    const f = await fixture({ agreementContent: "   " });
    try {
        const terms = Array.from(f.host.querySelectorAll("button")).find((button) => button.textContent === "用户服务协议")!;
        await act(async () => terms.click());
        expect(document.body.textContent).toContain("一、账号与验证码安全");
        expect(document.body.textContent).toContain("四、积分与付费功能");
        expect(document.body.textContent).toContain("449282092@qq.com");
        expect(document.body.textContent).not.toContain("服务协议内容待补充");
        expect(document.querySelector('.phone-auth-policy-content a[href="/privacy"]')?.textContent).toBe("查看隐私政策");
        expect(f.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    } finally { await f.dispose(); }
});

test("会话恢复只完成一次弹窗回调，保留调用方控制的返回路径", async () => {
    const f = await fixture();
    try {
        await act(async () => useUserStore.setState({ user: { id: "test-user", username: "test-user", displayName: "测试", role: "user", status: "active" }, hydrated: true }));
        await f.render();
        expect(f.successes()).toBe(1);
    } finally { await f.dispose(); }
});
