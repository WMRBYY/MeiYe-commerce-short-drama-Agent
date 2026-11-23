import type { StateStorage } from "zustand/middleware";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { GenerationTask } from "@/services/api/task-center";

const KEY = "generation-result-snapshots-v1";
const LIMIT = 400;
const terminal = (task: GenerationTask) => ["succeeded", "failed", "cancelled"].includes(task.status);

// Display receipts only: never persist provider inputs, credentials or inline media.
function snapshot(task: GenerationTask): GenerationTask {
    const stable = (value?: string) => (value && value.length <= 32_768 && !/(?:data:|blob:)/i.test(value) ? value : undefined);
    return {
        id: task.id,
        type: task.type,
        status: task.status,
        prompt: task.prompt?.slice(0, 32_000) || "",
        attempts: task.attempts,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        model: task.model,
        provider: task.provider,
        clientContext: task.clientContext,
        projectId: task.projectId,
        outputs: task.outputs?.map(({ outputIndex, mediaType, materializedAssetId }) => ({ outputIndex, mediaType, materializedAssetId })),
        resultJson: stable(task.resultJson),
        previewUrl: stable(task.previewUrl),
        previewKind: task.previewKind,
        previewPosterUrl: stable(task.previewPosterUrl),
        resultState: task.resultState,
        error: task.error?.slice(0, 2000),
        errorCode: task.errorCode,
    };
}

function preserveOutputs(next: GenerationTask, previous?: GenerationTask) {
    if (previous?.status === next.status && previous.attempts === next.attempts) {
        next.resultJson ??= previous.resultJson;
        next.outputs ??= previous.outputs;
        next.previewUrl ??= previous.previewUrl;
        next.previewKind ??= previous.previewKind;
        next.previewPosterUrl ??= previous.previewPosterUrl;
    }
    return next;
}

export function createGenerationTaskCache(storageFor: (scope: string) => StateStorage = localForageStorageForScope) {
    type Entry = { tasks: Map<string, GenerationTask>; touched: Set<string>; loaded?: Promise<void>; hydrated?: boolean; writes: Promise<unknown>; dirty?: boolean; writing?: boolean };
    const scopes = new Map<string, Entry>();
    const entryFor = (scope: string) => {
        let entry = scopes.get(scope);
        if (!entry) {
            entry = { tasks: new Map(), touched: new Set(), writes: Promise.resolve() };
            scopes.set(scope, entry);
        }
        return entry;
    };
    const trim = (entry: Entry) => {
        const newest = [...entry.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, LIMIT);
        entry.tasks = new Map(newest.map((task) => [task.id, task]));
    };
    const read = (scope: string) => [...entryFor(scope).tasks.values()];
    const load = async (scope: string) => {
        const entry = entryFor(scope);
        entry.loaded ??= (async () => {
            try {
                const raw = await storageFor(scope).getItem(KEY);
                const saved: unknown = raw ? JSON.parse(raw) : [];
                if (Array.isArray(saved))
                    for (const task of saved) {
                        if (!task || typeof task.id !== "string" || typeof task.updatedAt !== "string" || !terminal(task)) continue;
                        const savedTask = snapshot(task);
                        const current = entry.tasks.get(task.id);
                        if (!entry.touched.has(task.id)) entry.tasks.set(task.id, savedTask);
                        else if (current && current.updatedAt >= savedTask.updatedAt) entry.tasks.set(task.id, preserveOutputs(current, savedTask));
                    }
                trim(entry);
            } catch {
                /* Cache failure must not prevent the authoritative server read. */
            }
            entry.touched.clear();
            entry.hydrated = true;
        })();
        await entry.loaded;
        return read(scope);
    };
    const persist = (scope: string, entry: Entry) => {
        entry.dirty = true;
        if (entry.writing) return;
        entry.writing = true;
        // Coalesce bursts of task updates; hydrate before replacing disk receipts.
        entry.writes = entry.writes
            .then(async () => {
                await load(scope);
                while (entry.dirty) {
                    entry.dirty = false;
                    await storageFor(scope).setItem(KEY, JSON.stringify(read(scope)));
                }
            })
            .catch(() => undefined)
            .finally(() => {
                entry.writing = false;
                if (entry.dirty) persist(scope, entry);
            });
    };
    return {
        read,
        load,
        remember(scope: string, tasks: readonly GenerationTask[]) {
            const entry = entryFor(scope);
            for (const task of tasks) {
                const previous = entry.tasks.get(task.id);
                if (previous && previous.updatedAt > task.updatedAt) continue;
                if (!entry.hydrated) entry.touched.add(task.id);
                if (terminal(task)) {
                    const next = snapshot(task);
                    // List endpoints may omit outputs already returned by the detail endpoint.
                    entry.tasks.set(task.id, preserveOutputs(next, previous));
                } else entry.tasks.delete(task.id); // Explicit retries can reuse the same task ID.
            }
            trim(entry);
            persist(scope, entry);
        },
        forget(scope: string, id: string) {
            const entry = entryFor(scope);
            if (!entry.hydrated) entry.touched.add(id);
            entry.tasks.delete(id);
            persist(scope, entry);
        },
        async flush(scope: string) {
            await entryFor(scope).writes;
        },
    };
}

const cache = createGenerationTaskCache();
export const getCachedGenerationTasks = (scope = getActiveUserScope()) => cache.read(scope);
export const loadCachedGenerationTasks = (scope = getActiveUserScope()) => cache.load(scope);
export const cacheGenerationTasks = (tasks: readonly GenerationTask[], scope = getActiveUserScope()) => cache.remember(scope, tasks);
export const forgetCachedGenerationTask = (id: string, scope = getActiveUserScope()) => cache.forget(scope, id);
