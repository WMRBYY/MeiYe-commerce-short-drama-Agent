import { expect, test } from "bun:test";
import { commerceNodeReferences, connectCommerceNodes, reconcileCommerceLinks, syncShopCanvasReferences, type CommerceGraphNode, type ShopCanvasReferenceInput } from "../src/pages/shop/shop-canvas-graph";

test("connections reject self, missing, duplicate and multi-hop cycles without mutating nodes", () => {
    const nodes: CommerceGraphNode[] = [
        { id: "image", type: "image", resourceId: "product" },
        { id: "edit", type: "draft", inputs: ["image"] },
        { id: "output", type: "draft", inputs: ["edit"] },
    ];
    for (const [source, target] of [
        ["image", "image"],
        ["missing", "edit"],
        ["image", "edit"],
        ["output", "image"],
    ]) {
        const result = connectCommerceNodes(nodes, source, target);
        expect(result.error).toBeTruthy();
        expect(result.nodes).toBe(nodes);
    }
    const result = connectCommerceNodes(nodes, "image", "output");
    expect(result.error).toBeUndefined();
    expect(result.nodes[2].inputs).toEqual(["edit", "image"]);
    expect(nodes[2].inputs).toEqual(["edit"]);
});

test("designer inputs reuse safe sources, deduplicate uploads and release only their own connections", () => {
    const original: CommerceGraphNode[] = [
        { id: "manual", type: "image", resourceId: "product" },
        { id: "video", type: "video", resourceId: "existing-video" },
        { id: "copy", type: "text", text: "保留商品原色" },
        { id: "target", type: "draft", inputs: ["manual"] },
        { id: "downstream", type: "image", resourceId: "downstream-image", inputs: ["target"] },
    ];
    const references: ShopCanvasReferenceInput[] = [
        { kind: "image", resourceId: "product" },
        { kind: "image", resourceId: "styling", materialCategory: "background", name: "场景" },
        { kind: "image", resourceId: "styling", materialCategory: "background", name: "场景重复" },
        { kind: "video", nodeId: "video", resourceId: "existing-video" },
        { kind: "image", nodeId: "downstream", resourceId: "downstream-image" },
    ];
    const create = ({ kind, resourceId, name, materialCategory }: ShopCanvasReferenceInput, _nodes: CommerceGraphNode[], index: number): CommerceGraphNode => ({ id: `generated-${index}`, type: kind, resourceId, text: name, materialCategory });

    const connected = syncShopCanvasReferences(original, "target", references, create);
    expect(connected).toHaveLength(original.length + 1);
    expect(connected.find((node) => node.id === "target")).toMatchObject({ inputs: ["manual", "generated-1", "video"], managedInputIds: ["generated-1", "video"] });
    expect(connected.at(-1)).toMatchObject({ text: "场景", materialCategory: "background" });
    expect(syncShopCanvasReferences(connected, "target", references, create)).toBe(connected);
    expect(original.find((node) => node.id === "target")?.inputs).toEqual(["manual"]);

    const withText = syncShopCanvasReferences(connected, "target", [{ nodeId: "copy", kind: "text" }], create, true);
    expect(withText.find((node) => node.id === "target")?.inputs).toEqual(["manual", "generated-1", "video", "copy"]);
    const cleared = syncShopCanvasReferences(withText, "target", [], create);
    expect(cleared.find((node) => node.id === "target")).toEqual({ id: "target", type: "draft", inputs: ["manual"], managedInputIds: undefined });
    expect(cleared).toHaveLength(connected.length);
    expect(syncShopCanvasReferences(cleared, "target", references, create)).toHaveLength(connected.length);
});

test("downstream gets real upstream media and text, deduplicated through unfinished nodes", () => {
    const nodes: CommerceGraphNode[] = [
        { id: "image", type: "image", resourceId: "product" },
        { id: "copy", type: "text", text: "保持商标" },
        { id: "pending", type: "draft", inputs: ["image", "copy"] },
        { id: "output", type: "draft", inputs: ["pending", "image", "deleted"] },
    ];
    expect(commerceNodeReferences(nodes, "output").map((n) => n.id)).toEqual(["image", "copy"]);
    nodes[2] = { ...nodes[2], type: "generation", resourceId: "finished" };
    expect(commerceNodeReferences(nodes, "output").map((n) => n.resourceId)).toEqual(["finished", "product"]);
});

test("malformed saved cycle does not recurse indefinitely", () => {
    expect(
        commerceNodeReferences(
            [
                { id: "a", type: "draft", inputs: ["b"] },
                { id: "b", type: "draft", inputs: ["a"] },
            ],
            "a",
        ),
    ).toEqual([]);
});

test("changing linked inputs retains manual prompt and identifies only old linked images", () => {
    const old = JSON.stringify([
        ["product", "old-image", null],
        ["copy", null, "旧卖点"],
    ]);
    const next = [{ id: "new", type: "text", text: "新卖点" }];
    const merged = reconcileCommerceLinks(old, next, "保持材质\n旧卖点");
    expect(merged.text).toBe("保持材质\n新卖点");
    expect([...merged.previousResourceIds]).toEqual(["old-image"]);
    expect(merged.previousResourceIds.has("manual-upload")).toBe(false);
    expect(reconcileCommerceLinks(old, [], "保持材质\n旧卖点").text).toBe("保持材质");
    expect(reconcileCommerceLinks(old, next, "用户改写的卖点").text).toBe("用户改写的卖点\n新卖点");
    expect(reconcileCommerceLinks(undefined, next, "新卖点").text).toBe("新卖点");
    expect(reconcileCommerceLinks("broken", next, "手写要求").text).toBe("手写要求\n新卖点");
});

