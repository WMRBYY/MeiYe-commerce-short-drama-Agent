import localforage from "localforage";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { startEcommerceExecution, startEcommerceBatchExecution, startEcommercePackageExecution, type EcommerceBatchExecutionRequest, type EcommerceExecutionRequest, type EcommerceProject } from "@/services/api/ecommerce";
type ExecutionRequest = EcommerceExecutionRequest | EcommerceBatchExecutionRequest;
import { ApiError } from "@/services/api/request";

const PREFIX = "shop-detail-request:";
// Older open tabs replay the legacy prefix against its endpoint. They must
// never submit a package, even while the application is being rolled back.
const PACKAGE_PREFIX = "shop-auto-package-request:";
const locks = new Map<string, Promise<EcommerceProject>>();

function isPackageRequest(input: ExecutionRequest) {
    return !("jobs" in input) && Boolean(input.draft.autoPackage);
}

// Write the complete request before its HTTP submission. If the response is
// lost, replay uses the same server idempotency key, never a new paid run.
export async function sendDetailRequest(scope: string, input: ExecutionRequest) {
    const storage = localForageStorageForScope(scope);
    const storageKey = (isPackageRequest(input) ? PACKAGE_PREFIX : PREFIX) + input.id;
    await storage.setItem(storageKey, JSON.stringify(input));
    return deliver(scope, storageKey, input);
}

export async function retryStoredDetailRequest(scope: string, id: string, autoPackage = false) {
    const storageKey = (autoPackage ? PACKAGE_PREFIX : PREFIX) + id;
    const raw = await localForageStorageForScope(scope).getItem(storageKey);
    return raw ? deliver(scope, storageKey, JSON.parse(raw) as ExecutionRequest) : null;
}

function deliver(scope: string, storageKey: string, input: ExecutionRequest) {
    const key = `${scope}:${storageKey}`;
    const existing = locks.get(key);
    if (existing) return existing;
    const work = (async () => {
        if (getActiveUserScope() !== scope) throw new Error("账号已切换，原账号请求已保留");
        const storage = localForageStorageForScope(scope);
        try {
            const project = await ("jobs" in input ? startEcommerceBatchExecution(input) : input.draft.autoPackage ? startEcommercePackageExecution(input) : startEcommerceExecution(input));
            await storage.removeItem(storageKey);
            return project;
        } catch (error) {
            // Expired login, timeouts and throttling keep the same request for
            // reconciliation after login/reconnect; none proves a lost intent.
            if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status) && !error.retryable) {
                await storage.removeItem(storageKey);
            }
            throw error;
        }
    })().finally(() => locks.delete(key));
    locks.set(key, work);
    return work;
}

export async function resumeDetailRequests(scope: string, saved: (project: EcommerceProject) => void) {
    const storage = localForageStorageForScope(scope);
    // Enumerate independent keys instead of a read/modify/write index: two tabs
    // saving simultaneously cannot overwrite each other's recovery entries.
    const suffix = `:user:${scope}`;
    const keys = (await localforage.keys()).filter((key) => (key.startsWith(PREFIX) || key.startsWith(PACKAGE_PREFIX)) && key.endsWith(suffix));
    for (const key of keys) {
        if (getActiveUserScope() !== scope) return;
        const storageKey = key.slice(0, -suffix.length);
        const raw = await storage.getItem(storageKey);
        if (!raw) continue;
        try {
            const input = JSON.parse(String(raw)) as ExecutionRequest;
            const project = await deliver(scope, storageKey, input);
            if (getActiveUserScope() === scope) saved(project);
        } catch {
            // Keep uncertain delivery visible in the draft; a later reconnect
            // retries with the identical ID. Never start work under another user.
        }
    }
}
