import { expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { clearResourceAccessCache, getResourceAccess } from "../src/services/api/resources";

test("deleted resources stop repeated access requests across thumbnail variants and recover after explicit refresh", async () => {
    const adapter = apiClient.defaults.adapter;
    let requests = 0;
    let available = false;
    clearResourceAccessCache();
    try {
        apiClient.defaults.adapter = async config => {
            requests += 1;
            const items = JSON.parse(config.data).map((entry: { resourceId: string }) => ({
                resourceId: entry.resourceId,
                ...(available ? { access: { url: "/api/test-image", delivery: "local", expiresAt: new Date(Date.now() + 60_000).toISOString() } } : { error: { code: 404, reason: "not_found", msg: "deleted" } }),
            }));
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items } } };
        };
        await expect(getResourceAccess("resource:deleted-test", "display", "thumbnail-small")).rejects.toThrow();
        await expect(getResourceAccess("resource:deleted-test", "display", "thumbnail")).rejects.toThrow();
        expect(requests).toBe(1);
        available = true;
        expect((await getResourceAccess("resource:deleted-test", "display", "thumbnail", "", { forceRefresh: true })).url).toBe("/api/test-image");
        expect(requests).toBe(2);
        clearResourceAccessCache();
        await getResourceAccess("resource:deleted-test", "display", "thumbnail");
        expect(requests).toBe(3);
    } finally {
        clearResourceAccessCache();
        apiClient.defaults.adapter = adapter;
    }
});

test("temporary thumbnail failures remain retryable", async () => {
    const adapter = apiClient.defaults.adapter;
    let requests = 0;
    clearResourceAccessCache();
    try {
        apiClient.defaults.adapter = async config => {
            requests += 1;
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items: [{ resourceId: "pending-test", error: { code: 503, reason: "resource_thumbnail_unavailable", msg: "pending" } }] } } };
        };
        for (let i = 0; i < 2; i++) await expect(getResourceAccess("resource:pending-test", "display", "thumbnail-small")).rejects.toThrow();
        expect(requests).toBe(2);
    } finally {
        clearResourceAccessCache();
        apiClient.defaults.adapter = adapter;
    }
});
