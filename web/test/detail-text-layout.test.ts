import { expect, test } from "bun:test";
import { detailTextBoxStyle, detailTextEditInstruction } from "../src/pages/shop/detail-text-layout";
import type { EcommerceImageTextDetection } from "../src/services/api/ecommerce-text";

const detection: EcommerceImageTextDetection = {
    resourceId: "source",
    width: 1000,
    height: 6000,
    regions: [
        { id: "title", text: "珍珠水活", confidence: 0.98, box: { x: 120, y: 2400, width: 500, height: 90 } },
        { id: "subtitle", text: "原图文案", confidence: 0.92, box: { x: 120, y: 2520, width: 300, height: 60 } },
    ],
};
test("intrinsic coordinates stay aligned at any viewport width and long-image scroll position", () => {
    const style = detailTextBoxStyle(detection.regions[0], detection)!;
    expect(style).toEqual({ left: "12%", top: "40%", width: "50%", height: "1.5%" });
    for (const renderedWidth of [240, 480, 960]) {
        const scale = renderedWidth / detection.width;
        expect((parseFloat(style.left) / 100) * renderedWidth).toBe(120 * scale);
        expect((parseFloat(style.top) / 100) * detection.height * scale).toBe(2400 * scale);
    }
});
test("invalid boxes are rejected rather than misplaced outside the image", () => {
    expect(detailTextBoxStyle({ ...detection.regions[0], box: { x: 900, y: 0, width: 200, height: 20 } }, detection)).toBeNull();
    expect(detailTextBoxStyle(detection.regions[0], { width: 0, height: 6000 })).toBeNull();
});
test("empty text is an explicit erase operation; unchanged lines are excluded", () => {
    const instruction = detailTextEditInstruction(detection, { title: "", subtitle: "原图文案" });
    expect(instruction).toContain('"action":"erase"');
    expect(instruction).toContain('"replacement":""');
    expect(instruction).not.toContain('"original":"原图文案"');
    expect(instruction).toContain('"y":2400');
});
test("replacement keeps source coordinates and escapes text without changing instructions", () => {
    expect(detailTextEditInstruction(detection, { title: '新文案"\n第二行' })).toContain('"replacement":"新文案\\"\\n第二行"');
    expect(() => detailTextEditInstruction(detection, { title: "珍珠水活" })).toThrow();
});
