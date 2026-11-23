import { expect, test } from "bun:test";
import { shopCanvasCoverCandidates, shopCanvasProjectLayerKey } from "../src/pages/shop/shop-canvas-projects";

test("电商画布按首个生成结果顺序选择封面，失败候选不能回退到上传素材", () => {
    expect(
        shopCanvasCoverCandidates([
            { type: "generation", resourceId: "old-output" },
            { type: "image", resourceId: "input" },
            { type: "generation", resourceId: "new-output" },
            { type: "video", videoProjectId: "project", resourceId: "video-output" },
            { type: "image", resourceId: "new-output" },
            { type: "video", videoFailed: true, resourceId: "failed-video" },
            { type: "generation", generationKey: "still-running" },
            { type: "draft", resourceId: "draft-input" },
            { type: "text", resourceId: 90 },
            null,
        ]),
    ).toEqual(["old-output", "new-output", "video-output"]);
});

test("空白项目或没有资源的旧数据保持空白封面，图层键按账号隔离", () => {
    expect(shopCanvasCoverCandidates(null)).toEqual([]);
    expect(shopCanvasCoverCandidates([{ type: "draft" }, { type: "generation", generationKey: "task-only" }])).toEqual([]);
    expect(shopCanvasProjectLayerKey("account-1", "project")).toBe("ecommerce-canvas:shop-canvas:account-1:project");
    expect(shopCanvasProjectLayerKey("account-2", "project")).toBe("ecommerce-canvas:shop-canvas:account-2:project");
});
