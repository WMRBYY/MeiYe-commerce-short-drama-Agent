import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToString } from "react-dom/server";

// Run the production hook against a server that can accept start and lose its response.
const dom = new Window({ url: "https://audit.invalid/ecommerce" });
const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
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
const messages = { success: mock(), warning: mock(), error: mock() };
mock.module("antd", () => ({ App: { useApp: () => ({ message: messages, modal: {} }) } }));
mock.module("react-router", () => ({ useBlocker: () => ({ state: "unblocked" }) }));
mock.module("@/stores/use-config-store", () => ({
    useEffectiveConfig: () => config,
    useConfigStore: (select: any) => select({ updateConfig: () => undefined }),
    logicalModelIDForConfig: () => "audit-logical-video",
    modelDisplayName: () => "Audit video",
    modelOptionName: (value: string) => value,
    resolveModelChannel: () => ({ id: "system", scope: "system" }),
    selectableModelsByCapability: (_config: any, capability: string) => (capability === "video" ? ["audit-video"] : []),
}));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (select: any) => select({ user: { id: "audit" }, features: { creditsEnabled: false } }) }));
mock.module("@/lib/model-capabilities", () => ({ modelCapabilityConfigFor: () => ({ video: profile }), normalizeVideoValue: (_profile: any, value: any) => value }));
mock.module("@/services/api/resources", () => ({ resourceFileUrl: (id: string) => `https://audit.invalid/${id}`, uploadResourceFile: mock() }));
mock.module("@/services/api/request", () => ({ ApiError: class extends Error {} }));
mock.module("@/pages/ecommerce/video/replication-quote", () => ({ quoteReplicationTasks: mock() }));
mock.module("@/pages/ecommerce/workflow", () => ({ commerceImageParameters: mock() }));
const receipts = new Map();
mock.module("@/pages/ecommerce/video/replication-submission", () => ({
    loadReplicationSubmission: async (key: string) => receipts.get(key),
    saveReplicationSubmission: async (key: string, value: unknown) => receipts.set(key, value),
    clearReplicationSubmission: async (key: string) => receipts.delete(key),
}));
let created = 0;
let loseResponse = false;
const started: string[] = [];
const updates: any[] = [];
const projects = new Map<string, any>();
const api: any = Object.fromEntries(
    [
        "getReplicationExecution",
        "approveReplicationExecution",
        "cancelVideoReplication",
        "pauseVideoReplication",
        "deleteVideoReplicationProject",
        "getVideoReplicationConfig",
        "getVideoReplicationProject",
        "importVideoReplicationLinkStream",
        "listVideoReplicationProjects",
        "listVideoReplicationGallery",
    ].map((name) => [name, mock()]),
);
api.createVideoReplicationProject = mock(async () => {
    const project = { id: `audit-${++created}`, assets: [], outputs: [], parameters: {}, status: "draft" };
    projects.set(project.id, project);
    return project;
});
api.getVideoReplicationProject = mock(async (id: string) => projects.get(id));
api.updateVideoReplicationProject = mock(async (id: string, input: any) => {
    updates.push(input);
    const project = projects.get(id);
    Object.assign(project, input);
    return project;
});
api.deleteVideoReplicationAsset = mock(async (id: string, assetId: string) => {
    const project = projects.get(id);
    project.assets = project.assets.filter((a: any) => a.id !== assetId);
    return project;
});
api.addVideoReplicationAsset = mock(async (id: string, input: any) => {
    const project = projects.get(id);
    project.assets.push({ ...input, id: `asset-${project.assets.length}` });
    return project;
});
api.startVideoReplication = mock(async (id: string, input: { submissionId: string }) => {
    started.push(id);
    const project = projects.get(id);
    project.status = "analyzing";
    project.parameters.submissionId = input.submissionId;
    if (loseResponse) throw new Error("Network response lost after server accepted request");
    return project;
});
mock.module("@/services/api/video-replication", () => api);
const { useEcommerceVideo } = await import("@/pages/ecommerce/video/use-ecommerce-video");
type State = ReturnType<typeof useEcommerceVideo>;
const material = (slot: string, category: string, id = slot) => ({ slot, category, resourceId: id, name: id });
function stateFor(kind: string, images: any[], extra: any = {}): State {
    dom.localStorage.setItem(
        "ecv-draft:v1:audit",
        JSON.stringify({
            feature: "replace",
            kind,
            images,
            audio: "keep",
            keepMusic: true,
            faceConsent: true,
            ratio: "9:16",
            resolution: "720p",
            notes: "",
            subjectHint: "",
            video: { resourceId: "source-video", name: "source.mp4", durationMs: 10000, width: 720, height: 1280 },
            ...extra,
        }),
    );
    let state!: State;
    function Harness() {
        state = useEcommerceVideo();
        return null;
    }
    renderToString(<Harness />);
    return state;
}
beforeEach(() => {
    receipts.clear();
    created = 0;
    loseResponse = false;
    started.length = 0;
    updates.length = 0;
    projects.clear();
    profile.references.maxImages = 10;
});
afterAll(() => {
    mock.restore();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    dom.happyDOM.abort();
});

for (const [kind, slot, category, target] of [
    ["model", "model", "model_image", "model"],
    ["clothing", "front", "apparel_image", "apparel"],
    ["face", "face", "face_image", "face"],
    ["background", "background", "background_image", "background"],
    ["product", "product", "product_image", "product"],
    ["combination", "model", "model_image", "model"],
])
    test(`six-type real hook request: ${kind}`, async () => {
        const state = stateFor(kind, [material(slot, category)]);
        expect(state.missing).toBe("");
        await state.generate();
        expect(started).toHaveLength(1);
        expect(updates[0].videoType).toBe(target);
        expect(updates[0].parameters.replaceMode).toBe(kind);
        expect(updates[0].parameters.rewriteVoice).toBe(target === "product" || target === "apparel");
    });
for (const [kind, target, slot, category] of [
    ["precise-product", "product", "product", "product_image"],
    ["precise-person", "person", "model", "model_image"],
]) {
    test(`${kind} requires tracking and submits the tracked source`, async () => {
        const images = [material(slot, category)];
        const untracked = stateFor(kind, images);
        expect(untracked.missing).toContain("目标识别与全片跟踪");
        await untracked.generate();
        expect(created).toBe(0);
        const regions = { kind: target, frameMs: 0, boxes: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.4 }], trackingId: "track-1", resourceId: "source-video", startMs: 0, endMs: 10000 };
        const state = stateFor(kind, images, { regions });
        expect(state.missing).toBe("");
        await state.generate();
        expect(started).toHaveLength(1);
        expect(updates[0].parameters).toMatchObject({ replaceMode: kind, targetTrackingId: "track-1", regions: regions.boxes });
    });
}
test("dance submits the dancer references without changing into a video replacement", async () => {
    const state = stateFor("model", [material("model", "model_image")], { feature: "dance" });
    expect(state.missing).toBe("");
    await state.generate();
    expect(started).toHaveLength(1);
    expect(updates[0].videoType).toBe("model");
    expect(updates[0].parameters).toMatchObject({ dance: true, replaceMode: "model", maxReferenceVideos: 0, rewriteVoice: false });
});
test("face consent blocks submission", async () => {
    const state = stateFor("face", [material("face", "face_image")], { faceConsent: false });
    expect(state.missing).toContain("肖像授权");
    await state.generate();
    expect(created).toBe(0);
});
test("mute and uploaded voice keep separate request semantics", () => {
    const images = [material("product", "product_image"), { ...material("voice", "voice_audio"), durationMs: 3000 }];
    expect(stateFor("product", images, { audio: "mute" }).buildParameters()).toMatchObject({ generateAudio: false, rewriteVoice: false, keepOriginalAudio: false });
    expect(stateFor("product", images, { audio: "replace" }).buildParameters()).toMatchObject({ generateAudio: true, rewriteVoice: true, keepOriginalAudio: false });
});
test("rejects excess angles before start", () => {
    profile.references.maxImages = 1;
    const state = stateFor("clothing", [material("front", "apparel_image"), material("back", "apparel_image")]);
    expect(state.missing).toContain("最多接收 1 张");
    expect(state.images).toHaveLength(2);
});
test("retry after lost start response restores the accepted project", async () => {
    loseResponse = true;
    const state = stateFor("product", [material("product", "product_image")]);
    await state.generate();
    await state.generate();
    expect(created).toBe(1);
    expect(started).toEqual(["audit-1"]);
    expect([...projects.values()].map((p) => p.status)).toEqual(["analyzing"]);
});
