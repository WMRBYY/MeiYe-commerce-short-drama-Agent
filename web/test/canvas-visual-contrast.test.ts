import { describe, expect, test } from "bun:test";

import { canvasThemes } from "../src/lib/canvas-theme";

describe("canvas visual contrast", () => {
    test("uses white light surfaces and contrasting dark canvas surfaces", () => {
        expect(canvasThemes.light.canvas.background.toLowerCase()).toBe(canvasThemes.light.node.fill.toLowerCase());
        expect(canvasThemes.dark.canvas.background.toLowerCase()).not.toBe(canvasThemes.dark.node.fill.toLowerCase());
        expect(canvasThemes.light.node.panel.toLowerCase()).toBe(canvasThemes.light.canvas.background.toLowerCase());
        expect(canvasThemes.dark.node.panel.toLowerCase()).not.toBe(canvasThemes.dark.canvas.background.toLowerCase());
    });

    test("pins the MeiyeAI unified canvas palette", () => {
        expect(canvasThemes.light.canvas.background).toBe("#f0f0f0");
        expect(canvasThemes.light.node.fill).toBe("#ffffff");
        expect(canvasThemes.light.node.edge).toBe("rgba(15,23,42,.16)");
        expect(canvasThemes.light.node.shadow).toBe("0 6px 18px rgba(15,23,42,.08)");
        expect(canvasThemes.light.node.hoverShadow).toBe("0 10px 24px rgba(15,23,42,.12)");
        expect(canvasThemes.light.toolbar.panel).toBe("rgba(255,255,255,.94)");
        expect(canvasThemes.light.spatial.elevated).toBe("rgba(255,255,255,.94)");

        expect(canvasThemes.dark.canvas.background).toBe("#07080c");
        expect(canvasThemes.dark.node.fill).toBe("#15171e");
        expect(canvasThemes.dark.node.edge).toBe("rgba(160,176,255,.2)");
        expect(canvasThemes.dark.node.shadow).toBe("0 10px 30px rgba(0,0,0,.42)");
        expect(canvasThemes.dark.node.hoverShadow).toBe("0 16px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(76,157,255,.18)");
        expect(canvasThemes.dark.toolbar.panel).toBe("rgba(17,19,26,.92)");
        expect(canvasThemes.dark.toolbar.border).toBe("rgba(160,176,255,.12)");
        expect(canvasThemes.dark.spatial.elevated).toBe("rgba(16,18,25,.95)");
    });

    test("pins intentional grid tokens while retaining canvas grid opacity", async () => {
        expect(canvasThemes.light.canvas.dot).toBe("rgba(0,0,0,.80)");
        expect(canvasThemes.light.canvas.line).toBe("rgba(0,0,0,.80)");
        expect(canvasThemes.dark.canvas.dot).toBe("rgba(170,186,255,.24)");
        expect(canvasThemes.dark.canvas.line).toBe("rgba(170,186,255,.18)");

        const source = await Bun.file(new URL("../src/components/canvas/canvas-viewport.tsx", import.meta.url)).text();
        expect(source).toContain('opacity: mode === "dots" ? 0.62 : 0.4');
    });

    test("keeps the original transparent edge for standard canvas nodes", async () => {
        const source = await Bun.file(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url)).text();

        expect(source).toContain('border: isComposerNode ? "0" : "1px solid transparent"');
        expect(source).not.toContain('border: isComposerNode ? "0" : `1px solid ${theme.node.edge}`');
    });
});
