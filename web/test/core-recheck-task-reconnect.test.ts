import { afterEach, beforeEach, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { createGenerationTaskSubscriptionService, isGenerationTaskTerminalError, waitForGenerationTask, type GenerationTask } from "../src/services/api/task-center";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalAdapter = apiClient.defaults.adapter;
const running: GenerationTask = {
    id: "existing-task",
    type: "canvas_video",
    status: "running",
    prompt: "fixture",
    attempts: 1,
    createdAt: "2026-10-15",
    updatedAt: "2026-10-15",
};
const terminal: GenerationTask = { ...running, status: "succeeded" };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("image polling bounds each read and reconnects to the same task after a timeout", async () => {
    let reads = 0;
    apiClient.defaults.adapter = async (config) => {
        expect(config.timeout).toBe(20_000);
        expect(config.url).toBe(`/tasks/${running.id}`);
        if (++reads === 1) throw new Error("read timed out");
        return { config, status: 200, statusText: "", headers: {}, data: { code: 0, data: terminal } };
    };
    const result = await waitForGenerationTask(running.id, { initialTask: { ...running, type: "canvas_image" }, intervalMs: 1 });
    expect(result.status).toBe("succeeded");
    expect(reads).toBe(2);
});

test("retrying the same failed task resumes existing subscribers through completion", async () => {
    let latest: GenerationTask = { ...running, status: "failed" };
    const seen: string[] = [];
    let queries = 0;
    const service = createGenerationTaskSubscriptionService({
        async queryTask() {
            queries++;
            return latest;
        },
        async waitTask() {
            return terminal;
        },
    });
    const unsubscribe = service.subscribe([running.id], (task) => seen.push(task.status));
    await tick();
    latest = { ...running, status: "queued", attempts: 2 };
    service.refresh(latest);
    await tick();
    expect(queries).toBe(2);
    expect(seen).toEqual(["failed", "queued", "queued", "succeeded"]);
    unsubscribe();
});

test("late events from an aborted observation cannot overwrite a media recovery", async () => {
    let finishOld!: (task: GenerationTask) => void;
    let waits = 0;
    const seen: string[] = [];
    const service = createGenerationTaskSubscriptionService({
        async queryTask() {
            return running;
        },
        async waitTask(_id, options) {
            if (++waits === 1)
                return new Promise<GenerationTask>((resolve) => {
                    finishOld = resolve;
                });
            options?.onTaskUpdate?.(running);
            return terminal;
        },
    });
    const unsubscribe = service.subscribe([running.id], (task) => seen.push(task.status));
    await tick();
    service.refresh({ ...running, status: "queued" });
    await tick();
    finishOld({ ...running, status: "failed" });
    await tick();
    expect(seen.at(-1)).toBe("succeeded");
    expect(seen).not.toContain("failed");
    unsubscribe();
});

beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: Object.assign(new EventTarget(), {
            setTimeout,
            clearTimeout,
            localStorage: { getItem: () => "fixture" },
        }),
    });
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    apiClient.defaults.adapter = originalAdapter;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: originalWindow,
        });
});

test("text reconnect queries the same task with the last event sequence and deduplicates replay", async () => {
    const urls: string[] = [];
    const texts: string[] = [];
    const queries: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        expect(config.method).toBe("get");
        queries.push(String(config.url));
        return {
            config,
            status: 200,
            statusText: "",
            headers: {},
            data: { code: 0, data: terminal, msg: "ok" },
        };
    };
    globalThis.fetch = (async (url: string | URL | Request) => {
        urls.push(String(url));
        const frames =
            urls.length === 1
                ? 'id: 1\nevent: delta\ndata: {"sequence":1,"content":"hello"}\n\n'
                : 'id: 1\nevent: delta\ndata: {"sequence":1,"content":"hello"}\n\nid: 2\nevent: delta\ndata: {"sequence":2,"content":" world"}\n\nevent: terminal\ndata: {"finalText":"hello world"}\n\n';
        return new Response(frames, {
            headers: { "content-type": "text/event-stream" },
        });
    }) as typeof fetch;
    const result = await waitForGenerationTask(running.id, {
        initialTask: running,
        useTextEvents: true,
        intervalMs: 1,
        timeoutMs: 1000,
        onTextDelta: (text) => texts.push(text),
    });
    expect(result.id).toBe(running.id);
    expect(urls).toEqual(["/api/tasks/existing-task/text-events", "/api/tasks/existing-task/text-events?after=1"]);
    expect(texts).toEqual(["hello", "hello world"]);
    expect(queries).toEqual(["/tasks/existing-task"]);
});

test("polling stops after five network failures but can resume the original task without creation", async () => {
    let offline = true;
    let queries = 0;
    const observer = new AbortController();
    apiClient.defaults.adapter = async (config) => {
        expect(config.method).toBe("get");
        expect(config.url).toBe("/tasks/existing-task");
        queries += 1;
        if (offline) throw new Error("offline fixture");
        return {
            config,
            status: 200,
            statusText: "",
            headers: {},
            data: { code: 0, data: terminal, msg: "ok" },
        };
    };
    await expect(
        waitForGenerationTask(running.id, {
            initialTask: running,
            intervalMs: 1,
            signal: observer.signal,
            onTaskUpdate: (task) => {
                if (task.stage === "正在重新连接任务状态") observer.abort();
            },
        }),
    ).rejects.toThrow("Aborted");
    expect(queries).toBe(5);
    offline = false;
    expect(
        (
            await waitForGenerationTask(running.id, {
                initialTask: running,
                intervalMs: 1,
                timeoutMs: 1000,
            })
        ).status,
    ).toBe("succeeded");
    expect(queries).toBe(6);
});

test("media polling asks the user to sign in again on 401 and resumes after login", async () => {
    let queries = 0;
    const stages: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        queries += 1;
        if (queries <= 6) {
            return { config, status: 401, statusText: "Unauthorized", headers: {}, data: { code: 401, data: null, msg: "请先登录", reason: "unauthorized" } };
        }
        return { config, status: 200, statusText: "", headers: {}, data: { code: 0, data: terminal, msg: "ok" } };
    };
    const result = await waitForGenerationTask(running.id, {
        initialTask: running,
        intervalMs: 1,
        onTaskUpdate: (task) => stages.push(task.stage || ""),
    });
    expect(result.status).toBe("succeeded");
    expect(queries).toBe(7);
    // 只提示一次，且不会被“重新连接”覆盖；后台任务结果在重新登录后照常取回。
    expect(stages.filter((stage) => stage.includes("重新登录"))).toHaveLength(1);
    expect(stages).not.toContain("正在重新连接任务状态");
});

test("only a backend failure is a terminal task error; polling interruptions are not", async () => {
    let failed = false;
    apiClient.defaults.adapter = async (config) => {
        if (!failed) throw new Error("Network Error");
        return { config, status: 200, statusText: "", headers: {}, data: { code: 0, data: { ...running, status: "failed", error: "上游拒绝本次请求" }, msg: "ok" } };
    };
    const interrupted = await waitForGenerationTask(running.id, { initialTask: running, intervalMs: 1, timeoutMs: 1000 }).catch((error: unknown) => error);
    expect(interrupted).toBeInstanceOf(Error);
    expect(isGenerationTaskTerminalError(interrupted)).toBe(false);

    failed = true;
    const terminal = await waitForGenerationTask(running.id, { initialTask: running, intervalMs: 1, timeoutMs: 1000 }).catch((error: unknown) => error);
    expect(isGenerationTaskTerminalError(terminal)).toBe(true);
    if (isGenerationTaskTerminalError(terminal)) expect(terminal.task).toMatchObject({ id: running.id, status: "failed" });
});

test("a failed observer restarts for an existing subscriber when network returns", async () => {
    let offline = true;
    let queries = 0;
    const seen: string[] = [];
    const service = createGenerationTaskSubscriptionService({
        async queryTask(id) {
            expect(id).toBe(running.id);
            queries += 1;
            if (offline) throw new Error("offline fixture");
            return terminal;
        },
        async waitTask() {
            throw new Error("terminal task must not be polled");
        },
    });
    const previousWarn = console.warn;
    console.warn = () => undefined;
    try {
        const unsubscribe = service.subscribe([running.id], (task) => seen.push(task.status));
        await tick();
        offline = false;
        window.dispatchEvent(new Event("online"));
        await tick();
        expect(queries).toBe(2);
        expect(seen).toEqual(["succeeded"]);
        const unsubscribeAgain = service.subscribe([running.id], (task) => seen.push(task.status));
        await tick();
        expect(queries).toBe(2);
        expect(seen).toEqual(["succeeded", "succeeded"]);
        unsubscribe();
        unsubscribeAgain();
    } finally {
        console.warn = previousWarn;
    }
});

test("last subscriber aborts observation and reopening resumes the same task", async () => {
    const signals: AbortSignal[] = [];
    const ids: string[] = [];
    const service = createGenerationTaskSubscriptionService({
        async queryTask(id) {
            ids.push(id);
            return running;
        },
        async waitTask(_id, options) {
            const signal = options!.signal!;
            signals.push(signal);
            return new Promise<GenerationTask>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
        },
    });
    const first = service.subscribe([running.id], () => {});
    const second = service.subscribe([running.id], () => {});
    await tick();
    expect(ids).toEqual([running.id]);
    first();
    expect(signals[0].aborted).toBe(false);
    second();
    expect(signals[0].aborted).toBe(true);
    const reopened = service.subscribe([running.id], () => {});
    await tick();
    expect(ids).toEqual([running.id, running.id]);
    expect(signals[1].aborted).toBe(false);
    reopened();
    expect(signals[1].aborted).toBe(true);
});
