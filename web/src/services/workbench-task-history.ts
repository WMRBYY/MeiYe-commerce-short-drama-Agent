import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { GenerationTask } from "@/services/api/task-center";
import type { WorkbenchKind } from "@/services/api/workbench";
import { cacheGenerationTasks, getCachedGenerationTasks, loadCachedGenerationTasks } from "./generation-task-cache";

const histories = new Map<string, { ids: string[]; loaded?: Promise<void>; revision: number; tasks?: GenerationTask[]; writes: Promise<unknown> }>();
const storageKey = (kind: WorkbenchKind) => `workbench-history-${kind}`;
const history = (scope: string, kind: WorkbenchKind) => {
    const key = JSON.stringify([scope, kind]);
    let entry = histories.get(key);
    if (!entry) {
        entry = { ids: [], revision: 0, writes: Promise.resolve() };
        histories.set(key, entry);
    }
    return entry;
};

/** Membership is separate from shared receipts so other pages' image tasks cannot leak into this gallery. */
export function cachedWorkbenchTasks(scope: string, kind: WorkbenchKind) {
    const entry = history(scope, kind);
    const byId = new Map(getCachedGenerationTasks(scope).map((task) => [task.id, task]));
    if (entry.tasks)
        return entry.tasks.map((task) => {
            const receipt = byId.get(task.id);
            return receipt && receipt.updatedAt >= task.updatedAt ? { ...task, ...receipt, prompt: task.prompt } : task;
        });
    return entry.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function loadWorkbenchTaskHistory(scope: string, kind: WorkbenchKind) {
    const entry = history(scope, kind);
    entry.loaded ??= (async () => {
        const revision = entry.revision;
        try {
            const [raw] = await Promise.all([localForageStorageForScope(scope).getItem(storageKey(kind)), loadCachedGenerationTasks(scope)]);
            const ids: unknown = raw ? JSON.parse(raw) : [];
            if (entry.revision === revision && Array.isArray(ids)) entry.ids = ids.filter((id): id is string => typeof id === "string").slice(0, 100);
        } catch {
            /* A failed cache read leaves the server request authoritative. */
        }
    })();
    await entry.loaded;
    return cachedWorkbenchTasks(scope, kind);
}

export function rememberWorkbenchTasks(scope: string, kind: WorkbenchKind, tasks: GenerationTask[]) {
    const entry = history(scope, kind);
    const previous = new Map([...getCachedGenerationTasks(scope), ...cachedWorkbenchTasks(scope, kind)].map((task) => [task.id, task]));
    const merged = tasks.map((task) => {
        const before = previous.get(task.id);
        if (!before) return task;
        if (before.updatedAt > task.updatedAt) return before;
        return { ...task, ...(before.status === "succeeded" && task.status === "succeeded" && !task.resultJson ? { resultJson: before.resultJson } : {}) };
    });
    entry.revision += 1;
    entry.ids = merged.map((task) => task.id).slice(0, 100);
    entry.tasks = merged;
    cacheGenerationTasks(merged, scope);
    const ids = JSON.stringify(entry.ids);
    entry.writes = entry.writes.then(() => localForageStorageForScope(scope).setItem(storageKey(kind), ids)).catch(() => undefined);
    return merged;
}
