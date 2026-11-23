import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://preview.example.com", settings: { enableImageFileLoading: false } });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { GenerationImagePreview } = await import("@/components/ai/generation-image-preview");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("loaded pixels replace progress immediately; unavailable preview keeps progress", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let opened = 0;
    try {
        const render = (src: string) =>
            act(async () =>
                root.render(
                    <GenerationImagePreview src={src} alt="生成图片" onPreview={() => opened++}>
                        <span data-progress>原任务保存中</span>
                    </GenerationImagePreview>,
                ),
            );
        await render("/api/tasks/one/image-preview");
        expect(host.querySelector("[data-progress]")).not.toBeNull();
        await act(async () => {
            host.querySelector("img")!.dispatchEvent(new dom.Event("load"));
        });
        expect(host.querySelector("[data-progress]")).toBeNull();
        expect(host.querySelector("[data-loaded]")).not.toBeNull();
        expect(host.textContent).not.toContain("保存");
        await act(async () => {
            host.querySelector("button")!.click();
        });
        expect(opened).toBe(1);
        await render("/api/tasks/two/image-preview");
        expect(host.querySelector("[data-progress]")).not.toBeNull();
        await act(async () => {
            host.querySelector("img")!.dispatchEvent(new dom.Event("error"));
        });
        expect(host.querySelector("img")).toBeNull();
        expect(host.querySelector("[data-progress]")).not.toBeNull();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 2100));
        });
        expect(host.querySelector("img")?.getAttribute("src")).toContain("previewAttempt=1");
        await act(async () => {
            host.querySelector("img")!.dispatchEvent(new dom.Event("load"));
        });
        expect(host.querySelector("[data-progress]")).toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
