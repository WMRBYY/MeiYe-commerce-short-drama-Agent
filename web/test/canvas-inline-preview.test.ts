import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createInlineMentionChip, referencePreviewUrl, syncInlineMentionPreviews } from "../src/components/canvas/canvas-mention-chips";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";

test("行内图片引用失败后显示回退，并在新地址到达时恢复缩略图和文字", () => {
    const window = new Window();
    const originalDocument = globalThis.document;
    Object.assign(globalThis, { document: window.document });
    try {
        const reference: CanvasResourceReference = { id: "n1", nodeId: "n1", kind: "image", label: "图片1", title: "图片", active: true, previewUrl: "https://example.test/expired.png" };
        const editor = window.document.createElement("div");
        const chip = createInlineMentionChip(reference, "@图片1");
        editor.append(chip);
        expect(chip.querySelector("img")?.getAttribute("src")).toBe(reference.previewUrl);
        chip.querySelector("img")!.dispatchEvent(new window.Event("error"));
        expect(chip.querySelector(".is-fallback")).not.toBeNull();
        syncInlineMentionPreviews(editor, [{ ...reference, previewUrl: "https://example.test/fresh.png" }]);
        expect(chip.querySelector("img")?.getAttribute("src")).toBe("https://example.test/fresh.png");
        expect(chip.querySelector(".canvas-resource-inline-label")?.textContent).toBe("图片1");
    } finally {
        Object.assign(globalThis, { document: originalDocument });
        window.close();
    }
});

test("只有资源键的视频仍可打开引用预览", () => {
    expect(referencePreviewUrl({ id: "v1", nodeId: "v1", kind: "video", label: "视频1", title: "视频", active: true, storageKey: "resource:video-1" })).toBeTruthy();
});
