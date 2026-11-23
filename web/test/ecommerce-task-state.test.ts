import { expect, test } from "bun:test";
import { mergeCommerceTask } from "../src/pages/ecommerce/task-state";
import type { GenerationTask } from "../src/services/api/task-center";

const task = (status: GenerationTask["status"], second: number): GenerationTask => ({ id: "image-1", type: "canvas_image", status, prompt: "fixture", attempts: 1, createdAt: "2026-11-08T00:00:00Z", updatedAt: `2026-11-08T00:00:0${second}Z` });

test("late batch query cannot replace a completed image with a running placeholder", () => {
    const complete = task("succeeded", 3);
    expect(mergeCommerceTask(task("running", 1), complete)).toBe(complete);
});

test("explicit retry can reopen a terminal task with the same ID", () => {
    expect(mergeCommerceTask(task("queued", 4), task("failed", 3)).status).toBe("queued");
});
