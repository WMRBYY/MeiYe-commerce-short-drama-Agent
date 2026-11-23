import { expect, test } from "bun:test";
import { COMMERCE_WORKFLOW_LIBRARY } from "../src/pages/shop/shop-canvas-workflow-library";
import { cloneWorkflowNodes } from "../src/pages/shop/shop-canvas-workflows";
import { SHOP_CANVAS_TOOLS } from "../src/pages/shop/shop-canvas-catalog";
import { reconcileShopCanvasVideoInput, shopCanvasVideoSubmissionId, shopCanvasVideoSubmissionKey } from "../src/pages/shop/shop-canvas-normal-video-state";

test("recommended workflows have executable nodes, intact acyclic links and explicit unavailable capabilities", () => {
    expect(COMMERCE_WORKFLOW_LIBRARY.length).toBe(18);
    expect(new Set(COMMERCE_WORKFLOW_LIBRARY.map((w) => w.id)).size).toBe(18);
    for (const workflow of COMMERCE_WORKFLOW_LIBRARY) {
        const ids = new Set(workflow.nodes.map((n) => n.id));
        expect(ids.size).toBe(workflow.nodes.length);
        expect(workflow.nodes.some((n) => n.draftKind === "upload-card")).toBe(true);
        for (const node of workflow.nodes) {
            for (const input of node.inputs || []) expect(ids.has(input)).toBe(true);
            if (node.type === "draft") {
                const tool = SHOP_CANVAS_TOOLS.find((t) => t.id === node.draftKind);
                expect(tool).toBeDefined();
                if (tool?.comingSoon) expect(workflow.limitation).toContain("敬请期待");
                if (node.draftKind !== "upload-card") expect(node.prompt?.length).toBeGreaterThan(10);
            }
            const visit = (id: string, seen: Set<string>) => {
                expect(seen.has(id)).toBe(false);
                for (const input of workflow.nodes.find((n) => n.id === id)?.inputs || []) visit(input, new Set([...seen, id]));
            };
            visit(node.id, new Set());
        }
    }
});

test("copy is independent and does not reconnect an active generation job", () => {
    const original = structuredClone(COMMERCE_WORKFLOW_LIBRARY[0].nodes);
    original[1].config = { image: { notes: "用户修改" } };
    original[1].videoProjectId = "charged-task";
    original[1].videoTaskId = "normal-video-task";
    const copied = cloneWorkflowNodes(original);
    const oldIds = new Set(original.map((n) => n.id));
    const newIds = new Set(copied.map((n) => n.id));
    for (const node of copied) {
        expect(oldIds.has(node.id)).toBe(false);
        expect(node.videoProjectId).toBeUndefined();
        expect(node.videoTaskId).toBeUndefined();
        for (const input of node.inputs || []) expect(newIds.has(input)).toBe(true);
    }
    expect(copied[1].config).toEqual(original[1].config);
    expect(copied[1].config).not.toBe(original[1].config);
    expect(copied[5].prompt).toBe(original[5].prompt);
    expect(copied[5].groupId).not.toBe(original[5].groupId);
});

test("normal video nodes recover the same submission and separate explicit retries by prior task", async () => {
    const nodeKey = shopCanvasVideoSubmissionKey("canvas:user:project", "video-node");
    const original = await shopCanvasVideoSubmissionId(nodeKey);
    expect(await shopCanvasVideoSubmissionId(nodeKey)).toBe(original);
    expect(await shopCanvasVideoSubmissionId(nodeKey, "failed-task")).not.toBe(original);
    expect(await shopCanvasVideoSubmissionId(shopCanvasVideoSubmissionKey("canvas:user:other-project", "video-node"))).not.toBe(original);
});

test("normal video rewiring preserves manual settings while replacing linked text and media", () => {
    const loaded = reconcileShopCanvasVideoInput({
        model: "video-model",
        prompt: "镜头推进",
        ratio: "16:9",
        seconds: "8",
        resolution: "720",
        audio: true,
        watermark: false,
        references: [{ id: "manual", name: "手动音轨", kind: "audio", role: "reference", resourceId: "manual-audio" }],
    }, undefined, [{ id: "linked", type: "video", resourceId: "old-video" }, { id: "copy", type: "text", text: "室内光" }]);
    const rewired = reconcileShopCanvasVideoInput(loaded.draft, loaded.signature, [{ id: "linked", type: "image", resourceId: "new-image" }]);
    expect(rewired.draft.prompt).toBe("镜头推进");
    expect(rewired.draft.seconds).toBe("8");
    expect(rewired.draft.audio).toBe(true);
    expect(rewired.draft.references.map(({ resourceId, kind }) => [resourceId, kind])).toEqual([["manual-audio", "audio"], ["new-image", "image"]]);
});

test("normal video graph acknowledges selected media without changing its role and never duplicates an @ text reference", () => {
    const input = { id: "selected", type: "image", resourceId: "shared-image" };
    const text = { id: "script", type: "text", text: "镜头从货架推近" };
    const original = {
        model: "video-model",
        prompt: "拍摄详情 @[node:script]",
        ratio: "16:9",
        seconds: "8",
        resolution: "720",
        audio: true,
        watermark: false,
        references: [{ id: "canvas-ref:selected", name: "首帧", kind: "image" as const, role: "first_frame" as const, resourceId: input.resourceId }],
    };
    const result = reconcileShopCanvasVideoInput(original, undefined, [input, text]);
    expect(result.draft).toEqual(original);
    const edited = { ...original, prompt: "拍摄详情" };
    const beforeGraphSync = reconcileShopCanvasVideoInput(edited, result.signature, [input, text]);
    const afterGraphSync = reconcileShopCanvasVideoInput(edited, beforeGraphSync.signature, [input]);
    expect(beforeGraphSync.draft).toEqual(edited);
    expect(afterGraphSync.draft).toEqual(edited);
});
