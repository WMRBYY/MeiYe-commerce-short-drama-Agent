import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const dom = new Window({ url: "https://audit.invalid/shop/video" });
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
}
let userId = "owner-a";
let namespace: string | undefined;
const config = { videoModel: "audit-video", imageModel: "" };
const profile = {
    operations: ["reference_to_video"],
    references: { maxImages: 10, maxAudios: 1, maxAudioDurationSeconds: 15, maxVideos: 1, maxVideoDurationSeconds: 30, promptMaxChars: 8000 },
    generateAudio: { supported: true },
    duration: { selection: "enum", values: [5, 10, 15] },
    ratios: ["9:16"],
    defaultRatio: "9:16",
    resolutions: ["720p"],
    defaultResolution: "720p",
};
const messages = { success: mock(), warning: mock(), error: mock(), info: mock() };
const modal = { confirm: mock() };
const updateConfig = mock();
const blocker = { state: "unblocked" };
mock.module("antd", () => ({ App: { useApp: () => ({ message: messages, modal }) } }));
mock.module("react-router", () => ({ useBlocker: () => blocker }));
mock.module("@/stores/use-config-store", () => ({
    useEffectiveConfig: () => config,
    useConfigStore: (select: any) => select({ updateConfig }),
    logicalModelIDForConfig: () => "audit-logical-video",
    modelDisplayName: () => "Audit video",
    modelOptionName: (value: string) => value,
    resolveModelChannel: () => ({ id: "system", scope: "system" }),
    selectableModelsByCapability: (_config: any, capability: string) => (capability === "video" ? ["audit-video"] : []),
}));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (select: any) => select({ user: userId ? { id: userId } : null, features: { creditsEnabled: false } }) }));
mock.module("@/lib/model-capabilities", () => ({ modelCapabilityConfigFor: () => ({ video: profile }), normalizeVideoValue: (_profile: any, value: any) => value }));
mock.module("@/services/api/resources", () => ({ resourceFileUrl: (id: string) => `https://audit.invalid/${id}`, uploadResourceFile: mock() }));
mock.module("@/services/api/request", () => ({ ApiError: class extends Error {} }));
mock.module("@/pages/ecommerce/video/replication-quote", () => ({ quoteReplicationTasks: mock() }));
mock.module("@/pages/ecommerce/workflow", () => ({ commerceImageParameters: mock() }));
const receipts = new Map<string, unknown>();
mock.module("@/pages/ecommerce/video/replication-submission", () => ({
    loadReplicationSubmission: async (key: string) => receipts.get(key),
    saveReplicationSubmission: async (key: string, value: unknown) => receipts.set(key, value),
    clearReplicationSubmission: async (key: string) => receipts.delete(key),
}));
let gallery: () => Promise<any[]> = async () => [];
let created = 0;
const api: any = Object.fromEntries(
    [
        "addVideoReplicationAsset",
        "getReplicationExecution",
        "approveReplicationExecution",
        "cancelVideoReplication",
        "pauseVideoReplication",
        "deleteVideoReplicationAsset",
        "deleteVideoReplicationProject",
        "getVideoReplicationProject",
        "listVideoReplicationProjects",
        "startVideoReplication",
        "updateVideoReplicationProject",
    ].map((name) => [name, mock()]),
);
api.getVideoReplicationConfig = async () => ({ restrictVideoModels: false, videoModels: [], disabledKinds: [], maxReferenceSeconds: 120 });
api.listVideoReplicationGallery = () => gallery();
api.createVideoReplicationProject = async () => ({ id: `draft-${++created}` });
api.importVideoReplicationLinkStream = mock(async () => {
    throw new Error("test import failed");
});
mock.module("@/services/api/video-replication", () => api);

const { useEcommerceVideo, canCancelVideoGeneration, isVideoGenerationStopped } = await import("@/pages/ecommerce/video/use-ecommerce-video");
type State = ReturnType<typeof useEcommerceVideo>;
let state!: State;
let root: Root | undefined;
function Harness() {
    state = useEcommerceVideo(namespace ? { draftNamespace: namespace } : undefined);
    return null;
}
async function render() {
    await act(async () => {
        if (!root) {
            const host = dom.document.createElement("div");
            dom.document.body.append(host);
            root = createRoot(host as unknown as HTMLElement);
        }
        root.render(<Harness />);
    });
}
const source = { id: "source-asset", category: "reference_video", resourceId: "source-video", name: "source.mp4", durationMs: 12000, width: 720, height: 1280, isPrimary: true, sortOrder: 0 };
const target = (category = "model_image") => ({ id: "target-asset", category, resourceId: "target", name: "Target", sortOrder: 1 });
function project(parameters: any = {}, assets: any[] = [source, target()]) {
    return { id: "project", status: "completed", assets, runs: [], outputs: [], prompt: "", parameters: { model: "audit-video", logicalModelId: "audit-logical-video", replaceMode: "model", audioMode: "keep", ...parameters } } as any;
}
const draft = {
    feature: "replace",
    kind: "product",
    images: [{ slot: "product", category: "product_image", resourceId: "private-product", name: "Private" }],
    video: source,
    notes: "owner a private brief",
    mentions: [],
    trim: { startMs: 1000, endMs: 11000 },
    regions: { trackingId: "private-track" },
    faceConsent: true,
    audio: "keep",
    keepMusic: true,
    ratio: "9:16",
    resolution: "720p",
};
beforeEach(() => {
    userId = "owner-a";
    namespace = undefined;
    created = 0;
    gallery = async () => [];
    dom.localStorage.clear();
    receipts.clear();
    api.importVideoReplicationLinkStream.mockClear();
    api.pauseVideoReplication.mockReset();
    api.cancelVideoReplication.mockReset();
});
afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    dom.document.body.innerHTML = "";
});
afterAll(() => {
    mock.restore();
    for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
});

test("editing a dance preserves dance generation semantics", async () => {
    await render();
    await act(async () => state.edit(project({ dance: true })));
    expect(state.feature).toBe("dance");
    expect(state.buildParameters()).toMatchObject({ dance: true, replaceMode: "model", maxReferenceVideos: 0 });
    expect(state.missing).toBe("");
});
for (const [mode, kind, category] of [
    ["precise-person", "person", "model_image"],
    ["precise-product", "product", "product_image"],
]) {
    for (const trimmed of [false, true]) {
        test(`editing ${mode} retains ${trimmed ? "trimmed" : "full"} tracking and primary video`, async () => {
            await render();
            const boxes = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }];
            await act(async () =>
                state.edit(
                    project({ replaceMode: mode, targetTrackingId: "track-1", regions: boxes, regionFrameMs: 2000, ...(trimmed ? { trimStartMs: 1000, trimEndMs: 11000 } : {}) }, [
                        ...(trimmed ? [{ ...source, id: "other", resourceId: "other", isPrimary: false }] : []),
                        source,
                        target(category),
                    ]),
                ),
            );
            expect(state.video?.resourceId).toBe("source-video");
            expect(state.regions).toMatchObject({ trackingId: "track-1", resourceId: "source-video", kind, startMs: trimmed ? 1000 : 0, endMs: trimmed ? 11000 : 12000 });
            expect(state.missing).toBe("");
            expect(state.buildParameters().targetTrackingId).toBe("track-1");
            await act(async () => state.pickVideo({ resourceId: "new-source", name: "new.mp4", durationMs: 12000 }));
            expect(state.missing).toContain("目标识别与全片跟踪");
        });
    }
}
test("switching to an account with no draft clears private material and gallery before persisting", async () => {
    dom.localStorage.setItem("ecv-draft:v1:owner-a", JSON.stringify(draft));
    gallery = async () => [project()];
    await render();
    expect(state.images).toHaveLength(1);
    expect(state.projects).toHaveLength(1);
    userId = "owner-b";
    gallery = () => new Promise(() => {});
    await render();
    expect(state.images).toEqual([]);
    expect(state.projects).toEqual([]);
    expect(state.video).toBeNull();
    expect(state.notes).toBe("");
    expect(state.regions).toBeNull();
    expect(state.faceConsent).toBe(false);
    dom.dispatchEvent(new dom.Event("pagehide"));
    expect(JSON.parse(dom.localStorage.getItem("ecv-draft:v1:owner-b")!).images).toEqual([]);
    expect(JSON.parse(dom.localStorage.getItem("ecv-draft:v1:owner-a")!).notes).toBe(draft.notes);
});
test("logout clears private draft and an old gallery response cannot populate another account", async () => {
    dom.localStorage.setItem("ecv-draft:v1:owner-a", JSON.stringify(draft));
    let finish!: (items: any[]) => void;
    gallery = () =>
        new Promise((resolve) => {
            finish = resolve;
        });
    await render();
    userId = "";
    await render();
    expect(state.images).toEqual([]);
    expect(state.notes).toBe("");
    await act(async () => finish([project()]));
    expect(state.projects).toEqual([]);
});
test("canvas node changes restore their own draft and release the previous draft project", async () => {
    namespace = "node-a";
    dom.localStorage.setItem("ecv-draft:v1:owner-a:node-a", JSON.stringify(draft));
    dom.localStorage.setItem("ecv-draft:v1:owner-a:node-b", JSON.stringify({ ...draft, notes: "node b", images: [] }));
    await render();
    await act(async () => state.parseLink("https://example.com/a"));
    namespace = "node-b";
    await render();
    expect(state.notes).toBe("node b");
    expect(state.images).toEqual([]);
    await act(async () => state.parseLink("https://example.com/b"));
    expect(created).toBe(2);
    expect(api.importVideoReplicationLinkStream.mock.calls.map((call: any[]) => call[0])).toEqual(["draft-1", "draft-2"]);
});

test("a regeneration accepted for the previous account never enters the new account gallery", async () => {
    let finish!: (value: any) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    api.startVideoReplication.mockImplementation(
        () =>
            new Promise((resolve) => {
                finish = resolve;
                markStarted();
            }),
    );
    await render();
    let pending!: Promise<void>;
    await act(async () => {
        pending = state.regenerate(project({ viralSource: "script-source" }));
        await started;
    });
    userId = "owner-b";
    await render();
    await act(async () => {
        finish(project());
        await pending;
    });
    expect(state.projects).toEqual([]);
});

const stopReason = "已暂停：进行中的镜头会继续完成，后续片段不再自动提交";
const runningProject = () => ({ ...project(), status: "generating", runs: [{ taskId: "task-1", status: "running" }] });
test("cancellation persists pause before calling task cancellation", async () => {
    const running = runningProject();
    const paused = { ...running, paused: true, pauseReason: stopReason };
    const calls: string[] = [];
    let finishPause!: (value: any) => void;
    api.pauseVideoReplication.mockImplementation((id: string, pause: boolean) => {
        expect([id, pause]).toEqual([running.id, true]);
        calls.push("pause");
        return new Promise((resolve) => {
            finishPause = resolve;
        });
    });
    api.cancelVideoReplication.mockImplementation(async () => {
        calls.push("cancel");
        return paused;
    });
    gallery = async () => [running];
    await render();
    let pending!: ReturnType<State["cancel"]>;
    await act(async () => {
        pending = state.cancel(running);
    });
    expect(calls).toEqual(["pause"]);
    await act(async () => {
        finishPause(paused);
        await pending;
    });
    expect(calls).toEqual(["pause", "cancel"]);
    expect(isVideoGenerationStopped(state.projects[0])).toBe(true);
});

test("pause failure never calls task cancellation or reports a stopped project", async () => {
    const running = runningProject();
    api.pauseVideoReplication.mockImplementation(async () => {
        throw new Error("pause unavailable");
    });
    gallery = async () => [running];
    await render();
    await act(async () => {
        await expect(state.cancel(running)).rejects.toThrow("pause unavailable");
    });
    expect(api.cancelVideoReplication).not.toHaveBeenCalled();
    expect(Boolean(isVideoGenerationStopped(state.projects[0]))).toBe(false);
});

test("task cancellation failure retains the persisted pause and retry does not unpause", async () => {
    const running = runningProject();
    const paused = { ...running, paused: true, pauseReason: stopReason };
    api.pauseVideoReplication.mockResolvedValue(paused);
    api.cancelVideoReplication.mockRejectedValue(new Error("cancel unavailable"));
    gallery = async () => [running];
    await render();
    await act(async () => {
        await expect(state.cancel(running)).rejects.toThrow("cancel unavailable");
    });
    expect(isVideoGenerationStopped(state.projects[0])).toBe(true);
    api.cancelVideoReplication.mockResolvedValue(paused);
    await act(async () => {
        await state.cancel(state.projects[0]);
    });
    expect(api.pauseVideoReplication).toHaveBeenCalledTimes(1);
    expect(api.cancelVideoReplication).toHaveBeenCalledTimes(2);
    expect(isVideoGenerationStopped(state.projects[0])).toBe(true);
});

test("all nine replication types expose cancellation only with an existing active task", () => {
    for (const kind of ["model", "clothing", "face", "background", "product", "precise-product", "precise-person", "combination", "dance"]) {
        const running = { ...runningProject(), parameters: { ...project().parameters, replaceMode: kind === "dance" ? "model" : kind, dance: kind === "dance" } };
        expect(canCancelVideoGeneration(running)).toBe(true);
        expect(canCancelVideoGeneration({ ...running, status: "analyzing" })).toBe(false);
        expect(canCancelVideoGeneration({ ...running, runs: [] })).toBe(false);
        expect(canCancelVideoGeneration({ ...running, runs: [{ status: "submitting" }] })).toBe(false);
        const paused = { ...running, paused: true, pauseReason: stopReason };
        expect(canCancelVideoGeneration(paused)).toBe(false);
        expect(canCancelVideoGeneration(paused, true)).toBe(true);
    }
    expect(canCancelVideoGeneration({ ...runningProject(), status: "composing", runs: [], outputs: [{ taskId: "compose", status: "queued" }] })).toBe(true);
});
