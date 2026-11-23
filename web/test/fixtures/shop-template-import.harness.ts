import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { RemoteResource } from "@/services/api/resources";
import type { EcommerceWorkRemix } from "@/services/api/canvas-templates";
import type { ShopTemplateRemixInput } from "@/services/api/shop-templates";

type UploadMeta = { fileName?: string; signal?: AbortSignal; idempotencyKey?: string };
type UploadCall = { file: Blob; kind: string; meta?: UploadMeta };
const uploads: UploadCall[] = [];
const analyses: Array<{ input: ShopTemplateRemixInput; signal?: AbortSignal }> = [];
const fetches: Array<{ input: unknown; init?: RequestInit }> = [];
const remix: EcommerceWorkRemix = {
    replaceMode: "product",
    prompt: "参考原片节奏展示新的商品",
    materials: [
        { category: "reference_video", resourceId: "reference-ready", name: "参考原片", width: 720, height: 1280, durationMs: 5000 },
        { category: "product_image", resourceId: "product-ready", name: "新商品", width: 800, height: 800, durationMs: 0 },
    ],
};
const ready = (kind: "image" | "video", patch: Partial<RemoteResource> = {}) =>
    ({ id: kind === "image" ? "product-ready" : "reference-ready", status: "ready", kind, mimeType: `${kind}/${kind === "image" ? "png" : "mp4"}`, size: 10, ...patch }) as RemoteResource;
let uploadResult: (call: UploadCall) => Promise<RemoteResource>;
let analysisResult: () => Promise<EcommerceWorkRemix>;
let fetchResult: () => Promise<Response>;
const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: unknown, init?: RequestInit) => {
        fetches.push({ input, init });
        return fetchResult();
    },
});
mock.module("@/services/api/resources", () => ({
    uploadResourceFile: async (file: Blob, kind: string, meta?: UploadMeta) => {
        const call = { file, kind, meta };
        uploads.push(call);
        return uploadResult(call);
    },
}));
mock.module("@/services/api/shop-templates", () => ({
    prepareShopTemplateRemix: async (input: ShopTemplateRemixInput, signal?: AbortSignal) => {
        analyses.push({ input, signal });
        return analysisResult();
    },
}));
const { importShopTemplate } = await import("@/services/shop-template-remix");
type ImportInput = Parameters<typeof importShopTemplate>[0];
function input(patch: Partial<ImportInput> = {}): ImportInput {
    return {
        videoUrl: "/shop-templates/reference.mp4",
        title: "商品 3D 巨幕",
        product: new File(["product-data"], "product.png", { type: "image/png" }),
        description: "展示真实包装，保留镜头节奏",
        requestId: "request-123",
        signal: new AbortController().signal,
        assertOwner: () => undefined,
        onProgress: () => undefined,
        ...patch,
    };
}
beforeEach(() => {
    uploads.length = 0;
    analyses.length = 0;
    fetches.length = 0;
    uploadResult = async ({ kind }) => ready(kind as "image" | "video");
    analysisResult = async () => remix;
    fetchResult = async () => new Response(new Blob(["reference-data"], { type: "video/mp4" }), { status: 200 });
});
afterAll(() => {
    mock.restore();
    if (previousFetch) Object.defineProperty(globalThis, "fetch", previousFetch);
    else Reflect.deleteProperty(globalThis, "fetch");
});

test("缺图、空图和非图片 MIME 都在任何上传之前阻断", async () => {
    const invalid = [undefined, null, new File([], "empty.png", { type: "image/png" }), new File(["html"], "fake.png", { type: "text/html" }), new File(["video"], "fake.mp4", { type: "video/mp4" })];
    for (const product of invalid) await expect(importShopTemplate(input({ product: product as File }))).rejects.toThrow("请上传可读取的商品图片");
    expect(uploads).toHaveLength(0);
    expect(fetches).toHaveLength(0);
    expect(analyses).toHaveLength(0);
});

test("描述超过 200 字时不上传或分析", async () => {
    await expect(importShopTemplate(input({ description: "商".repeat(201) }))).rejects.toThrow("描述最多 200 字");
    expect(uploads).toHaveLength(0);
    expect(analyses).toHaveLength(0);
});

test("商品图未 ready、ID 缺失、资源类型或 MIME 错误阻断参考视频和分析", async () => {
    for (const patch of [{ status: "pending" }, { status: "failed" }, { id: "" }, { kind: "video" }, { mimeType: "video/mp4" }, { mimeType: undefined }]) {
        uploadResult = async () => ready("image", patch);
        await expect(importShopTemplate(input())).rejects.toThrow("商品图未正确保存");
    }
    expect(uploads.every((call) => call.kind === "image")).toBe(true);
    expect(fetches).toHaveLength(0);
    expect(analyses).toHaveLength(0);
});

test("参考视频资源未 ready 或类型不符时不分析", async () => {
    for (const patch of [{ status: "pending" }, { id: "" }, { kind: "image" }, { mimeType: "text/html" }]) {
        uploadResult = async ({ kind }) => ready(kind as "image" | "video", kind === "video" ? patch : {});
        await expect(importShopTemplate(input())).rejects.toThrow("参考视频未正确保存");
    }
    expect(analyses).toHaveLength(0);
});

test("HTTP 失败、HTML 伪装响应及空视频都不上传视频或分析", async () => {
    for (const response of [new Response("unavailable", { status: 503 }), new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }), new Response(new Blob([], { type: "video/mp4" }))]) {
        fetchResult = async () => response;
        await expect(importShopTemplate(input())).rejects.toThrow();
    }
    expect(uploads.every((call) => call.kind === "image")).toBe(true);
    expect(analyses).toHaveLength(0);
});

test("成功时传入完整素材 ID、描述与取消信号，并保留稳定幂等键", async () => {
    const progress: string[] = [];
    const args = input({ onProgress: (label) => progress.push(label) });
    const result = await importShopTemplate(args);
    expect(result).toBe(remix);
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toMatchObject({ file: args.product, kind: "image", meta: { signal: args.signal, idempotencyKey: "request-123:product" } });
    expect(uploads[1]).toMatchObject({ kind: "video", meta: { fileName: "商品 3D 巨幕.mp4", signal: args.signal, idempotencyKey: "request-123:video" } });
    expect(uploads[1].file.type).toBe("video/mp4");
    expect(fetches).toEqual([{ input: args.videoUrl, init: { signal: args.signal } }]);
    expect(analyses).toEqual([{ input: { referenceVideoResourceId: "reference-ready", imageResourceIds: ["product-ready"], description: args.description }, signal: args.signal }]);
    expect(progress).toHaveLength(3);
});

test("开始前已取消或账号已切换时不上传或分析", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(importShopTemplate(input({ signal: controller.signal }))).rejects.toThrow();
    await expect(
        importShopTemplate(
            input({
                assertOwner: () => {
                    throw new Error("账号已切换");
                },
            }),
        ),
    ).rejects.toThrow("账号已切换");
    expect(uploads).toHaveLength(0);
    expect(analyses).toHaveLength(0);
});

test("商品图上传途中取消或切换账号时不继续取视频或分析", async () => {
    for (const mode of ["abort", "owner"] as const) {
        const controller = new AbortController();
        let owned = true;
        uploadResult = async () => {
            if (mode === "abort") controller.abort();
            else owned = false;
            return ready("image");
        };
        await expect(
            importShopTemplate(
                input({
                    signal: controller.signal,
                    assertOwner: () => {
                        if (!owned) throw new Error("账号已切换");
                    },
                }),
            ),
        ).rejects.toThrow();
    }
    expect(fetches).toHaveLength(0);
    expect(analyses).toHaveLength(0);
});

test("下载原片时取消或切换账号时不上传视频或分析", async () => {
    for (const mode of ["abort", "owner"] as const) {
        const controller = new AbortController();
        let owned = true;
        fetchResult = async () => {
            if (mode === "abort") controller.abort();
            else owned = false;
            return new Response(new Blob(["video"], { type: "video/mp4" }));
        };
        await expect(
            importShopTemplate(
                input({
                    signal: controller.signal,
                    assertOwner: () => {
                        if (!owned) throw new Error("账号已切换");
                    },
                }),
            ),
        ).rejects.toThrow();
    }
    expect(uploads.every((call) => call.kind === "image")).toBe(true);
    expect(analyses).toHaveLength(0);
});

test("视频上传途中取消或切换账号时不开始分析", async () => {
    for (const mode of ["abort", "owner"] as const) {
        const controller = new AbortController();
        let owned = true;
        uploadResult = async ({ kind }) => {
            if (kind === "video") {
                if (mode === "abort") controller.abort();
                else owned = false;
            }
            return ready(kind as "image" | "video");
        };
        await expect(
            importShopTemplate(
                input({
                    signal: controller.signal,
                    assertOwner: () => {
                        if (!owned) throw new Error("账号已切换");
                    },
                }),
            ),
        ).rejects.toThrow();
    }
    expect(analyses).toHaveLength(0);
});

test("分析失败向上抛出，重试仍使用相同素材幂等键且不丢描述", async () => {
    const failure = new Error("识别服务暂时不可用，请重试");
    analysisResult = async () => {
        throw failure;
    };
    const args = input();
    await expect(importShopTemplate(args)).rejects.toBe(failure);
    analysisResult = async () => remix;
    expect(await importShopTemplate(args)).toBe(remix);
    expect(analyses).toHaveLength(2);
    expect(analyses[0].input).toEqual(analyses[1].input);
    expect(uploads.map((call) => call.meta?.idempotencyKey)).toEqual(["request-123:product", "request-123:video", "request-123:product", "request-123:video"]);
});

test("分析完成前取消或切换账号不会把旧结果交给新页面", async () => {
    for (const mode of ["abort", "owner"] as const) {
        const controller = new AbortController();
        let owned = true;
        analysisResult = async () => {
            if (mode === "abort") controller.abort();
            else owned = false;
            return remix;
        };
        await expect(
            importShopTemplate(
                input({
                    signal: controller.signal,
                    assertOwner: () => {
                        if (!owned) throw new Error("账号已切换");
                    },
                }),
            ),
        ).rejects.toThrow();
    }
    expect(analyses).toHaveLength(2);
});
