import { expect, test } from "bun:test";
import { creationImageLayout } from "@/pages/create/creation-image-layout";

test("all supported ratios retain their ratio and comparable area within viewport bounds", () => {
    for (const ratio of [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16, 21 / 9, 3 / 2, 2 / 3, 4 / 5, 5 / 4, 1 / 2, 2]) {
        const { width, height } = creationImageLayout(ratio);
        expect(width / height).toBeCloseTo(ratio);
        expect(width).toBeLessThanOrEqual(480);
        expect(height).toBeLessThanOrEqual(400);
        expect(width * height).toBeGreaterThanOrEqual(79999);
        expect(width * height).toBeLessThanOrEqual(88001);
        expect(Math.min(width, height)).toBeGreaterThan(180);
    }
    expect(creationImageLayout(16 / 9).width).toBeGreaterThan(390);
    expect(creationImageLayout(NaN)).toEqual(creationImageLayout(1));
});
