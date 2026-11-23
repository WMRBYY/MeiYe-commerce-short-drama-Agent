import { expect, test } from "bun:test";
import { createGenerationTaskCache } from "../src/services/generation-task-cache";
import type { GenerationTask } from "../src/services/api/task-center";

const done: GenerationTask = {
    id: "image",
    type: "canvas_image",
    status: "succeeded",
    prompt: "private input",
    inputJson: '{"apiKey":"secret"}',
    resultJson: '{"images":[{"storageKey":"resource:result"}]}',
    attempts: 1,
    createdAt: "2026-11-21",
    updatedAt: "2026-11-21",
};
function storage() {
    const values = new Map<string, string>();
    return (scope: string) => ({
        getItem: async (key: string) => values.get(scope + key) ?? null,
        setItem: async (key: string, value: string) => {
            values.set(scope + key, value);
        },
        removeItem: async (key: string) => {
            values.delete(scope + key);
        },
    });
}

test("completed images survive remount and reload without persisting provider inputs", async () => {
    const disk = storage();
    const cache = createGenerationTaskCache(disk);
    cache.remember("alice", [done]);
    expect(cache.read("alice")[0].resultJson).toBe(done.resultJson);
    await cache.flush("alice");
    const reloaded = createGenerationTaskCache(disk);
    const saved = await reloaded.load("alice");
    expect(saved[0].status).toBe("succeeded");
    expect(saved[0].inputJson).toBeUndefined();
    expect(saved[0].prompt).toBe(done.prompt);
    expect(await reloaded.load("bob")).toEqual([]);
});

test("retry and deletion arriving before hydration cannot resurrect completed receipts", async () => {
    const disk = storage();
    const cache = createGenerationTaskCache(disk);
    cache.remember("alice", [done, { ...done, id: "deleted" }]);
    await cache.flush("alice");
    const reloaded = createGenerationTaskCache(disk);
    reloaded.remember("alice", [{ ...done, status: "queued", attempts: 2 }]);
    reloaded.forget("alice", "deleted");
    expect(await reloaded.load("alice")).toEqual([]);
    await reloaded.flush("alice");
    expect(await createGenerationTaskCache(disk).load("alice")).toEqual([]);
});

test("old responses cannot replace newer results and cache is bounded", async () => {
    const cache = createGenerationTaskCache(storage());
    cache.remember("alice", [done]);
    cache.remember("alice", [{ ...done, status: "running", updatedAt: "2026-11-20" }]);
    expect(cache.read("alice")[0].status).toBe("succeeded");
    cache.remember(
        "alice",
        Array.from({ length: 450 }, (_, i) => ({ ...done, id: `image-${i}` })),
    );
    expect(cache.read("alice").length).toBe(400);
    await cache.flush("alice");
});

test("unavailable storage and inline media do not block cached display", async () => {
    const cache = createGenerationTaskCache(() => ({
        getItem: async () => {
            throw new Error("unavailable");
        },
        setItem: async () => {
            throw new Error("quota");
        },
        removeItem: async () => {},
    }));
    cache.remember("alice", [{ ...done, previewUrl: "blob:temporary", resultJson: '{"data":"data:image/png;base64,large"}' }]);
    await cache.flush("alice");
    const saved = await cache.load("alice");
    expect(saved[0].previewUrl).toBeUndefined();
    expect(saved[0].resultJson).toBeUndefined();
    expect(saved[0].status).toBe("succeeded");
});

test("a lightweight list response preserves completed media learned from task detail", async () => {
    const cache = createGenerationTaskCache(storage());
    cache.remember("alice", [done]);
    cache.remember("alice", [{ ...done, resultJson: undefined }]);
    expect(cache.read("alice")[0].resultJson).toBe(done.resultJson);
    cache.remember("alice", [{ ...done, attempts: 2, resultJson: undefined }]);
    expect(cache.read("alice")[0].resultJson).toBeUndefined();
    await cache.flush("alice");
});

test("a fast server summary does not hide outputs from slower disk hydration", async () => {
    const disk = storage();
    const cache = createGenerationTaskCache(disk);
    cache.remember("alice", [done]);
    await cache.flush("alice");
    const reloaded = createGenerationTaskCache(disk);
    reloaded.remember("alice", [{ ...done, resultJson: undefined }]);
    expect((await reloaded.load("alice"))[0].resultJson).toBe(done.resultJson);
    await reloaded.flush("alice");
});
