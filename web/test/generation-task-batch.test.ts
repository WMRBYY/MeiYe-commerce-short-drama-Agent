import { describe, expect, test } from "bun:test";

import { runBackendGenerationTaskBatch, type GenerationTaskDependencies } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import type { GenerationTask } from "../src/services/api/task-center";

const channel = createModelChannel({ id: "batch-test", name: "Batch test", baseUrl: "https://example.com/v1", apiKey: "test", interfaceType: "openai", models: ["image-test"] });
const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "image-test") };

describe("image generation batch", () => {
    test("submits all selected outputs before waiting for generation or saving, preserving ordered failure slots", async () => {
        let active = 0;
        let maximum = 0;
        const submitted: Array<{ index: number; operationId?: string }> = [];
        const dependencies: GenerationTaskDependencies = {
            createId: () => crypto.randomUUID(),
            createTask: async (input) => {
                const metadata = (input.input as { metadata: { batchIndex: number; clientOperationId?: string } }).metadata;
                submitted.push({ index: metadata.batchIndex, operationId: metadata.clientOperationId });
                active++;
                maximum = Math.max(maximum, active);
                return { id: String(metadata.batchIndex), type: "canvas_image", status: "queued", prompt: "test", attempts: 0, createdAt: "", updatedAt: "" } as GenerationTask;
            },
            waitTask: async (id) => {
                await new Promise((resolve) => setTimeout(resolve, 2));
                expect(submitted).toHaveLength(10);
                active--;
                if (id === "2") throw new Error("upstream failed");
                return { id, type: "canvas_image", status: "succeeded", prompt: "test", attempts: 1, resultJson: JSON.stringify({ images: [{ dataUrl: `image-${id}` }] }), createdAt: "", updatedAt: "" } as GenerationTask;
            },
        };
        const retryContextsByBatchIndex = Array.from({ length: 10 }, (_, index) => ({ retryOf: `old-${index}`, attemptGroupId: "retry-group", clientOperationId: `retry-${index}` }));
        const results = await runBackendGenerationTaskBatch({ mode: "image", prompt: "test", config, count: 10, retryContextsByBatchIndex }, dependencies);
        expect(results).toHaveLength(10);
        expect(maximum).toBe(10);
        expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected", ...Array(7).fill("fulfilled")]);
        expect(submitted.map((item) => item.index).sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, index) => index));
        expect(submitted.map((item) => item.operationId).sort()).toEqual(retryContextsByBatchIndex.map((item) => item.clientOperationId).sort());
    });
});
