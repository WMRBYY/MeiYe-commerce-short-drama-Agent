import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { apiClient } from "../src/services/api/request";
import { cancelClip, createClip, getClip, getClipCapabilities, listClips, quoteClip, renderClip, retryClip, saveClipPlan, type ClipCapabilities, type ClipPlan, type ClipProject } from "../src/services/api/video-edit";
import { clipPlanError, clipTitleError, clipTrimError, validSubjectBox } from "../src/pages/shop/clip/clip-model";

const plan = (): ClipPlan => ({
    version: 2,
    templateVersion: 1,
    sourceResourceId: "source",
    materials: ["broll"],
    transcript: [
        { startMs: 0, endMs: 1000, text: "商品细节" },
        { startMs: 1000, endMs: 2000, text: "展示效果" },
    ],
    placements: [{ resourceId: "broll", startMs: 0, endMs: 1000, sourceStartMs: 100 }],
    templateId: "clean",
    title: "新品",
    behindText: "新品上市",
    behindPosition: "center",
    subjectBox: [0.1, 0.1, 0.6, 0.8],
    width: 1080,
    height: 1920,
    durationMs: 3000,
});
const project = (status: ClipProject["status"] = "ready"): ClipProject => ({
    id: "clip-1",
    mode: "mix",
    title: "新品",
    status,
    retryStage: status === "analyzing" ? "analyze" : "render",
    stage: "字幕已识别",
    progress: 100,
    error: "",
    plan: plan(),
    outputResourceId: "",
    taskId: "",
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
});
const capabilities = (enabled = true): ClipCapabilities => ({
    modes: { koubo: { enabled }, mix: { enabled }, subtitle: { enabled }, behind: { enabled } },
    renderModes: { koubo: { enabled }, mix: { enabled }, subtitle: { enabled }, behind: { enabled } },
    autoModes: { koubo: { enabled }, mix: { enabled }, subtitle: { enabled }, behind: { enabled } },
    templates: [{ id: "clean", name: "简洁", description: "清晰字幕" }],
});
const fixedQuote = { credits: 10, chargeMode: "fixed", label: "10 积分 / 条", chargeAt: "submit" };

describe("剪辑计划验证", () => {
    test("接受连续字幕与有效素材引用", () => expect(clipPlanError(plan(), "mix")).toBe(""));
    test("字幕重叠、反向、越界、空文本均阻止渲染", () => {
        for (const patch of [{ startMs: -1 }, { endMs: 4000 }, { endMs: 0 }, { text: " " }, { startMs: NaN }]) {
            const value = plan();
            value.transcript[0] = { ...value.transcript[0], ...patch };
            expect(clipPlanError(value, "subtitle")).not.toBe("");
        }
        const overlap = plan();
        overlap.transcript[1].startMs = 900;
        expect(clipPlanError(overlap, "subtitle")).toContain("重叠");
    });
    test("混剪必须引用上传素材且片段不能重叠", () => {
        const missing = plan();
        missing.placements[0].resourceId = "unknown";
        expect(clipPlanError(missing, "mix")).toContain("未上传");
        const overlap = plan();
        overlap.placements.push({ ...overlap.placements[0], startMs: 500, endMs: 1500 });
        expect(clipPlanError(overlap, "mix")).toContain("重叠");
        const empty = plan();
        empty.placements = [];
        expect(clipPlanError(empty, "mix")).toContain("至少一段");
    });
    test("字在人后不可用默认或非法人物框冒充选择", () => {
        expect(validSubjectBox(undefined)).toBe(false);
        for (const box of [
            [0, 0, 0, 0],
            [-0.1, 0, 0.5, 0.5],
            [0.6, 0, 0.6, 0.5],
            [NaN, 0, 0.5, 0.5],
        ])
            expect(validSubjectBox(box)).toBe(false);
        const value = plan();
        value.transcript = [];
        value.placements = [];
        expect(clipPlanError(value, "behind")).toBe("");
        value.subjectBox = undefined;
        expect(clipPlanError(value, "behind")).toContain("框选");
    });
    test("音乐音量与文字长度遵守渲染器边界", () => {
        const value = plan();
        value.musicResourceId = "music";
        value.musicVolume = 0.6;
        expect(clipPlanError(value, "koubo")).toContain("音量");
        value.musicVolume = 0.15;
        value.title = "字".repeat(101);
        expect(clipPlanError(value, "koubo")).toContain("100");
    });
    test("标题必填并按字符计数，片段必须落在源视频范围内", () => {
        expect(clipTitleError("   ")).not.toBe("");
        expect(clipTitleError("新品".repeat(50))).toBe("");
        expect(clipTitleError("✨".repeat(101))).toContain("100");
        expect(clipTrimError(0, 0, 2000)).toBe("");
        expect(clipTrimError(1000, 1500, 2000)).toBe("");
        for (const [start, end] of [
            [-1, 1000],
            [500, 600],
            [1000, 1200],
            [1000, 1499],
            [0, 2100],
            [NaN, 1000],
        ])
            expect(clipTrimError(start, end, 2000)).not.toBe("");
    });
});

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});
const response = (config: InternalAxiosRequestConfig, data: unknown, code = 0) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code, data, msg: code ? "素材不可读" : "", reason: code ? "clip_asset_unreadable" : undefined } });

describe("剪辑 API 契约", () => {
    test("所有读取和变更使用剪辑域，保留校对版本和完整引用", async () => {
        const calls: Array<{ method?: string; url?: string; body?: unknown }> = [];
        apiClient.defaults.adapter = async (config) => {
            calls.push({ method: config.method, url: config.url, body: config.data ? JSON.parse(config.data) : undefined });
            return response(config, project());
        };
        await getClipCapabilities();
        await listClips();
        await getClip("id/1");
        await createClip({ idempotencyKey: "key", expectedCredits: 10, mode: "mix", sourceResourceId: "source", materialResourceIds: ["broll"], templateId: "clean", title: "新品" });
        await saveClipPlan("id/1", plan());
        await renderClip("id/1", "render-key", plan());
        await cancelClip("id/1");
        await retryClip("id/1", "retry-key");
        expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
            "get /ecommerce/clips/capabilities",
            "get /ecommerce/clips",
            "get /ecommerce/clips/id%2F1",
            "post /ecommerce/clips",
            "put /ecommerce/clips/id%2F1/plan",
            "post /ecommerce/clips/id%2F1/render",
            "post /ecommerce/clips/id%2F1/cancel",
            "post /ecommerce/clips/id%2F1/retry",
        ]);
        expect(calls[4].body).toEqual({ plan: plan() });
        expect(calls[5].body).toEqual({ idempotencyKey: "render-key", plan: plan() });
    });
    test("HTTP 200 的业务失败不会成为成功项目", async () => {
        apiClient.defaults.adapter = async (config) => response(config, null, 400);
        await expect(renderClip("clip", "key", plan())).rejects.toMatchObject({ reason: "clip_asset_unreadable" });
    });
    test("报价使用真实服务端结果并传递全部剪辑选择", async () => {
        let body: unknown;
        apiClient.defaults.adapter = async (config) => {
            expect(config.url).toBe("/ecommerce/clips/quote");
            body = JSON.parse(config.data);
            return response(config, fixedQuote);
        };
        const input = {
            mode: "koubo" as const,
            sourceResourceId: "source",
            title: "通勤质感",
            templateId: "bubble",
            autoRender: true,
            referenceText: "316L 不锈钢",
            trimStartMs: 1000,
            trimEndMs: 4000,
            visual: { subtitleStyle: "bubble" as const, animation: "pop" as const, filter: "warm" as const, transition: "cut" as const, widget: "label" as const, layout: "full" as const },
        };
        expect(await quoteClip(input)).toEqual(fixedQuote);
        expect(body).toEqual(input);
    });
});

const dom = new Window({ url: "http://localhost/shop/clip" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Node: dom.Node, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useVideoEdit } = await import("../src/pages/shop/clip/use-video-edit");
let state: ReturnType<typeof useVideoEdit>;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
function Probe() {
    state = useVideoEdit("user-1");
    return null;
}
async function mount(adapter: AxiosAdapter) {
    apiClient.defaults.adapter = adapter;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(
            <StrictMode>
                <Probe />
            </StrictMode>,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
}
async function waitForQuote() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
    });
}
beforeEach(() => dom.localStorage.clear());
afterEach(async () => {
    if (root) {
        await act(async () => root!.unmount());
        root = undefined;
        host.remove();
    }
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [name, value] of originals) {
        if (value) Object.defineProperty(globalThis, name, value);
        else Reflect.deleteProperty(globalThis, name);
    }
});

describe("剪辑提交状态", () => {
    test("字幕撤销保留项目版本，保存或切换项目后清空历史", async () => {
        let saved = project();
        const other = { ...project(), id: "clip-2" };
        await mount(async (config) => {
            if (config.method === "put") {
                saved = { ...saved, plan: { ...JSON.parse(config.data).plan, version: 3 } };
                return response(config, saved);
            }
            return response(config, config.url?.endsWith("capabilities") ? capabilities() : { items: [saved, other] });
        });
        await act(async () => state.select(saved));
        await act(async () => state.patchPlan({ transcript: [] }));
        expect(state.canUndoCaptions).toBe(true);
        expect(state.planError).toContain("添加字幕");
        await act(async () => state.undoCaptions());
        expect(state.plan?.transcript).toEqual(saved.plan.transcript);
        expect(state.plan?.version).toBe(2);
        expect(state.canRedoCaptions).toBe(true);
        await act(async () => state.redoCaptions());
        expect(state.plan?.transcript).toEqual([]);
        await act(async () => state.undoCaptions());
        await act(async () => state.save());
        expect(state.plan?.version).toBe(3);
        expect(state.canUndoCaptions).toBe(false);
        await act(async () => state.patchPlan({ transcript: [] }));
        await act(async () => state.select(other));
        expect(state.canUndoCaptions).toBe(false);
        expect(state.canRedoCaptions).toBe(false);
        await act(async () => state.undoCaptions());
        expect(state.selected?.id).toBe("clip-2");
        expect(state.plan?.transcript).toEqual(plan().transcript);
    });
    test("ASR不可用时，已校对方案仍可导出，重试按后端阶段判断", async () => {
        let posts = 0;
        const ready = project();
        await mount(async (config) => {
            if (config.url?.endsWith("/quote")) return response(config, { credits: 0, chargeMode: "free", label: "历史项目免费", chargeAt: "render" });
            if (config.method === "post") {
                posts++;
                return response(config, project("rendering"));
            }
            return response(config, config.url?.endsWith("capabilities") ? { ...capabilities(false), renderModes: capabilities().renderModes } : { items: [ready] });
        });
        await act(async () => state.select(ready));
        expect(state.availability).toBe("");
        expect(state.retryAvailability({ ...project("failed"), retryStage: "render" })).toBe("");
        expect(state.retryAvailability({ ...project("failed"), retryStage: "analyze" })).not.toBe("");
        await waitForQuote();
        await act(async () => {
            await state.render();
        });
        expect(posts).toBe(1);
    });
    test("配置未开放时无法提交，不产生后台任务", async () => {
        let posts = 0;
        await mount(async (config) => {
            if (config.method === "post") posts++;
            return response(config, config.url?.endsWith("capabilities") ? capabilities(false) : { items: [] });
        });
        await act(async () => state.setSource({ resourceId: "source", name: "video.mp4" }));
        await act(async () => {
            await state.analyze();
        });
        expect(posts).toBe(0);
        expect(state.availability).not.toBe("");
    });
    test("连续点击只提交一次，严格模式下仍接收真实项目", async () => {
        let posts = 0;
        await mount(async (config) => {
            if (config.url?.endsWith("/quote")) return response(config, fixedQuote);
            if (config.method === "post") {
                posts++;
                return response(config, project("analyzing"));
            }
            return response(config, config.url?.endsWith("capabilities") ? capabilities() : { items: [] });
        });
        await act(async () => state.setSource({ resourceId: "source", name: "video.mp4" }));
        await act(async () => state.setTitle("新品口播"));
        await waitForQuote();
        await act(async () => {
            await Promise.all([state.analyze(), state.analyze()]);
        });
        expect(posts).toBe(1);
        expect(state.selected?.id).toBe("clip-1");
        expect(state.selected?.status).toBe("analyzing");
    });
    test("空标题不报价不创建；一键生成携带校对文案、选段和视觉选择", async () => {
        const calls: Array<{ url?: string; input: Record<string, unknown> }> = [];
        await mount(async (config) => {
            if (config.method === "post") {
                calls.push({ url: config.url, input: JSON.parse(config.data) });
                return response(config, config.url?.endsWith("quote") ? fixedQuote : project("analyzing"));
            }
            return response(config, config.url?.endsWith("capabilities") ? capabilities() : { items: [] });
        });
        await act(async () => state.setSource({ resourceId: "source", name: "video.mp4", durationMs: 5000 }));
        await act(async () => {
            await state.analyze();
            await new Promise((resolve) => setTimeout(resolve, 400));
        });
        expect(calls).toEqual([]);
        expect(state.error).toContain("标题");
        await act(async () => {
            state.setTitle("  通勤穿出风格  ");
            state.setReferenceText("品牌原话");
            state.setTrim(1000, 4000);
            state.setVisual({ subtitleStyle: "bubble", animation: "rise", filter: "soft", transition: "cut", widget: "none", layout: "full" });
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
        });
        expect(state.quote?.credits).toBe(10);
        await act(async () => {
            await state.analyze();
        });
        expect(calls.map((call) => call.url)).toEqual(["/ecommerce/clips/quote", "/ecommerce/clips"]);
        expect(calls[1].input).toMatchObject({ expectedCredits: 10, title: "通勤穿出风格", autoRender: true, referenceText: "品牌原话", trimStartMs: 1000, trimEndMs: 4000, visual: { subtitleStyle: "bubble", animation: "rise" } });
    });
    test("自动链路不可用时允许主动选择先分析校对", async () => {
        let body: Record<string, unknown> | undefined;
        await mount(async (config) => {
            if (config.url?.endsWith("/quote")) return response(config, { ...fixedQuote, chargeAt: "render" });
            if (config.method === "post") {
                body = JSON.parse(config.data);
                return response(config, project("analyzing"));
            }
            return response(config, config.url?.endsWith("capabilities") ? { ...capabilities(), autoModes: capabilities(false).autoModes } : { items: [] });
        });
        await act(async () => {
            state.setSource({ resourceId: "source", name: "video.mp4" });
            state.setTitle("校对作品");
        });
        expect(state.availability).not.toBe("");
        await act(async () => state.setReviewBeforeRender(true));
        expect(state.availability).toBe("");
        await waitForQuote();
        await act(async () => {
            await state.analyze();
        });
        expect(body?.autoRender).toBe(false);
    });
    test("非法校对无法渲染，合法校对携带服务端版本", async () => {
        let body: unknown;
        await mount(async (config) => {
            if (config.url?.endsWith("/quote")) return response(config, { ...fixedQuote, chargeAt: "render" });
            if (config.method === "post") {
                body = JSON.parse(config.data);
                return response(config, project("rendering"));
            }
            return response(config, config.url?.endsWith("capabilities") ? capabilities() : { items: [project()] });
        });
        await act(async () => state.select(project()));
        await act(async () => state.patchPlan({ transcript: [{ startMs: 0, endMs: 4000, text: "超长字幕" }] }));
        await act(async () => {
            await state.render();
        });
        expect(body).toBeUndefined();
        expect(state.planError).toContain("超过");
        await act(async () => state.patchPlan({ transcript: plan().transcript }));
        await waitForQuote();
        await act(async () => {
            await state.render();
        });
        expect(body).toMatchObject({ expectedCredits: 10, plan: { version: 2, sourceResourceId: "source", materials: ["broll"] } });
    });
    test("价格变化会刷新报价，必须再次点击且发送最新确认价格", async () => {
        let price = 10;
        const attempts: number[] = [];
        await mount(async (config) => {
            if (config.url?.endsWith("/quote")) return response(config, { ...fixedQuote, credits: price });
            if (config.method === "post") {
                attempts.push(JSON.parse(config.data).expectedCredits);
                if (attempts.length === 1) {
                    price = 12;
                    return { ...response(config, null), data: { code: 409, msg: "价格已变化", reason: "shop_clip_price_changed" } };
                }
                return response(config, project("analyzing"));
            }
            return response(config, config.url?.endsWith("capabilities") ? capabilities() : { items: [] });
        });
        await act(async () => {
            state.setSource({ resourceId: "source", name: "video.mp4" });
            state.setTitle("确认价格");
        });
        await act(async () => {
            await state.analyze();
        });
        expect(attempts).toEqual([]);
        await waitForQuote();
        await act(async () => {
            await state.analyze();
        });
        expect(state.error).toContain("价格已更新");
        await waitForQuote();
        expect(state.quote?.credits).toBe(12);
        expect(attempts).toEqual([10]);
        await act(async () => {
            await state.analyze();
        });
        expect(attempts).toEqual([10, 12]);
    });
    test("历史重试按项目报价，不使用新建价格，操作成功刷新余额", async () => {
        const failed = { ...project("failed"), plan: { ...plan(), pricingVersion: 1, credits: 7 } };
        const quoteBodies: unknown[] = [];
        let retryBody: unknown;
        let walletUpdates = 0;
        const changed = () => {
            walletUpdates++;
        };
        window.addEventListener("wallet:updated", changed);
        try {
            await mount(async (config) => {
                if (config.url?.endsWith("/quote")) {
                    quoteBodies.push(JSON.parse(config.data));
                    return response(config, { ...fixedQuote, credits: 7 });
                }
                if (config.url?.endsWith("/retry")) {
                    retryBody = JSON.parse(config.data);
                    return response(config, project("rendering"));
                }
                return response(config, config.url?.endsWith("capabilities") ? capabilities() : { items: [failed] });
            });
            await act(async () => {
                await state.retry(failed);
            });
            expect(retryBody).toBeUndefined();
            await waitForQuote();
            expect(quoteBodies).toEqual([{ projectId: failed.id }]);
            await act(async () => {
                await state.retry(failed);
            });
            expect(retryBody).toMatchObject({ expectedCredits: 7 });
            expect(walletUpdates).toBe(1);
        } finally {
            window.removeEventListener("wallet:updated", changed);
        }
    });
});
