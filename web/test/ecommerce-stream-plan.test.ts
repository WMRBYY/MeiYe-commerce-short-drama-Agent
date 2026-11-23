import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, type EcommerceDraft } from "@/services/api/ecommerce";
import { parseStreamingPlannerOutput } from "@/pages/ecommerce/planner";
import { readStreamingPlannerText } from "@/pages/ecommerce/stream-plan";

const draft: EcommerceDraft = {
    ...emptyEcommerceDraft(),
    productName: "水密码精华",
    imageType: "main",
    count: 3,
    imageModel: "image-model",
    agentModel: "text-model",
    platform: "taobao",
    language: "zh-CN",
    ratio: "1:1",
    resolution: "1k",
    noText: true,
};

const image = (index: number) => ({
    id: `image-${index}`,
    imageType: "main",
    platform: "taobao",
    language: "zh-CN",
    goal: `目标${index}`,
    theme: `主题{${index}}`,
    composition: `构图 [${index}]`,
    mainVisual: `主体"${index}"`,
    copy: "",
    fidelity: "standard",
    prompt: `第${index}张提示词 {"不是": "结构"}`,
    imageModel: "image-model",
    ratio: "1:1",
    resolution: "1k",
});

const header = { productSummary: "蓝色精华瓶", confirmedFacts: [], uncertainFacts: [], visualStrategy: "清透蓝色", qualityChecks: ["瓶身原文清晰"] };
const full = JSON.stringify({ ...header, images: [image(1), image(2), image(3)] }, null, 2);

describe("ecommerce streaming plan", () => {
    test("returns nothing until the images array starts", () => {
        expect(readStreamingPlannerText(full.slice(0, full.indexOf('"images"')))).toBeNull();
        expect(readStreamingPlannerText(full.slice(0, full.indexOf('"images"') + 12))?.images).toEqual([]);
    });

    test("emits each image only after its object closes, ignoring braces inside strings", () => {
        const secondStart = full.indexOf('"id": "image-2"');
        const partial = readStreamingPlannerText(full.slice(0, secondStart + 40));
        expect(partial?.header.productSummary).toBe("蓝色精华瓶");
        expect(partial?.images.map((item) => (item as { id: string }).id)).toEqual(["image-1"]);
        expect(readStreamingPlannerText(full)?.images).toHaveLength(3);
    });

    test("normalizes streamed screens with the final plan rules", () => {
        const parsed = parseStreamingPlannerOutput(`\`\`\`json\n${full.slice(0, full.indexOf('"id": "image-3"'))}`, draft);
        expect(parsed?.error).toBeUndefined();
        expect(parsed?.plan.images.map((item) => item.id)).toEqual(["image-1", "image-2"]);
        expect(parsed?.plan.images[0].imageModel).toBe("image-model");
    });

    test("stops at the first invalid screen", () => {
        const broken = JSON.stringify({ ...header, images: [image(1), { ...image(2), prompt: "" }, image(3)] });
        const parsed = parseStreamingPlannerOutput(broken, draft);
        expect(parsed?.plan.images).toHaveLength(1);
        expect(parsed?.error).toContain("第2张");
    });

    test("waits when the analysis header comes after the images", () => {
        const reordered = JSON.stringify({ images: [image(1)], ...header });
        expect(parseStreamingPlannerOutput(reordered, draft)).toBeNull();
    });
});
