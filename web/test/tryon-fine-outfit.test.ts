import { describe, expect, test } from "bun:test";
import { TRYON_FUNCTIONS } from "@/pages/ecommerce/tryon/tryon-kinds";
import { buildTryOnJobs, defaultTryOnDraft, missingInput, needsAgentPlan, type TryOnDraft, type TryOnImage } from "@/pages/ecommerce/tryon/tryon-plan";
import { newTryOnBatchId, recoverEmptyTryOnBatch, type TryOnBatch } from "@/pages/ecommerce/tryon/tryon-store";

const image = (slot: TryOnImage["slot"], id: string): TryOnImage => ({ id, resourceId: id, slot, name: id, previewUrl: `/api/resources/${id}/file`, width: 1024, height: 1824 });
const source = (count = 1): TryOnDraft => ({
    ...defaultTryOnDraft(),
    fn: "fine-outfit",
    count,
    images: { "fine-outfit": [image("model", "person"), image("garment", "front"), image("garment", "back"), image("garment", "detail")] },
    notes: "保持金色刺绣",
});

describe("精细化换装提交", () => {
    test.each([1, 3, 20])("生成 %i 张任务，完整传递人物及全部服装参考", (count) => {
        const draft = source(count);
        expect(missingInput(draft)).toBe("");
        expect(needsAgentPlan(draft)).toBe(false);
        const jobs = buildTryOnJobs(draft);
        expect(jobs).toHaveLength(count);
        expect(new Set(jobs.map((job) => job.key)).size).toBe(count);
        for (const job of jobs) {
            expect(job.references.map((ref) => ref.resourceId)).toEqual(["person", "front", "back", "detail"]);
            expect(job.references.map((ref) => ref.role)).toEqual(["model", "garment", "garment", "garment"]);
            expect(job.sizeSource).toMatchObject({ width: 1024, height: 1824 });
            expect(job.prompt).toContain("精细化换装");
            expect(job.prompt).toContain("保持金色刺绣");
            expect(job.prompt).toContain("第 2–4 张");
            expect(job.prompt).toContain("姿势、机位、背景和光线全部沿用图一");
        }
    });

    test("所有已注册入口都能从合法素材构建非空任务", () => {
        for (const config of TRYON_FUNCTIONS) {
            const images = config.slots.filter((slot) => slot.min > 0).map((slot) => image(slot.key, slot.key));
            const draft: TryOnDraft = { ...defaultTryOnDraft(), fn: config.id, images: { [config.id]: images }, consent: true, poses: ["自然站立"] };
            expect(missingInput(draft)).toBe("");
            expect(buildTryOnJobs(draft)).toHaveLength(1);
        }
    });

    test.each(["background", "scene", "enhance"] as const)("%s 保留素材职责与原图尺寸，也能恢复空批次", (fn) => {
        const images = [image("subject", "subject"), ...(fn === "enhance" ? [] : [image("background", "environment")])];
        const draft: TryOnDraft = { ...defaultTryOnDraft(), fn, images: { [fn]: images }, count: 2, notes: "保留标签" };
        const jobs = buildTryOnJobs(draft);
        expect(jobs).toHaveLength(2);
        for (const job of jobs) {
            expect(job.references.map((ref) => ref.resourceId)).toEqual(images.map((image) => image.resourceId));
            expect(job.references.map((ref) => ref.role)).toEqual(images.map((image) => image.slot));
            expect(job.sizeSource).toMatchObject({ width: 1024, height: 1824 });
            expect(job.prompt).toContain("保留标签");
            expect(job.prompt).toContain(fn === "enhance" ? "不换脸" : "不复制其中的人物或商品");
        }
        const batch: TryOnBatch = { id: newTryOnBatchId(fn, "12345678"), fn, createdAt: "", summary: fn, model: "gpt-image-2", modelLabel: "GPT-Image-2", ratio: "auto", resolution: "4K", source: draft, jobs: [] };
        expect(recoverEmptyTryOnBatch(batch).jobs).toHaveLength(2);
    });
});

describe("继续提交空的精细换装批次", () => {
    const id = newTryOnBatchId("fine-outfit", "1234567890abcdef");
    const batch: TryOnBatch = {
        id,
        fn: "fine-outfit",
        createdAt: "2026-11-18T04:24:12Z",
        summary: "精细化换装",
        model: "gpt-image-2",
        modelLabel: "GPT-Image-2",
        ratio: "16:9",
        resolution: "4K",
        source: source(),
        jobs: [],
        executionRequest: { id, kind: "tryon", title: "精细化换装", clientState: {}, jobs: [] },
    };

    test("保留提交编号、素材和规格，移除空请求以便重新构建", () => {
        const recovered = recoverEmptyTryOnBatch(batch);
        expect(recovered.id).toBe(id);
        expect(recovered.source).toBe(batch.source);
        expect(recovered.ratio).toBe("16:9");
        expect(recovered.resolution).toBe("4K");
        expect(recovered.executionRequest).toBeUndefined();
        expect(recovered.jobs).toHaveLength(1);
        expect(recovered.jobs[0].state).toBe("waiting");
        expect(batch.jobs).toHaveLength(0);
        expect(recoverEmptyTryOnBatch(recovered)).toBe(recovered);
    });

    test("不重建已提交、已有任务或素材不完整的批次", () => {
        const recovered = recoverEmptyTryOnBatch(batch);
        const cases: TryOnBatch[] = [
            { ...batch, projectId: "server-project" },
            { ...batch, remote: true },
            { ...batch, jobs: recovered.jobs },
            { ...batch, executionRequest: { ...batch.executionRequest!, jobs: [{ key: "accepted", request: { kind: "image", model: "gpt-image-2", prompt: "test" } }] } },
            { ...batch, planning: { state: "done", taskId: "planning-task" } },
            { ...batch, source: { ...batch.source, images: {} } },
            { ...batch, fn: "outfit" },
        ];
        for (const existing of cases) expect(recoverEmptyTryOnBatch(existing)).toBe(existing);
    });
});
