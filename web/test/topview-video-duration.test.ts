import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor, normalizeVideoValue, videoDurationOptions } from "../src/lib/model-capabilities";

describe("TopView per-model duration", () => {
    for (const [model, max] of [
        ["Seedance 2.0", 15],
        ["Seedance 2.0 Fast", 15],
        ["Seedance 2.0 Mini", 15],
        ["seedance-2.0-style", 15],
        ["Seedance 2.5", 30],
        ["Topview T1", 30],
    ] as const) {
        test(model, () => {
            const capabilityConfig = defaultModelCapabilityConfig("topview-video", model);
            capabilityConfig.video!.duration = { selection: "range", min: 1, max: 60, step: 1, default: 1 };
            const config = { channels: [{ id: "tv", models: [model], modelCosts: [{ model, protocol: "topview-video", capabilityConfig }] }] };
            const profile = modelCapabilityConfigFor(config, `tv::${model}`).video!;
            expect(videoDurationOptions(profile)).toEqual(Array.from({ length: max - 3 }, (_, i) => i + 4));
            expect(profile.duration.default).toBe(4);
        });
    }
    test("other models retain their configured duration choices", () => {
        expect(defaultModelCapabilityConfig("gemini-veo", "Veo 3.1").video!.duration.values).toEqual([4, 6, 8]);
    });
    test("switching from a 30 second model to Seedance 2.0 clamps the current selection", () => {
        const profile = defaultModelCapabilityConfig("topview-video", "Seedance 2.0").video!;
        expect(normalizeVideoValue(profile, { seconds: "30" }).seconds).toBe("15");
        expect(normalizeVideoValue(profile, { seconds: "1" }).seconds).toBe("4");
    });
});
