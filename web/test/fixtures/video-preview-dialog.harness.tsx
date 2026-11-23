import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://shop.example.test/shop/image?kind=video" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act, useEffect, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
mock.module("antd", () => ({
    Button: ({ children, icon, type, ...props }: any) => (
        <button {...props}>
            {icon}
            {children}
        </button>
    ),
}));
mock.module("../../src/components/ui/product/relative-time", () => ({ RelativeTime: () => <time>今天</time> }));
let playCalls = 0;
let pauseCalls = 0;
let playerKeyCalls = 0;
let playerUnmounts = 0;

mock.module("../../src/components/ui/product/app-modal/app-modal", () => ({
    // 模拟关闭动画期间仍保留内容，确认业务组件立即卸载媒体。
    AppModal: ({ open, children, afterOpenChange }: any) => {
        useEffect(() => afterOpenChange?.(open), [open]);
        return <div role="dialog">{children}</div>;
    },
}));
mock.module("../../src/components/video-player", () => ({
    VideoPlayer: ({ src, autoPlay }: any) => {
        const ref = useRef<HTMLDivElement>(null);
        useEffect(() => {
            const video = ref.current!.querySelector("video")!;
            let paused = !autoPlay;
            Object.defineProperties(video, {
                paused: { configurable: true, get: () => paused },
                play: {
                    configurable: true,
                    value: async () => {
                        playCalls++;
                        paused = false;
                    },
                },
                pause: {
                    configurable: true,
                    value: () => {
                        pauseCalls++;
                        paused = true;
                    },
                },
            });
            const player = ref.current!;
            // Vidstack 默认把快捷键绑定到播放器；捕获阶段必须拦住重复切换。
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.code !== "Space" || event.target !== video) return;
                playerKeyCalls++;
                if (video.paused) void video.play();
                else video.pause();
            };
            player.addEventListener("keydown", onKeyDown);
            return () => {
                player.removeEventListener("keydown", onKeyDown);
                playerUnmounts++;
            };
        }, []);
        return (
            <div ref={ref}>
                <video src={src} />
                <input aria-label="输入" />
                <textarea aria-label="描述" />
                <select aria-label="选项">
                    <option>一</option>
                </select>
                <button type="button">播放</button>
                <div role="button" tabIndex={0}>
                    播放控件
                </div>
                <div role="slider" tabIndex={0} />
                <div contentEditable suppressContentEditableWarning>
                    编辑文字
                </div>
            </div>
        );
    },
}));
const { VideoPreviewDialog } = await import("../../src/components/video-preview-dialog");
const { WorkbenchViewer } = await import("../../src/pages/workbench/workbench-viewer");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = (open: boolean) => act(async () => root.render(<VideoPreviewDialog open={open} src="/fixture.webm" onClose={() => {}} />));
async function space(target: Element, options: KeyboardEventInit = {}) {
    const event = new dom.KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true, ...options });
    await act(async () => target.dispatchEvent(event));
    return event;
}
beforeEach(async () => {
    playCalls = pauseCalls = playerKeyCalls = playerUnmounts = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await render(true);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
afterAll(() => dom.happyDOM.abort());

test("打开后聚焦预览区域，空格暂停再恢复且不冒泡到播放器二次切换", async () => {
    const stage = host.querySelector(".video-preview-stage")!;
    const video = host.querySelector("video")!;
    expect(document.activeElement).toBe(stage);
    expect((await space(video)).defaultPrevented).toBe(true);
    expect(video.paused).toBe(true);
    expect(pauseCalls).toBe(1);
    expect((await space(stage)).defaultPrevented).toBe(true);
    expect(video.paused).toBe(false);
    expect(playCalls).toBe(1);
    expect(playerKeyCalls).toBe(0);
});
test("按住空格不会反复切换播放状态", async () => {
    const video = host.querySelector("video")!;
    await space(video);
    for (let index = 0; index < 3; index++) expect((await space(video, { repeat: true })).defaultPrevented).toBe(true);
    expect(video.paused).toBe(true);
    expect(pauseCalls).toBe(1);
    expect(playCalls).toBe(0);
    expect(playerKeyCalls).toBe(0);
});
test("输入区、按钮和进度条保留自己的空格事件", async () => {
    for (const target of host.querySelectorAll("input, textarea, select, button, [role=button], [role=slider], [contenteditable=true]")) expect((await space(target)).defaultPrevented).toBe(false);
    expect(pauseCalls).toBe(0);
    expect(playCalls).toBe(0);
});
test("带修饰键的空格不会改变播放状态", async () => {
    const stage = host.querySelector(".video-preview-stage")!;
    for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) expect((await space(stage, options)).defaultPrevented).toBe(false);
    expect(pauseCalls).toBe(0);
    expect(playCalls).toBe(0);
});
test("关闭弹窗立即卸载播放器，关闭后的空格不再控制旧媒体", async () => {
    await render(false);
    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector(".video-preview-stage")).toBeNull();
    expect(playerUnmounts).toBe(1);
    await space(host);
    expect(pauseCalls).toBe(0);
    expect(playCalls).toBe(0);
});

async function renderWorkbench() {
    const navigate = mock(() => {});
    const outputs = [
        { key: "first", kind: "video", taskId: "task", url: "/first.mp4" },
        { key: "second", kind: "video", taskId: "task", url: "/second.mp4" },
    ];
    const batch = { outputs, tasks: [], chips: [], prompt: "展示商品", toolName: "视频创作", createdAt: "2026-11-21T08:00:00Z" } as any;
    await act(async () => root.render(<WorkbenchViewer kind="video" batch={batch} outputKey="first" onClose={() => {}} onDownload={() => {}} onNavigate={navigate} onReuse={() => {}} onCopyPrompt={() => {}} />));
    const video = host.querySelector("video")!;
    let paused = true;
    const play = mock(async () => {
        paused = false;
    });
    const pause = mock(() => {
        paused = true;
    });
    Object.defineProperties(video, {
        paused: { configurable: true, get: () => paused },
        play: { configurable: true, value: play },
        pause: { configurable: true, value: pause },
    });
    return { video, play, pause, navigate };
}
test("原生作品播放器在 keyup 不会再次触发空格，按住空格只切换一次", async () => {
    const { video, play, pause } = await renderWorkbench();
    // Chrome 原生 controls 在 keyup 切换播放；模拟同一事件目标上的默认控件行为。
    const nativeToggle = mock(() => {
        if (video.paused) void video.play();
        else video.pause();
    });
    video.addEventListener("keyup", nativeToggle);
    await space(video);
    await space(video, { repeat: true });
    const release = new dom.KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true, cancelable: true });
    await act(async () => video.dispatchEvent(release));
    expect(release.defaultPrevented).toBe(true);
    expect(nativeToggle).not.toHaveBeenCalled();
    expect(video.paused).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    await space(video);
    await act(async () => video.dispatchEvent(new dom.KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true, cancelable: true })));
    expect(video.paused).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
});
test("原生播放器左右键留给视频进度，画面外左右键仍可切换作品", async () => {
    const { video, navigate } = await renderWorkbench();
    const event = new dom.KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true });
    await act(async () => video.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => host.querySelector(".wb-viewer")!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true })));
    expect(navigate).toHaveBeenCalledTimes(1);
});
