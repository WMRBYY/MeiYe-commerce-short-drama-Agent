import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ImageAsset } from "../../src/stores/use-asset-store";
import type { RemoteResource } from "../../src/services/api/resources";

const dom = new Window({ url: "https://shop.example.test/shop/script" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
let scope = "账号甲";
let remote: ImageAsset[] = [];
let uploadError = "";
let saveError = "";
let readError = "";
let sequence = 0;
const message = { success: mock(() => {}), warning: mock(() => {}), error: mock(() => {}) };
mock.module("antd", () => ({ App: { useApp: () => ({ message }) } }));
// The isolated library state harness does not mount AntD's overlay runtime;
// the real themed popup is exercised separately on the browser route.
mock.module("../../src/components/ui/base/select", () => ({
    Select: ({ ariaLabel, value, onChange, options }: any) => (
        <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
            {options.map((item: any) => (
                <option key={item.value} value={item.value}>
                    {item.label}
                </option>
            ))}
        </select>
    ),
}));
mock.module("../../src/components/ui/product/app-modal", () => ({
    AppModal: ({ open, children }: any) =>
        open ? (
            <div role="dialog" aria-label="素材库 · 模特">
                {children}
            </div>
        ) : null,
}));
let activeScope = scope;
mock.module("../../src/lib/user-scope", () => ({ getActiveUserScope: () => activeScope }));
mock.module("../../src/pages/shop/shop-context", () => ({ useShopScope: () => scope }));
const uploadResource = mock(async (_file: Blob, _kind: string, _meta?: unknown): Promise<RemoteResource> => {
    if (uploadError) throw new Error(uploadError);
    return { id: `resource-${++sequence}`, status: "ready", size: 100 } as RemoteResource;
});
mock.module("../../src/services/api/resources", () => ({
    resourceIdFromStorageKey: (key?: string) => (key?.startsWith("resource:") ? key.slice(9) : undefined),
    resourceStorageKey: (id: string) => `resource:${id}`,
    resourceFileUrl: (id: string) => `/api/resources/${id}/file`,
    uploadResourceFile: uploadResource,
}));
const upsertAsset = mock(async (asset: ImageAsset) => {
    if (saveError) throw new Error(saveError);
    remote = [asset, ...remote.filter((item) => item.id !== asset.id)];
    return { asset };
});
const listAssets = mock(async ({ page, pageSize }: { page: number; pageSize: number }) => {
    if (readError) throw new Error(readError);
    return { assets: remote.slice((page - 1) * pageSize, page * pageSize), hasMore: page * pageSize < remote.length };
});
mock.module("../../src/services/api/user-data", () => ({ upsertRemoteAsset: upsertAsset, listRemoteAssetsPage: listAssets }));
const originalFetch = globalThis.fetch;
const fetchAtlas = mock(async () => new Response(new Blob(["图集"], { type: "image/webp" }), { status: 200 }));
globalThis.fetch = fetchAtlas as unknown as typeof fetch;
const bitmap = mock(async () => ({ width: 1536, height: 1536, close() {} }));
Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: bitmap });
const drawImage = mock(() => {});
Object.defineProperty(dom.HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({ drawImage }) });
Object.defineProperty(dom.HTMLCanvasElement.prototype, "toBlob", { configurable: true, value: (done: (blob: Blob) => void) => done(new Blob(["单张模特"], { type: "image/png" })) });

const { ScriptModelLibrary } = await import("../../src/pages/shop/script/script-model-library");
const { listScriptModels, saveScriptModel, setScriptModelFavorite, validateScriptModelFile, SCRIPT_MODEL_TAG, SCRIPT_MODEL_SYSTEM_TAG } = await import("../../src/services/script-model-library");
const { SCRIPT_MODELS, matchesScriptModel } = await import("../../src/pages/shop/script/script-model-catalog");
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let client: InstanceType<typeof QueryClient>;
const onPick = mock(async (_items: Array<{ resourceId: string; name: string }>) => {});
const onClose = mock(() => {});
const modelFile = () => new File(["模特"], "我的模特.png", { type: "image/png" });
function asset(index: number, preset = false): ImageAsset {
    return {
        id: preset ? `script-model:${SCRIPT_MODELS[index - 1].id}` : `asset-${index}`,
        kind: "image",
        title: `模特${index}`,
        category: "character",
        status: "confirmed",
        coverUrl: "",
        tags: [SCRIPT_MODEL_TAG, ...(preset ? [SCRIPT_MODEL_SYSTEM_TAG] : [])],
        source: preset ? "script-model-preset" : "script-model-upload",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        data: { storageKey: `resource:r${index}`, dataUrl: "", width: 138, height: 173, bytes: 100, mimeType: "image/png" },
    };
}
beforeEach(() => {
    scope = "账号甲";
    activeScope = scope;
    remote = [];
    sequence = 0;
    uploadError = "";
    saveError = "";
    readError = "";
    for (const fn of [uploadResource, upsertAsset, listAssets, onPick, onClose, bitmap, drawImage, fetchAtlas, message.success, message.warning]) fn.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
});
afterAll(() => {
    globalThis.fetch = originalFetch;
    dom.happyDOM.abort();
});
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}
async function render(max = 9, current: Array<{ resourceId: string; name: string }> = [], disabled = false) {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <ScriptModelLibrary open max={max} current={current} disabled={disabled} onClose={onClose} onPick={onPick} />
            </QueryClientProvider>,
        ),
    );
    await settle();
}
function button(text: string) {
    const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text);
    expect(found, `找不到按钮：${text}`).toBeDefined();
    return found!;
}
async function click(text: string) {
    await act(async () => button(text).click());
    await settle();
}
async function upload(files = [modelFile()]) {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
}

test("内置目录有288个不同人物，搜索与分类筛选有效", () => {
    expect(SCRIPT_MODELS).toHaveLength(388);
    expect(new Set(SCRIPT_MODELS.map((item) => item.id)).size).toBe(388);
    expect(SCRIPT_MODELS.filter((item) => matchesScriptModel(item, "武林侠客"))).toHaveLength(36);
    expect(SCRIPT_MODELS.filter((item) => matchesScriptModel(item, "", "", "", "beasts"))).toHaveLength(36);
});
test("默认展示系统模特，切到我的模特显示上传格和空态", async () => {
    await render();
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(36);
    expect(button("系统模特").getAttribute("aria-pressed")).toBe("true");
    expect(button("填入模特").disabled).toBe(true);
    await click("我的模特");
    expect(host.querySelector(".smo-upload")).not.toBeNull();
    expect(host.textContent).toContain("这里还没有素材，可以先从第一格本地上传");
    await click("取消");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
});

test("未登录时系统肖像不可选用，个人模特不可上传且不请求账号素材", async () => {
    scope = "guest";
    activeScope = scope;
    await render();
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(36);
    expect(button("黄衣旅行者").disabled).toBe(true);
    await click("我的模特");
    expect(host.querySelector<HTMLButtonElement>(".smo-upload")!.disabled).toBe(true);
    expect(host.textContent).toContain("请先登录后使用模特库");
    expect(listAssets).not.toHaveBeenCalled();
});
test("系统多选遵守剩余名额，裁出单人图上传并返回资源ID", async () => {
    await render(2);
    await click("黄衣旅行者");
    await click("卷发商务女士");
    await click("白帽厨师");
    expect(host.querySelectorAll('.smo-portrait[aria-pressed="true"]')).toHaveLength(2);
    expect(message.warning).toHaveBeenCalled();
    await click("填入模特（2）");
    expect(uploadResource).toHaveBeenCalledTimes(2);
    expect(drawImage).not.toHaveBeenCalled();
    expect(String(fetchAtlas.mock.calls[0][0])).toContain("modern-hd-1.png");
    expect(onPick).toHaveBeenCalledWith([
        { resourceId: "resource-1", name: "黄衣旅行者" },
        { resourceId: "resource-2", name: "卷发商务女士" },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
});
test("双击直接填入，已有系统模特不重复上传", async () => {
    remote = [asset(1, true)];
    await render();
    await act(async () => button("黄衣旅行者").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await settle();
    expect(onPick).toHaveBeenCalledWith([{ resourceId: "r1", name: "模特1" }]);
    expect(uploadResource).not.toHaveBeenCalled();
});
test("已经填入的模特禁用，零容量不允许填入", async () => {
    remote = [asset(1, true)];
    await render(0, [{ resourceId: "r1", name: "模特1" }]);
    expect(button("黄衣旅行者").disabled).toBe(true);
    await click("卷发商务女士");
    expect(button("填入模特").disabled).toBe(true);
    expect(uploadResource).not.toHaveBeenCalled();
});
test("我的模特上传先保存到服务端，确认后才填入", async () => {
    await render();
    await click("我的模特");
    await upload();
    expect(remote).toHaveLength(1);
    expect(remote[0].source).toBe("script-model-upload");
    expect(remote[0].tags).toContain(SCRIPT_MODEL_TAG);
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(1);
    expect(onPick).not.toHaveBeenCalled();
    await click("填入模特（1）");
    expect(onPick).toHaveBeenCalledWith([{ resourceId: "resource-1", name: "我的模特" }]);
});
test("关闭后重新打开仍可从服务端读取我的模特", async () => {
    await saveScriptModel(scope, modelFile());
    await render();
    await click("我的模特");
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(1);
    expect(button("我的模特")).toBeDefined();
    expect(uploadResource).toHaveBeenCalledTimes(1);
});
test("上传或素材登记失败保留弹窗，不伪报已保存", async () => {
    await render();
    await click("我的模特");
    uploadError = "上传被拒绝";
    await upload();
    expect(host.textContent).toContain("上传被拒绝");
    expect(remote).toHaveLength(0);
    expect(message.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    uploadError = "";
    saveError = "登记失败";
    await upload();
    expect(host.textContent).toContain("登记失败");
    expect(remote).toHaveLength(0);
    expect(onPick).not.toHaveBeenCalled();
});
test("系统模特保存失败不关闭、不填入", async () => {
    await render();
    saveError = "存储已满";
    await click("黄衣旅行者");
    await click("填入模特（1）");
    expect(host.textContent).toContain("存储已满");
    expect(onClose).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
});

test("首次填入内置模特使用稳定短ID并标记为系统素材", async () => {
    await render();
    await click("黄衣旅行者");
    await click("填入模特（1）");
    expect(remote[0].id).toBe("script-model:modern-hd-1");
    expect(remote[0].tags).toContain(SCRIPT_MODEL_SYSTEM_TAG);
});
test("收藏存到服务端，只看收藏正确过滤并可取消", async () => {
    remote = [asset(1, true)];
    await render();
    await click("收藏黄衣旅行者");
    expect(remote[0].tags).toContain("收藏");
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await settle();
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(1);
    await click("取消收藏黄衣旅行者");
    expect(remote[0].tags).not.toContain("收藏");
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(0);
});
test("收藏写入失败不改变收藏状态", async () => {
    remote = [asset(1, true)];
    await render();
    saveError = "收藏保存失败";
    await click("收藏黄衣旅行者");
    expect(remote[0].tags).not.toContain("收藏");
    expect(host.textContent).toContain("收藏保存失败");
});
test("人物分类可筛选并恢复全部", async () => {
    await render();
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="人物分类"]')!;
    await act(async () => {
        select.value = "beasts";
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(36);
    await act(async () => {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(388);
});
test("账号切换清空选中态，不显示上个账号的个人模特", async () => {
    remote = [asset(1)];
    await render();
    await click("我的模特");
    await click("模特1");
    scope = "账号乙";
    remote = [];
    await render();
    await click("我的模特");
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(0);
    expect(button("填入模特").disabled).toBe(true);
    expect(onPick).not.toHaveBeenCalled();
});
test("运行中禁止选择和上传", async () => {
    await render(9, [], true);
    expect(button("黄衣旅行者").disabled).toBe(true);
    await click("我的模特");
    expect(host.querySelector<HTMLButtonElement>(".smo-upload")!.disabled).toBe(true);
});
test("服务端查询失败显示重试，不冒充空素材库", async () => {
    readError = "服务不可用";
    await render();
    await click("我的模特");
    expect(host.textContent).toContain("模特库读取失败");
    expect(host.textContent).not.toContain("这里还没有素材");
    readError = "";
    remote = [asset(1)];
    await click("点击重试");
    expect(host.querySelectorAll(".smo-portrait")).toHaveLength(1);
});
test("个人素材列表读取后续分页并排除无资源与非模特资产", async () => {
    remote = Array.from({ length: 105 }, (_, index) => asset(index));
    remote.push({ ...asset(106), tags: [] });
    const result = await listScriptModels(scope);
    expect(result).toHaveLength(105);
    expect(listAssets).toHaveBeenCalledWith(expect.objectContaining({ query: "剧本" }));
    expect(listAssets).toHaveBeenCalledTimes(2);
});
test("上传类型、空文件与30MB上限在网络请求前校验", async () => {
    expect(() => validateScriptModelFile(new File(["视频"], "a.mp4", { type: "video/mp4" }))).toThrow("JPG");
    expect(() => validateScriptModelFile(new File([], "empty.png", { type: "image/png" }))).toThrow("为空");
    const large = modelFile();
    Object.defineProperty(large, "size", { value: 30 * 1024 * 1024 + 1 });
    await expect(saveScriptModel(scope, large)).rejects.toThrow("30MB");
    expect(uploadResource).not.toHaveBeenCalled();
});
test("账号变更后拒绝上传和收藏写入", async () => {
    await expect(saveScriptModel("其他账号", modelFile())).rejects.toThrow("账号已切换");
    await expect(setScriptModelFavorite("其他账号", asset(1))).rejects.toThrow("账号已切换");
    expect(uploadResource).not.toHaveBeenCalled();
    expect(upsertAsset).not.toHaveBeenCalled();
});
