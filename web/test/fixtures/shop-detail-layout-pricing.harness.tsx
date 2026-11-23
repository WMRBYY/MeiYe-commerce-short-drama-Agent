import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { EcommercePlan, EcommercePlanImage, EcommerceProject } from "../../src/services/api/ecommerce";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    localStorage: dom.localStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useImageQuote } = await import("../../src/pages/shop/shop-edits");
const { ResizablePanes } = await import("../../src/pages/shop/resizable-panes");
const { DetailRegenerateModal } = await import("../../src/pages/shop/shop-image-viewer");
const regeneration = await import("../../src/pages/shop/detail-regenerate");
const quotes = await import("../../src/services/api/logical-models");
const configStore = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { emptyEcommerceDraft } = await import("../../src/services/api/ecommerce");

const profile = defaultModelCapabilityConfig();
profile.image!.size = { parameter: "size", values: ["1:1", "3:4", "16:9"], default: "1:1", allowCustom: false };
profile.image!.resolution = { supported: true, values: ["1k", "2k", "4k"], default: "1k" };
const model = "quote-test::image";
const config = configStore.normalizeConfigSnapshot({
    config: {
        ...configStore.defaultConfig,
        channels: [
            configStore.createModelChannel({
                id: "quote-test",
                name: "测试渠道",
                scope: "system",
                models: ["image"],
                modelCosts: [
                    {
                        model: "image",
                        displayName: "测试图片模型",
                        capability: "image",
                        pricePolicy: "channel",
                        capabilityConfig: profile,
                        billingMode: "fixed_request",
                        unitPriceMicrocredits: 120_000,
                        logicalPriceTiers: [
                            {
                                selector: { operation: "image_to_image", resolution: "4k" },
                                resolution: "*",
                                videoSeconds: 0,
                                billingMode: "fixed_request",
                                unitPriceMicrocredits: 120_000,
                                inputTokenPriceMicrocredits: 0,
                                outputTokenPriceMicrocredits: 0,
                                cachedTokenPriceMicrocredits: 0,
                            },
                        ],
                    },
                ],
            }),
        ],
        model,
        imageModel: model,
        size: "1:1",
        imageResolution: "1k",
    },
}).config;

type QuoteResult = Awaited<ReturnType<typeof quotes.quoteModel>>;
type PendingQuote = {
    request: Parameters<typeof quotes.quoteModel>[0];
    resolve: (value: QuoteResult) => void;
    reject: (reason: Error) => void;
    signal?: AbortSignal;
};
const requests: PendingQuote[] = [];
const result = (amountMicrocredits: number): QuoteResult => ({
    quote: { logicalModelId: "", billingMode: "fixed_request", quantity: 1, amountMicrocredits, estimated: false },
});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    requests.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    spyOn(quotes, "quoteModel").mockImplementation((request, signal) => new Promise((resolve, reject) => requests.push({ request, resolve, reject, signal })));
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    mock.restore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function waitForQuote(count: number) {
    for (let attempt = 0; requests.length < count && attempt < 60; attempt++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
    }
    expect(requests).toHaveLength(count);
}

function QuoteProbe({ resolution, size = "3:4", selectedModel = model }: { resolution: string; size?: string; selectedModel?: string }) {
    const quote = useImageQuote(config, selectedModel, size, resolution, 2);
    return (
        <output data-loading={quote.loading} data-value={quote.value ?? ""}>
            {quote.loading ? "报价中…" : quote.value === null ? "暂无报价" : quote.value.toFixed(2)}
        </output>
    );
}

test("图片报价使用所选比例与分辨率，迟到响应不能覆盖新报价", async () => {
    await act(async () => root.render(<QuoteProbe resolution="2k" />));
    expect(host.textContent).toBe("报价中…");
    await waitForQuote(1);
    expect(requests[0].request).toMatchObject({
        channelId: "quote-test",
        modelKey: "image",
        intent: { capability: "image", operation: "image_to_image", inputs: { image: 2 }, options: { size: "3:4", imageResolution: "2k", count: 1 } },
    });
    await act(async () => root.render(<QuoteProbe size="16:9" resolution="4k" />));
    expect(requests[0].signal?.aborted).toBe(true);
    await waitForQuote(2);
    expect(requests[1].request.intent.options).toMatchObject({ size: "16:9", imageResolution: "4k", count: 1 });
    await act(async () => requests[1].resolve(result(120_000)));
    expect(host.textContent).toBe("0.12");
    await act(async () => requests[0].resolve(result(80_000)));
    expect(host.textContent).toBe("0.12");
});

test("切换规格立即清空已返回的价格，失败或无模型不能显示旧报价", async () => {
    await act(async () => root.render(<QuoteProbe resolution="1k" />));
    await waitForQuote(1);
    await act(async () => requests[0].resolve(result(80_000)));
    expect(host.querySelector("output")?.dataset.value).toBe("0.08");
    await act(async () => root.render(<QuoteProbe resolution="4k" />));
    expect(host.querySelector("output")?.dataset.value).toBe("");
    expect(host.textContent).toBe("报价中…");
    await waitForQuote(2);
    await act(async () => requests[1].reject(new Error("测试报价失败")));
    expect(host.textContent).toBe("暂无报价");
    await act(async () => root.render(<QuoteProbe resolution="2k" />));
    await waitForQuote(3);
    await act(async () => root.render(<QuoteProbe resolution="2k" selectedModel="" />));
    expect(host.textContent).toBe("暂无报价");
    expect(requests[2].signal?.aborted).toBe(true);
    await act(async () => requests[2].resolve(result(100_000)));
    expect(host.textContent).toBe("暂无报价");
});

test("真实再生成弹窗的模型栏与底部同步显示报价和错误状态", async () => {
    const draft = { ...emptyEcommerceDraft(), imageModel: model, ratio: "3:4", resolution: "4k", references: [{ resourceId: "product", role: "primary" as const }] };
    const image: EcommercePlanImage = {
        id: "detail-image",
        taskId: "detail-task",
        imageType: "detail",
        platform: "taobao",
        language: "zh-CN",
        goal: "商品展示",
        theme: "商品详情",
        composition: "",
        mainVisual: "",
        verifiedClaims: "",
        copy: "便携小风扇",
        lighting: "",
        fidelity: "standard",
        prompt: "展示商品",
        negativePrompt: "",
        imageModel: model,
        ratio: "3:4",
        resolution: "4k",
        sourceDraft: draft,
    };
    const plan: EcommercePlan = { productSummary: "商品", confirmedFacts: [], uncertainFacts: [], visualStrategy: "", qualityChecks: [], images: [image] };
    const project: EcommerceProject = { id: "detail-project", name: "测试商品", status: "done", revision: 1, draftJson: JSON.stringify(draft), planJson: JSON.stringify(plan), createdAt: "", updatedAt: "" };
    spyOn(configStore, "useEffectiveConfig").mockReturnValue(config);
    spyOn(regeneration, "findDetailPlanImage").mockResolvedValue({ project, plan, image, round: null });
    const submit = spyOn(regeneration, "regenerateDetailImage").mockRejectedValue(new Error("回归测试不得提交生成"));
    await act(async () =>
        root.render(
            <DetailRegenerateModal target={{ projectId: project.id, taskId: image.taskId!, image: { key: image.id, src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" } }} onClose={() => {}} onSubmitted={() => {}} />,
        ),
    );
    const pickerPrice = () => document.querySelector('.siv-regen [aria-label="选择图片模型"] .model-picker-price')?.textContent;
    const footerPrice = () => document.querySelector(".siv-regen .siv-price")?.textContent;
    expect(pickerPrice()).toBe("报价中…");
    await waitForQuote(1);
    expect(requests[0].request.intent.options).toMatchObject({ size: "3:4", imageResolution: "4k" });
    await act(async () => requests[0].resolve(result(120_000)));
    expect(pickerPrice()).toBe("约 0.12 积分");
    expect(footerPrice()).toContain("约 0.12 积分");
    expect(document.querySelector(".siv-regen")?.textContent).not.toContain("当前规格无报价");
    const resolution = [...document.querySelectorAll<HTMLButtonElement>(".siv-chips button")].find((button) => button.textContent === "2K")!;
    await act(async () => resolution.click());
    expect(pickerPrice()).toBe("报价中…");
    expect(footerPrice()).toContain("报价中…");
    expect(footerPrice()).not.toContain("0.12");
    await waitForQuote(2);
    expect(requests[1].request.intent.options).toMatchObject({ size: "3:4", imageResolution: "2k" });
    await act(async () => requests[1].reject(new Error("测试无报价")));
    expect(pickerPrice()).toBe("暂未取到报价");
    expect(footerPrice()).toContain("暂未取到报价");
    expect(submit).not.toHaveBeenCalled();
});

test("图片栏支持鼠标拖宽、键盘调整、复位和宽度记忆，并保留中间操作空间", async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "clientWidth");
    let viewportWidth = 2560;
    Object.defineProperty(dom.HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get() {
            return this.classList.contains("rp-panes") ? viewportWidth : 0;
        },
    });
    // 分栏只在桌面宽度（>1024px）下随窗口收缩，测试里窗口宽度与容器宽度同步变化。
    const originalInnerWidth = Object.getOwnPropertyDescriptor(dom, "innerWidth");
    Object.defineProperty(dom, "innerWidth", { configurable: true, get: () => viewportWidth });
    const storageKey = "shop-detail-layout-regression";
    const renderPanes = () => root.render(<ResizablePanes storageKey={storageKey} className="test-panes" defaults={{ left: 260, right: 640 }} rightLimits={{ min: 260, max: 1600 }} left={<aside />} center={<main />} right={<section />} />);
    const pane = () => host.querySelector<HTMLElement>(".rp-panes")!;
    const handle = () => host.querySelector<HTMLElement>('[aria-label="拖动调整右栏宽度"]')!;
    const width = () => pane().style.getPropertyValue("--rp-right");
    try {
        await act(async () => renderPanes());
        expect(width()).toBe("640px");
        await act(async () => handle().dispatchEvent(new dom.PointerEvent("pointerdown", { button: 0, clientX: 1900, pointerId: 1, bubbles: true })));
        await act(async () => dom.dispatchEvent(new dom.PointerEvent("pointermove", { clientX: 700, pointerId: 1 })));
        await act(async () => dom.dispatchEvent(new dom.PointerEvent("pointerup", { pointerId: 1 })));
        expect(width()).toBe("1600px");
        expect(document.body.style.cursor).toBe("");
        expect(document.body.style.userSelect).toBe("");
        await act(async () => handle().dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
        expect(width()).toBe("1560px");
        await act(async () => root.render(null));
        await act(async () => renderPanes());
        expect(width()).toBe("1560px");
        await act(async () => handle().dispatchEvent(new dom.MouseEvent("dblclick", { bubbles: true })));
        expect(width()).toBe("640px");
        viewportWidth = 1200;
        await act(async () => dom.dispatchEvent(new dom.Event("resize")));
        expect(width()).toBe("408px");
        expect(viewportWidth - parseInt(width()) - parseInt(pane().style.getPropertyValue("--rp-left"))).toBeGreaterThanOrEqual(520);
        expect(JSON.parse(dom.localStorage.getItem(`meiye.panes.${storageKey}`) || "{}").right).toBe(408);
    } finally {
        await act(async () => root.render(null));
        dom.localStorage.removeItem(`meiye.panes.${storageKey}`);
        if (originalWidth) Object.defineProperty(dom.HTMLElement.prototype, "clientWidth", originalWidth);
        else Reflect.deleteProperty(dom.HTMLElement.prototype, "clientWidth");
        if (originalInnerWidth) Object.defineProperty(dom, "innerWidth", originalInnerWidth);
        else Reflect.deleteProperty(dom, "innerWidth");
    }
});
