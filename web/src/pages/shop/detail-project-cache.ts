import type { StateStorage } from "zustand/middleware";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { EcommerceProject } from "@/services/api/ecommerce";

const KEY = "shop-detail-projects-v1";
const LIMIT = 100;

/** Result metadata only; generated image bytes stay in the browser's media cache. */
export function createDetailProjectCache(storageFor: (scope: string) => StateStorage = localForageStorageForScope) {
    const scopes = new Map<string, { projects: EcommerceProject[] | null; writes: Promise<unknown>; loading?: Promise<EcommerceProject[] | null> }>();
    const entryFor = (scope: string) => {
        let entry = scopes.get(scope);
        if (!entry) {
            entry = { projects: null, writes: Promise.resolve() };
            scopes.set(scope, entry);
        }
        return entry;
    };
    const read = (scope: string) => entryFor(scope).projects;
    const remember = (scope: string, incoming: EcommerceProject[], replace = false) => {
        const entry = entryFor(scope);
        const previous = new Map((entry.projects || []).map((project) => [project.id, project]));
        const next = replace ? new Map<string, EcommerceProject>() : new Map(previous);
        for (const project of incoming) {
            const saved = next.get(project.id) || previous.get(project.id);
            next.set(project.id, saved && saved.revision > project.revision ? saved : project);
        }
        entry.projects = [...next.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, LIMIT);
        const serialized = JSON.stringify(entry.projects);
        entry.writes = entry.writes.then(() => storageFor(scope).setItem(KEY, serialized)).catch(() => undefined);
        return entry.projects;
    };
    return {
        read,
        remember,
        load(scope: string) {
            const entry = entryFor(scope);
            if (entry.projects !== null) return Promise.resolve(entry.projects);
            entry.loading ??= (async () => {
                try {
                    const raw = await storageFor(scope).getItem(KEY);
                    const saved: unknown = raw ? JSON.parse(raw) : null;
                    // A server response, local deletion or live update wins over a late disk read.
                    if (entry.projects === null && Array.isArray(saved)) {
                        entry.projects = saved
                            .filter((project): project is EcommerceProject => project && typeof project.id === "string" && typeof project.draftJson === "string" && typeof project.planJson === "string" && typeof project.revision === "number")
                            .slice(0, LIMIT);
                    }
                } catch {
                    // Server loading remains available when browser storage is unavailable.
                }
                return entry.projects;
            })();
            return entry.loading;
        },
        forget(scope: string, ids: string[]) {
            return remember(
                scope,
                (read(scope) || []).filter((project) => !ids.includes(project.id)),
                true,
            );
        },
        async flush(scope: string) {
            await entryFor(scope).writes;
        },
    };
}

export const detailProjectCache = createDetailProjectCache();
