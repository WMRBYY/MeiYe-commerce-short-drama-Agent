import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToString } from "react-dom/server";
import { act, createElement, forwardRef, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EcommerceWorkRemix } from "@/services/api/canvas-templates";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom : Reflect.get(dom, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: typeof value === "function" && (key.endsWith("AnimationFrame") || key === "getComputedStyle") ? value.bind(dom) : value });
}
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

mock.module("antd", () => ({ App: { useApp: () => ({ message: { success: mock(), warning: mock(), error: mock() }, modal: {} }) } }));
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
    useUserStore: Object.assign((select: (state: unknown) => unknown) => select({ user: { id: "speech-test" }, features: { creditsEnabled: false } }), { getState: () => ({ user: { id: "speech-test" } }) }),
}));
mock.module("@/lib/model-capabilities", () => ({ modelCapabilityConfigFor: () => ({ video: profile }), normalizeVideoValue: (_profile: unknown, value: unknown) => value }));
mock.module("@/services/api/resources", () => ({ resourceFileUrl: (id: string) => `https://media.example.com/${id}`, uploadResourceFile: mock(async () => ({ id: "uploaded-product" })) }));
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
            "createVideoReplicationProject",
            "deleteVideoReplicationAsset",
            "deleteVideoReplicationProject",
            "getVideoReplicationConfig",
            "getVideoReplicationProject",
            "importVideoReplicationLinkStream",
            "listVideoReplicationProjects",
            "listVideoReplicationGallery",
            "startVideoReplication",
            "updateVideoReplicationProject",
        ].map((name) => [name, name === "listVideoReplicationGallery" ? mock(async () => []) : name === "getVideoReplicationConfig" ? mock(async () => ({ enabled: true, configured: true, maxReferenceSeconds: 120, disabledKinds: [] })) : mock()]),
    ),
);

const { useEcommerceVideo } = await import("@/pages/ecommerce/video/use-ecommerce-video");
type State = ReturnType<typeof useEcommerceVideo>;
const animated = new Map<string, unknown>();
mock.module("motion/react", () => ({
    AnimatePresence: ({ children }: any) => children,
    useReducedMotion: () => true,
    motion: new Proxy(
        {},
        {
            get: (_, tag: string) => {
                if (!animated.has(tag))
                    animated.set(
                        tag,
                        forwardRef(({ layout, layoutId, initial, animate, exit, transition, whileTap, whileHover, children, ...props }: any, ref) => createElement(tag, { ...props, ref }, children)),
                    );
                return animated.get(tag);
            },
        },
    ),
}));
mock.module("@/components/ui/base/tooltip/ant-tooltip", () => ({ AntTooltip: ({ children }: any) => children }));
mock.module("@/pages/ecommerce/video/reference-link-dialog", () => ({ ReferenceLinkDialog: () => null, referencePick: mock() }));
mock.module("@/components/rolling-credit-text", () => ({ RollingCreditAmount: () => null }));
mock.module("@/components/ui/credit-star", () => ({ CreditStar: () => null }));
mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => "speech-test" }));
mock.module("@/pages/workbench/workbench-asset-picker", () => ({ WorkbenchAssetPicker: () => null }));
mock.module("@/pages/ecommerce/video/video-editors", () => ({ RegionSelectModal: () => null, TrimVideoModal: () => null }));
mock.module("@/pages/ecommerce/tryon/reference-library", () => ({ TryOnReferenceLibrary: () => null }));
mock.module("@/pages/shop/shop-media-library", () => ({ ShopMediaLibrary: () => null }));
mock.module("@/pages/shop/shop-reference-preview", () => ({ ShopReferencePreview: () => null }));
mock.module("@/pages/shop/script/script-model-library", () => ({ ScriptModelLibrary: () => null }));
mock.module("@/pages/shop/shop-material-library-button", () => ({ ShopMaterialLibraryButton: () => null }));
mock.module("@/pages/shop/shop-media-mode", () => ({ ShopMediaMode: () => null }));
const { ShopVideoComposer } = await import("@/pages/shop/shop-video-composer");
const { replaceKindConfig } = await import("@/pages/ecommerce/video/video-kinds");
let latest: State;
let root: Root | null = null;
let host: HTMLDivElement | undefined;
const productWork: EcommerceWorkRemix = {
    prompt: "保留原片创意",
    replaceMode: "product",
    subjectHint: "香水",
    productName: "旧款香水",
    materials: [
        { resourceId: "template-video", category: "reference_video", name: "原片", width: 720, height: 1280, durationMs: 10000 },
        { resourceId: "perfume", category: "product_image", name: "香水图", width: 800, height: 800, durationMs: 0 },
    ],
};
async function mountComposer() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    function Harness() {
        latest = useEcommerceVideo({ draftNamespace: "state-regressions" });
        return <ShopVideoComposer state={latest} />;
    }
    await act(async () => root!.render(<Harness />));
    await act(async () => {
        expect(latest.applyWorkRemix(productWork)).toBe(true);
    });
}
afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    host?.remove();
    dom.localStorage.clear();
});

afterAll(() => {
    mock.restore();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
});

test("模板导入清除旧音色设置，保留商品参数并正确分配服装正反面", () => {
    dom.localStorage.setItem(
        "ecv-draft:v1:speech-test:template-test",
        JSON.stringify({ feature: "replace", kind: "product", images: [{ slot: "voice", category: "voice_audio", resourceId: "old-voice", name: "旧音色", durationMs: 3000 }], audio: "replace", keepMusic: false, talking: true }),
    );
    const work: EcommerceWorkRemix = {
        prompt: "保留开场创意",
        replaceMode: "clothing",
        subjectHint: "连衣裙",
        productName: "蓝色连衣裙",
        materials: [
            { resourceId: "source-video", category: "reference_video", name: "参考视频", width: 720, height: 1280, durationMs: 10000 },
            { resourceId: "front", category: "apparel_image", name: "正面", width: 800, height: 1200, durationMs: 0 },
            { resourceId: "back", category: "apparel_image", name: "反面", width: 800, height: 1200, durationMs: 0 },
        ],
    };
    let state: State | undefined;
    function Harness() {
        state = useEcommerceVideo({ draftNamespace: "template-test" });
        const imported = useRef(false);
        if (!imported.current) {
            imported.current = true;
            expect(state.applyWorkRemix(work)).toBe(true);
        }
        return null;
    }
    renderToString(<Harness />);
    expect(state!.images.map((image) => [image.slot, image.resourceId])).toEqual([
        ["front", "front"],
        ["back", "back"],
    ]);
    expect(state!.audio).toBe("keep");
    expect(state!.keepMusic).toBe(true);
    expect(state!.talking).toBe(false);
    expect(state!.video?.resourceId).toBe("source-video");
    expect(state!.notes).toBe(work.prompt);
    expect(state!.buildParameters()).toMatchObject({ replaceMode: "clothing", subjectHint: "连衣裙", productName: "蓝色连衣裙", audioMode: "keep", keepOriginalAudio: true, talking: false });
});

test("素材库选入视频后，素材卡自动回填元数据并解除生成等待", async () => {
    await mountComposer();
    await act(async () => latest.pickVideo({ resourceId: "library-video", name: "素材库视频" }));
    expect(latest.missing).toBe("正在读取参考视频时长");
    const preview = host!.querySelector(".svc-tile video")!;
    Object.defineProperties(preview, { duration: { configurable: true, value: 8.25 }, videoWidth: { configurable: true, value: 1080 }, videoHeight: { configurable: true, value: 1920 } });
    await act(async () => preview.dispatchEvent(new dom.Event("loadedmetadata") as unknown as Event));
    expect(latest.video).toMatchObject({ resourceId: "library-video", durationMs: 8250, width: 1080, height: 1920 });
    expect(latest.missing).toBe("");
    expect(host!.querySelector<HTMLButtonElement>(".svc-go")!.disabled).toBe(false);
});

test("快速换视频时丢弃旧视频延迟到达的元数据", async () => {
    await mountComposer();
    await act(async () => latest.pickVideo({ resourceId: "previous-video", name: "旧视频" }));
    const previousUrl = latest.video!.previewUrl;
    await act(async () => latest.pickVideo({ resourceId: "current-video", name: "新视频" }));
    await act(async () => latest.setVideoMeta({ durationMs: 6000, width: 1920, height: 1080 }, previousUrl));
    expect(latest.video).toMatchObject({ resourceId: "current-video", durationMs: 0, width: 0, height: 0 });
    expect(latest.missing).toBe("正在读取参考视频时长");
});

test("删除商品再换新图不会提交模板隐藏的旧商品名", async () => {
    await mountComposer();
    await act(async () => latest.removeImage(latest.images[0]!.id));
    expect(latest.productName).toBe("");
    await act(async () => latest.addPickedImages(replaceKindConfig("product").slots[0]!, [{ resourceId: "headphones", name: "新耳机图" }]));
    expect(latest.buildParameters().productName).toBe("");
    expect(latest.images.map((image) => image.resourceId)).toEqual(["headphones"]);
});

test("增加新的商品素材会使原识别名称失效", async () => {
    await mountComposer();
    await act(async () => latest.addPickedImages(replaceKindConfig("product").slots[0]!, [{ resourceId: "headphones", name: "新耳机图" }]));
    expect(latest.buildParameters().productName).toBe("");
});

test("上传新的商品图会使原识别名称失效", async () => {
    await mountComposer();
    await act(async () => {
        await latest.addImageFiles(replaceKindConfig("product").slots[0]!, [new File(["new product"], "headphones.png", { type: "image/png" })]);
    });
    expect(latest.images.some((image) => image.resourceId === "uploaded-product")).toBe(true);
    expect(latest.buildParameters().productName).toBe("");
});

test("增删包装和参数资料保留当前商品名称", async () => {
    await mountComposer();
    const packaging = replaceKindConfig("product").slots.find((slot) => slot.category === "packaging_image")!;
    await act(async () => latest.addPickedImages(packaging, [{ resourceId: "packaging", name: "包装图" }]));
    expect(latest.buildParameters().productName).toBe("旧款香水");
    await act(async () => latest.removeImage(latest.images.find((image) => image.category === "packaging_image")!.id));
    expect(latest.buildParameters().productName).toBe("旧款香水");
});
