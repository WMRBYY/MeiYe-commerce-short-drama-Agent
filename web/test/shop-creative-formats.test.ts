import { expect, test } from "bun:test";
import { normalizeViralOptions } from "../src/pages/ecommerce/video/viral-plan-model";
import { SCRIPT_FORMATS, scriptFormat } from "../src/pages/shop/script-formats";
import { SCRIPT_MODELS, SCRIPT_MODEL_CATEGORIES } from "../src/pages/shop/script/script-model-catalog";

test("each script type offers eight distinct creative choices and free remains the default", () => {
    expect(scriptFormat(undefined).id).toBe("free");
    for (const format of SCRIPT_FORMATS) {
        expect(format.examples).toHaveLength(8);
        expect(new Set(format.examples).size).toBe(8);
    }
    expect(scriptFormat("creative-planning").group).toBe("创意策划");
});

test("each visual category has 36 independently addressable atlas cells", () => {
    for (const category of SCRIPT_MODEL_CATEGORIES) {
        const models = SCRIPT_MODELS.filter((item) => item.category === category.id);
        expect(models).toHaveLength(["child", "young", "middle", "senior"].includes(category.id) ? 25 : 36);
        expect(new Set(models.map((item) => item.image || `${item.row}:${item.column}`)).size).toBe(models.length);
        expect(models.every((item) => (item.image ? item.image.endsWith(".png") : item.atlas.endsWith(`/${category.id}.png`)))).toBe(true);
    }
});

test("studio no-voice drafts retain the enabled on-screen text switch", () => {
    const options = normalizeViralOptions({ mode: "studio", subtitles: true, displayOnly: true, textOverlays: true });
    expect(options.subtitles).toBe(true);
    expect(options.textOverlays).toBe(true);
});
