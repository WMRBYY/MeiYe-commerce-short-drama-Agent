import { expect, test } from "bun:test";
import { replaceKindConfig, replacementMaterialError, type MaterialSlot } from "../src/pages/ecommerce/video/video-kinds";

const uploaded = (category: MaterialSlot["category"]) => ({ category, resourceId: `${category}-resource` });
const combination = replaceKindConfig("combination");

test("combined replacement exposes the existing product detail and packaging inputs", () => {
    const product = replaceKindConfig("product");
    for (const category of ["product_detail_image", "packaging_image"] as const) {
        const slot = product.slots.find((item) => item.category === category)!;
        expect(combination.slots).toContain(slot);
        expect(combination.slots.indexOf(slot)).toBeGreaterThan(combination.slots.findIndex((item) => item.category === "product_image"));
        expect(combination.slots.indexOf(slot)).toBeLessThan(combination.slots.findIndex((item) => item.category === "model_image"));
    }
});

test("product support images require an uploaded product even when other targets are ready", () => {
    for (const category of ["product_detail_image", "packaging_image"] as const) {
        const support = uploaded(category);
        for (const materials of [[support], [support, uploaded("model_image")], [support, uploaded("background_image")], [support, { category: "product_image" as const }]]) {
            expect(replacementMaterialError(combination, materials)).toContain("请先上传商品图");
        }
        expect(replacementMaterialError(combination, [support, uploaded("product_image"), uploaded("model_image"), uploaded("background_image")])).toBe("");
        expect(replacementMaterialError(replaceKindConfig("product"), [support])).toContain("请先上传商品图");
        expect(replacementMaterialError(replaceKindConfig("precise-product"), [support])).toContain("请先上传商品图");
    }
});

test("combined replacement still permits one visual target and rejects voice alone", () => {
    for (const category of ["product_image", "model_image", "background_image"] as const) {
        expect(replacementMaterialError(combination, [uploaded(category)])).toBe("");
    }
    expect(replacementMaterialError(combination, [uploaded("voice_audio")])).toContain("请至少上传");
    expect(replacementMaterialError(combination, [])).toContain("请至少上传");
});
