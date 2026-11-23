import { expect, test } from "bun:test";
import { selectShopCanvasGeneratedCover, shopCanvasGeneratedCoverCandidates } from "../src/pages/shop/shop-canvas-project-cover";

test("project cover uses the first saved generated result, never uploaded references", () => {
    const nodes = [
        { type: "image", resourceId: "uploaded-product" },
        { type: "video", resourceId: "uploaded-video" },
        { type: "generation", generationKey: "pending" },
        { type: "generation", generationKey: "first", resourceId: "generated-image" },
        { type: "video", videoProjectId: "second", resourceId: "generated-video" },
    ];
    expect(selectShopCanvasGeneratedCover(nodes)).toEqual({ kind: "image", resourceId: "generated-image" });
});

test("a video generated before an image provides the project's poster", () => {
    expect(
        selectShopCanvasGeneratedCover([
            { type: "video", videoProjectId: "failed", videoFailed: true, resourceId: "failed-video" },
            { type: "video", videoProjectId: "first", resourceId: "generated-video" },
            { type: "generation", resourceId: "generated-image" },
        ]),
    ).toEqual({ kind: "video", resourceId: "generated-video" });
});

test("empty, pending and malformed canvas data have no automatic cover", () => {
    for (const nodes of [null, {}, [], [null, false, {}, { type: "generation", resourceId: " " }, { type: "draft", videoProjectId: "pending" }]]) {
        expect(selectShopCanvasGeneratedCover(nodes)).toBeNull();
    }
});

test("image nodes retaining generation provenance can cover an existing project", () => {
    expect(selectShopCanvasGeneratedCover([{ type: "image", generationKey: "image-job", resourceId: "existing-result" }])).toEqual({ kind: "image", resourceId: "existing-result" });
});

test("普通视频任务可作封面，多个生成候选按顺序保留用于失败降级", () => {
    expect(
        shopCanvasGeneratedCoverCandidates([
            { type: "video", videoTaskId: "task", resourceId: "first-video" },
            { type: "generation", resourceId: "second-image" },
            { type: "generation", resourceId: "second-image" },
            { type: "image", resourceId: "uploaded-reference" },
        ]),
    ).toEqual([
        { kind: "video", resourceId: "first-video" },
        { kind: "image", resourceId: "second-image" },
    ]);
});
