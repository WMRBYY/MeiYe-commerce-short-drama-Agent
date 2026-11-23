import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

const dom = new Window({ url: "https://commerce.example.com/shop/image?media=video" });
// Happy DOM 的原生动画取消会抛未处理拒绝；动效由真实浏览器验收。
Reflect.deleteProperty(dom.Element.prototype, "animate");
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "SVGElement", "Element", "Node", "Event", "MouseEvent", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom : Reflect.get(dom, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: typeof value === "function" && key.endsWith("AnimationFrame") ? value.bind(dom) : value });
}

const { replaceKindConfig } = await import("@/pages/ecommerce/video/video-kinds");
const imports: unknown[] = [];
const namespaces: string[] = [];
let mountCount = 0;
let acceptRemix = true;
let initialConfig = { ready: true, loading: false, error: "" };
let completeConfig: () => void;
mock.module("@/pages/ecommerce/video/use-ecommerce-video", () => ({
    useEcommerceVideo: ({ draftNamespace }: { draftNamespace: string }) => {
        namespaces.push(draftNamespace);
        const [kind, setKind] = useState<"product" | "clothing" | "model">(() => {
            mountCount++;
            return "product";
        });
        const [feature, setFeature] = useState("replace");
        const [notes, setNotes] = useState("");
        const [configuration, setConfiguration] = useState(initialConfig);
        completeConfig = () => setConfiguration({ ready: true, loading: false, error: "" });
        return {
            kind,
            setKind,
            feature,
            setFeature,
            notes,
            setNotes,
            publicConfig: configuration.ready ? {} : null,
            publicConfigLoading: configuration.loading,
            publicConfigError: configuration.error,
            refreshPublicConfig: async () => completeConfig(),
            kindConfig: replaceKindConfig(kind),
            disabledKinds: ["background"],
            projects: [
                { id: "replace-result", parameters: {} },
                { id: "script-result", parameters: { viralSource: "script" } },
            ],
            submitting: false,
            applyWorkRemix: (remix: { prompt: string; replaceMode: "product" | "clothing" | "model" }) => {
                imports.push(remix);
                if (!acceptRemix) return false;
                setKind(remix.replaceMode);
                setNotes(remix.prompt);
                return true;
            },
        };
    },
}));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (select: (state: unknown) => unknown) => select({ user: { id: "video-user" } }) }));
mock.module("antd", () => ({
    Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
    Select: ({ value, onChange, options, ...props }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string; disabled?: boolean }>; "aria-label"?: string }) => (
        <select aria-label={props["aria-label"]} value={value} onChange={(event) => onChange(event.target.value)}>
            {options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
}));
mock.module("@/pages/ecommerce/video/video-results", () => ({
    EcommerceVideoResults: ({ state }: { state: { projects: Array<{ id: string }> } }) => <div data-testid="results">{state.projects.map((project) => project.id).join(",")}</div>,
}));
mock.module("@/pages/shop/shop-video-pending", () => ({ ShopVideoPending: () => null }));
let setGenerationPrompt: (value: string) => void;
mock.module("@/pages/shop/shop-video-generation", () => ({
    ShopVideoGeneration: ({ active, kindPicker }: { active: boolean; kindPicker: ReactNode }) => {
        const [prompt, setPrompt] = useState("");
        setGenerationPrompt = setPrompt;
        return active ? (
            <ShopCreationPortal>
                {kindPicker}
                <textarea aria-label="普通视频提示词" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </ShopCreationPortal>
        ) : null;
    },
}));
mock.module("@/pages/shop/shop-video-composer", () => ({
    ShopVideoComposer: ({ state, toolbarStart }: { state: { notes: string; missing?: string; setNotes: (value: string) => void; kindConfig: { slots: Array<{ key: string; category: string }> } }; toolbarStart: ReactNode }) => (
        <div>
            <textarea aria-label="补充说明" value={state.notes} onChange={(event) => state.setNotes(event.target.value)} />
            <div data-testid="slots">{state.kindConfig.slots.map((slot) => slot.category).join(",")}</div>
            <button type="button" disabled={Boolean(state.missing)}>
                生成视频
            </button>
            {toolbarStart}
        </div>
    ),
}));

const { ShopImageVideo } = await import("@/pages/shop/shop-image-video");
const { ShopCreationDock, ShopCreationPortal } = await import("@/pages/shop/shop-creation-dock");
let root: Root | null = null;
let container: HTMLDivElement;
let changeActive: (active: boolean) => void;
async function mount(active: boolean, state?: unknown) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Harness() {
        const [visible, setVisible] = useState(active);
        changeActive = setVisible;
        return (
            <ShopCreationDock mode="video">
                <ShopImageVideo active={visible} />
            </ShopCreationDock>
        );
    }
    const router = createMemoryRouter([{ path: "/shop/image", element: <Harness /> }], { initialEntries: [{ pathname: "/shop/image", search: "?media=video", state }] });
    await act(async () => root!.render(<RouterProvider router={router} />));
    return router;
}
afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    imports.length = 0;
    namespaces.length = 0;
    mountCount = 0;
    acceptRemix = true;
    initialConfig = { ready: true, loading: false, error: "" };
});
afterAll(() => {
    mock.restore();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
});

const remix = {
    replaceMode: "clothing",
    prompt: "保持节奏，换成新款外套",
    materials: [
        { category: "reference_video", resourceId: "video" },
        { category: "apparel_image", resourceId: "coat" },
    ],
};
test("模板在激活时只导入一次，消费路由载荷，且视频区不混入剧本结果", async () => {
    const router = await mount(true, { workRemix: remix });
    expect(imports).toEqual([remix]);
    expect(router.state.location.state).toBeNull();
    expect(container.querySelector("textarea")?.value).toBe(remix.prompt);
    expect(container.querySelector('[data-testid="slots"]')?.textContent).toContain("apparel_image");
    expect(container.querySelector('[data-testid="results"]')?.textContent).toBe("replace-result");
    await act(async () => changeActive(false));
    await act(async () => changeActive(true));
    expect(imports).toHaveLength(1);
    expect(mountCount).toBe(1);
    expect(container.querySelector("textarea")?.value).toBe(remix.prompt);
    expect(new Set(namespaces)).toEqual(new Set(["shop-image-video"]));
});
test("图片模式不消费视频模板，切到视频才导入", async () => {
    const router = await mount(false, { workRemix: remix });
    expect(imports).toHaveLength(0);
    expect(container.querySelector("textarea")).toBeNull();
    expect(router.state.location.state).toEqual({ workRemix: remix });
    await act(async () => changeActive(true));
    expect(imports).toEqual([remix]);
});
test("切换复刻类型同步素材位，保留说明，并保持关闭类型不可选", async () => {
    await mount(true, { workRemix: remix });
    await act(async () => (container.querySelector('button[aria-label="视频类型"]') as HTMLButtonElement).click());
    const options = [...document.querySelectorAll<HTMLButtonElement>(".sp-fn-item")];
    expect(options.find((option) => option.textContent === "换背景")?.disabled).toBe(true);
    await act(async () => options.find((option) => option.textContent === "模特")!.click());
    expect(container.querySelector('[data-testid="slots"]')?.textContent).toBe("model_image");
    expect(container.querySelector("textarea")?.value).toBe(remix.prompt);
    expect(imports).toHaveLength(1);
});

test("普通视频入口与复刻草稿隔离，切换媒体后保留普通视频提示词", async () => {
    await mount(true, { workRemix: remix });
    const pick = async (label: string) => {
        await act(async () => (container.querySelector('button[aria-label="视频类型"]') as HTMLButtonElement).click());
        await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".sp-fn-item")].find((button) => button.textContent === label)!.click());
    };
    await pick("视频创作");
    const editor = container.querySelector('textarea[aria-label="普通视频提示词"]') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    await act(async () => setGenerationPrompt("独立视频提示词"));
    await act(async () => changeActive(false));
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => changeActive(true));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("独立视频提示词");
    await pick("服饰");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(remix.prompt);
    expect(imports).toHaveLength(1);
});

test("模板等待功能配置成功后才载入，等待期间阻止提交旧草稿", async () => {
    initialConfig = { ready: false, loading: true, error: "" };
    const router = await mount(true, { workRemix: remix });
    expect(imports).toHaveLength(0);
    expect(router.state.location.state).toEqual({ workRemix: remix });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在载入视频参数");
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "生成视频")?.disabled).toBe(true);
    await act(async () => [...container.querySelectorAll('button[role="radio"]')].find((button) => button.textContent === "图片")!.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }) as unknown as Event));
    expect(router.state.location.search).toBe("");
    expect(router.state.location.state).toEqual({ workRemix: remix });
    await act(async () => completeConfig());
    expect(imports).toEqual([remix]);
    expect(router.state.location.state).toBeNull();
});

test("导入拒绝时保留载荷，只在点击重试后再次导入", async () => {
    acceptRemix = false;
    const router = await mount(true, { workRemix: remix });
    expect(imports).toHaveLength(1);
    expect(router.state.location.state).toEqual({ workRemix: remix });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("模板素材未载入");
    await act(async () => changeActive(false));
    await act(async () => changeActive(true));
    expect(imports).toHaveLength(1);
    acceptRemix = true;
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "重新载入")!.click());
    expect(imports).toHaveLength(2);
    expect(router.state.location.state).toBeNull();
    expect(container.querySelector("textarea")?.value).toBe(remix.prompt);
});

test("配置请求失败就地提示，重试恢复后继续同一份模板", async () => {
    initialConfig = { ready: false, loading: false, error: "视频功能配置载入失败，请重试" };
    const router = await mount(true, { workRemix: remix });
    expect(imports).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("配置载入失败");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "重新载入")!.click());
    expect(imports).toEqual([remix]);
    expect(router.state.location.state).toBeNull();
});

test("账号不一致的模板在配置加载前被拒绝并清除，不能重试旧账号素材", async () => {
    initialConfig = { ready: false, loading: true, error: "" };
    const router = await mount(true, { workRemix: remix, workRemixOwner: "previous-user", unrelated: "preserved" });
    expect(imports).toHaveLength(0);
    expect(router.state.location.state).toEqual({ unrelated: "preserved" });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("账号已变化");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "重新载入")).toBe(false);
    expect(container.querySelector('a[href="/shop/templates"]')?.textContent).toBe("选择模板");
    await act(async () => completeConfig());
    await act(async () => changeActive(false));
    await act(async () => changeActive(true));
    expect(imports).toHaveLength(0);
});

test("同账号模板跨模式保留 owner，成功导入时一起消费 owner 与素材", async () => {
    initialConfig = { ready: false, loading: true, error: "" };
    const router = await mount(true, { workRemix: remix, workRemixOwner: "video-user", unrelated: "preserved" });
    await act(async () => [...container.querySelectorAll('button[role="radio"]')].find((button) => button.textContent === "图片")!.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }) as unknown as Event));
    expect(router.state.location.state).toEqual({ workRemix: remix, workRemixOwner: "video-user", unrelated: "preserved" });
    expect(imports).toHaveLength(0);
    await act(async () => completeConfig());
    expect(imports).toEqual([remix]);
    expect(router.state.location.state).toEqual({ unrelated: "preserved" });
});
