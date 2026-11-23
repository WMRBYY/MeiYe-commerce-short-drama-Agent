import { describe, expect, test } from "bun:test";
import { buildCanvasMediaToolboxPreset } from "../src/lib/canvas/canvas-media-toolbox-preset";
import { removeCanvasNodes } from "../src/lib/canvas/canvas-project-domain";
import { canvasConnectionError } from "../src/lib/canvas/canvas-connection-policy";
import { MANAGED_MEDIA_NODES } from "../src/lib/media-conversion/managed-nodes";
import type { AiConfig } from "../src/stores/use-config-store";
import { canvasDirectVideoPosterUrl } from "../src/lib/canvas/canvas-media-preview";

test("direct posters preserve signed authorization and never rewrite unknown providers", () => {
    const signed = "https://service-32b21ee7.example.invalid/private/video.mp4?auth_key=example-signature";
    const poster = new URL(canvasDirectVideoPosterUrl(signed));
    expect(poster.searchParams.get("auth_key")).toBe("example-signature");
    expect(poster.searchParams.get("x-oss-process")).toContain("video/snapshot,t_0");
    expect(canvasDirectVideoPosterUrl("https://other.example/video.mp4")).toBe("");
    expect(canvasDirectVideoPosterUrl("https://service-32b21ee7.example.invalid/private/image.png")).toBe("");
    expect(canvasDirectVideoPosterUrl("http://service-32b21ee7.example.invalid/private/video.mp4")).toBe("");
});

describe("工具箱预设业务恢复", () => {
    for (const tool of MANAGED_MEDIA_NODES) test(`${tool.label} creates usable inputs and retains its managed identity`, () => {
        const preset = buildCanvasMediaToolboxPreset(tool.id, { x: 100, y: 200 });
        const output = preset.nodes.find((node) => node.metadata?.toolboxRole === "function")!;
        expect(output.metadata?.canvasNodeId).toBe(tool.id);
        expect(output.metadata?.mediaConversion?.operation).toBe(tool.id);
        expect(preset.nodes.filter((node) => node.parentId === preset.frameId)).toHaveLength(tool.id === "video-replace-background" ? 4 : 3);
        const accepted = [] as typeof preset.connections;
        for (const connection of preset.connections) {
            expect(canvasConnectionError({} as AiConfig, preset.nodes, accepted, connection)).toBe("");
            accepted.push(connection);
        }
        expect(removeCanvasNodes(preset.nodes, new Set([output.id])).removedIds.size).toBe(0);
        expect(removeCanvasNodes(preset.nodes, new Set([preset.frameId])).nodes).toHaveLength(0);
    });
});
