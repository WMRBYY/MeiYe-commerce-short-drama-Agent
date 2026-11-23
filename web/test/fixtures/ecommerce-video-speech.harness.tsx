import { afterAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToString } from "react-dom/server";
import type { VideoDraft } from "@/pages/ecommerce/video/video-draft";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
const config = { videoModel: "test-video", imageModel: "" };
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

mock.module("antd", () => ({ App: { useApp: () => ({ message: {}, modal: {} }) } }));
mock.module("react-router", () => ({ useBlocker: () => ({ state: "unblocked" }) }));
mock.module("@/stores/use-config-store", () => ({
    useEffectiveConfig: () => config,
    useConfigStore: (select: (state: unknown) => unknown) => select({ updateConfig: () => undefined }),
    logicalModelIDForConfig: () => "system-video",
    modelDisplayName: () => "Test video",
    modelOptionName: (value: string) => value,
    resolveModelChannel: () => ({ id: "system", scope: "system" }),
    selectableModelsByCapability: (_config: unknown, capability: string) => (capability === "video" ? ["test-video"] : []),
}));
mock.module("@/stores/use-user-store", () => ({
    useUserStore: (select: (state: unknown) => unknown) => select({ user: { id: "speech-test" }, features: { creditsEnabled: false } }),
}));
mock.module("@/lib/model-capabilities", () => ({ modelCapabilityConfigFor: () => ({ video: profile }), normalizeVideoValue: (_profile: unknown, value: unknown) => value }));
mock.module("@/services/api/resources", () => ({ resourceFileUrl: (id: string) => `https://media.example.com/${id}`, uploadResourceFile: mock() }));
mock.module("@/services/api/request", () => ({ ApiError: class extends Error {} }));
mock.module("@/pages/ecommerce/video/replication-quote", () => ({ quoteReplicationTasks: mock() }));
mock.module("@/pages/ecommerce/workflow", () => ({ commerceImageParameters: mock() }));
mock.module("@/services/api/video-replication", () =>
    Object.fromEntries(
        [
            "addVideoReplicationAsset",
            "getReplicationExecution",
            "approveReplicationExecution",
            "cancelVideoReplication",
            "pauseVideoReplication",
            "listVideoReplicationGallery",
            "createVideoReplicationProject",
            "deleteVideoReplicationAsset",
            "deleteVideoReplicationProject",
            "getVideoReplicationConfig",
            "getVideoReplicationProject",
            "importVideoReplicationLinkStream",
            "listVideoReplicationProjects",
            "startVideoReplication",
            "updateVideoReplicationProject",
        ].map((name) => [name, mock()]),
    ),
);

const { useEcommerceVideo } = await import("@/pages/ecommerce/video/use-ecommerce-video");
type State = ReturnType<typeof useEcommerceVideo>;

// Server rendering runs the real hook and request builder without effects or API calls.
function parameters(patch: Partial<VideoDraft>) {
    dom.localStorage.setItem("ecv-draft:v1:speech-test", JSON.stringify({ feature: "replace", kind: "product", images: [], audio: "keep", keepMusic: true, ratio: "9:16", resolution: "720p", ...patch }));
    let state: State | undefined;
    function Harness() {
        state = useEcommerceVideo();
        return null;
    }
    renderToString(<Harness />);
    return state!.buildParameters();
}

afterAll(() => {
    mock.restore();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    dom.happyDOM.abort();
});

describe("商品视频提交的口播语义", () => {
    test("商品和服饰保留音乐时仍请求新商品口播，不无条件新增字幕", () => {
        for (const kind of ["product", "clothing"] as const) {
            const result = parameters({ kind });
            expect(result).toMatchObject({ rewriteVoice: true, keepOriginalAudio: true, audioMode: "keep", generateAudio: true, subtitles: false });
        }
    });

    test("组合替换由当前上传的商品决定，不沿用隐藏素材的商品语义", () => {
        const image = { slot: "product", category: "product_image" as const, resourceId: "apple", name: "苹果" };
        expect(parameters({ kind: "combination", images: [image] }).rewriteVoice).toBe(true);
        expect(parameters({ kind: "combination", images: [{ ...image, slot: "model", category: "model_image" }] }).rewriteVoice).toBe(false);
        expect(parameters({ kind: "precise-person", images: [image] }).rewriteVoice).toBe(false);
    });

    test("静音不请求配音，上传音色后仍改写新商品台词", () => {
        expect(parameters({ audio: "mute" })).toMatchObject({ rewriteVoice: false, audioMode: "mute", keepOriginalAudio: false, generateAudio: false });
        const voice = { slot: "voice", category: "voice_audio" as const, resourceId: "voice", name: "音色", durationMs: 3000 };
        expect(parameters({ kind: "product", audio: "replace", images: [voice] })).toMatchObject({ rewriteVoice: true, audioMode: "replace", keepOriginalAudio: false, generateAudio: true });
        expect(parameters({ kind: "model", audio: "replace", images: [voice] })).toMatchObject({ rewriteVoice: false, audioMode: "replace", keepOriginalAudio: false, generateAudio: true });
    });

    test("精准人物、换脸、背景和舞蹈不被商品改词策略影响", () => {
        for (const kind of ["precise-person", "model", "face", "background"] as const) {
            expect(parameters({ kind })).toMatchObject({ rewriteVoice: false, audioMode: "keep", keepOriginalAudio: true });
        }
        expect(parameters({ feature: "dance", kind: "product" }).rewriteVoice).toBe(false);
    });
});
