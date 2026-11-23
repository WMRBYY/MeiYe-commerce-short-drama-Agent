import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { setActiveUserScope } from "@/lib/user-scope";
import { ApiError, apiClient } from "@/services/api/request";
import { clearResourceAccessCache, getResourceBlob, type ResourceAccess } from "@/services/api/resources";

const dom = new Window({ url: "https://canvas.example.com/ecommerce" });
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalFetch = globalThis.fetch;
const originalAdapter = apiClient.defaults.adapter;
let grants: Array<{ resourceId: string; purpose: string }> = [];
let reads: Array<{ url: string; options?: RequestInit }> = [];
let access: ResourceAccess;

function installFetch(read: (url: string, options?: RequestInit) => Promise<Response>) {
    globalThis.fetch = (async (url, options) => {
        reads.push({ url: String(url), options });
        return read(String(url), options);
    }) as typeof fetch;
}

beforeAll(() => { Object.defineProperty(globalThis, "window", { value: dom, configurable: true, writable: true }); });
beforeEach(() => {
    clearResourceAccessCache();
    setActiveUserScope("resource-owner");
    grants = []; reads = [];
    access = { resourceId: "reference", requestedVariant: "original", actualVariant: "original", url: "https://cdn.example.com/reference.png", delivery: "cdn",
        issuedAt: new Date().toISOString(), refreshAt: new Date(Date.now() + 120_000).toISOString(), revision: "v1" };
    apiClient.defaults.adapter = async (config) => {
        expect(config.url).toBe("/resources/access");
        expect(config.method).toBe("post");
        const entries = JSON.parse(config.data as string) as Array<{ resourceId: string; purpose: string }>;
        grants.push(...entries);
        return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: entries.map((entry) => ({ resourceId: entry.resourceId, access: { ...access } })) } } };
    };
    installFetch(async () => new Response(new Blob(["source-pixels"], { type: "image/png" })));
});
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    clearResourceAccessCache();
    setActiveUserScope(null);
});
afterAll(() => {
    dom.happyDOM.abort();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

describe("resource blob authorization and read recovery", () => {
    test("network failure refreshes authorization and reads the newly issued URL once", async () => {
        installFetch(async () => {
            if (reads.length === 1) {
                access = { ...access, url: "https://cdn.example.com/reference-refreshed.png", revision: "v2" };
                throw new TypeError("Failed to fetch");
            }
            return new Response("recovered-pixels");
        });
        const blob = await getResourceBlob("resource:reference");
        expect(await blob?.text()).toBe("recovered-pixels");
        expect(grants).toEqual([{ resourceId: "reference", purpose: "browser-process", variant: "original" }, { resourceId: "reference", purpose: "browser-process", variant: "original" }]);
        expect(reads.map((read) => read.url)).toEqual(["https://cdn.example.com/reference.png", "https://cdn.example.com/reference-refreshed.png"]);
        expect(reads.every((read) => read.options?.credentials === "omit" && read.options.mode === "cors")).toBe(true);
    });

    test("ecommerce processing uses the authorized platform byte stream with its session", async () => {
        access = { ...access, url: "/api/resources/reference/file?purpose=ecommerce-export", delivery: "platform-proxy" };
        expect(await (await getResourceBlob("resource:reference", "ecommerce-export"))?.text()).toBe("source-pixels");
        expect(grants[0].purpose).toBe("ecommerce-export");
        expect(reads).toHaveLength(1);
        expect(reads[0].url).toBe("/api/resources/reference/file?purpose=ecommerce-export");
        expect(reads[0].options?.credentials).toBe("include");
    });

    test("temporary platform read failure retries only resource authorization and bytes", async () => {
        access = { ...access, url: "/api/resources/reference/file?purpose=ecommerce-export", delivery: "platform-proxy" };
        installFetch(async () => reads.length === 1 ? new Response("unavailable", { status: 503 }) : new Response("recovered-pixels"));
        expect(await (await getResourceBlob("resource:reference", "ecommerce-export"))?.text()).toBe("recovered-pixels");
        expect(grants).toHaveLength(2);
        expect(grants.every((grant) => grant.purpose === "ecommerce-export")).toBe(true);
        expect(reads).toHaveLength(2);
        expect(reads.every((read) => read.options?.credentials === "include")).toBe(true);
    });

    test.each([401, 403, 404])("an authorization batch failure (%i) is preserved without byte reads or fallback", async (code) => {
        let requests = 0;
        apiClient.defaults.adapter = async (config) => {
            requests++;
            return { config, headers: {}, status: code, statusText: "Error", data: { code, msg: "资源不可访问", reason: "forbidden", data: null } };
        };
        const error = await getResourceBlob("resource:reference", "ecommerce-export").catch((error: unknown) => error);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status: code, code, reason: "forbidden", retryable: false });
        expect(requests).toBe(1);
        expect(reads).toEqual([]);
    });

    test("a per-resource ownership failure retains its structured reason and prevents fetch", async () => {
        apiClient.defaults.adapter = async (config) => ({ config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: [
            { resourceId: "reference", error: { code: 404, reason: "not_found", msg: "资源不存在或不可访问" } },
        ] } } });
        const error = await getResourceBlob("resource:reference", "ecommerce-export").catch((error: unknown) => error);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ code: 404, reason: "not_found", retryable: false });
        expect(reads).toEqual([]);
    });

    test.each([401, 403, 404])("a byte read refused with %i does not retry or change delivery purpose", async (status) => {
        installFetch(async () => new Response("denied", { status }));
        const error = await getResourceBlob("resource:reference").catch((error: unknown) => error);
        expect(error).toMatchObject({ status, retryable: false });
        expect(grants).toHaveLength(1);
        expect(reads).toHaveLength(1);
        expect((error as Error).message).toContain(status === 401 ? "重新登录" : status === 403 ? "确认当前账号" : "重新上传");
    });

    test("a timed-out body read retries once without changing authorization purpose", async () => {
        access = { ...access, url: "/api/resources/reference/file?purpose=ecommerce-export", delivery: "platform-proxy" };
        installFetch(async () => {
            const response = new Response("recovered-pixels");
            if (reads.length === 1) response.blob = async () => { throw new DOMException("body timed out", "TimeoutError"); };
            return response;
        });
        expect(await (await getResourceBlob("resource:reference", "ecommerce-export"))?.text()).toBe("recovered-pixels");
        expect(grants).toHaveLength(2);
        expect(grants.every((grant) => grant.purpose === "ecommerce-export")).toBe(true);
        expect(reads.every((read) => read.options?.credentials === "include")).toBe(true);
    });

    test("an authorization refusal during refresh stops before a second byte read", async () => {
        const grantAdapter = apiClient.defaults.adapter;
        installFetch(async () => {
            apiClient.defaults.adapter = async (config) => ({ config, headers: {}, status: 403, statusText: "Forbidden", data: { code: 403, msg: "无权访问", reason: "forbidden", data: null } });
            throw new TypeError("Failed to fetch");
        });
        await expect(getResourceBlob("resource:reference")).rejects.toThrow("无权访问");
        expect(reads).toHaveLength(1);
        apiClient.defaults.adapter = grantAdapter;
    });

    test("persistent network failure stops after one retry with a usable error", async () => {
        installFetch(async () => { throw new TypeError("Failed to fetch"); });
        const error = await getResourceBlob("resource:reference").catch((error: unknown) => error);
        expect(error).toMatchObject({ reason: "resource_read_failed", retryable: true });
        expect((error as Error).message).toContain("读取失败");
        expect(grants).toHaveLength(2);
        expect(reads).toHaveLength(2);
    });

    test.each(["scope", "cache-generation"])("%s change during a failed read prevents retry", async (kind) => {
        installFetch(async () => {
            if (kind === "scope") setActiveUserScope("another-owner");
            else clearResourceAccessCache();
            throw new TypeError("Failed to fetch");
        });
        const error = await getResourceBlob("resource:reference").catch((error: unknown) => error);
        expect(error).toMatchObject({ name: "AbortError" });
        expect(grants).toHaveLength(1);
        expect(reads).toHaveLength(1);
    });

    test("account switch while consuming the body discards the bytes", async () => {
        installFetch(async () => {
            const response = new Response("old-account-pixels");
            response.blob = async () => {
                setActiveUserScope("another-owner");
                return new Blob(["old-account-pixels"]);
            };
            return response;
        });
        const error = await getResourceBlob("resource:reference").catch((error: unknown) => error);
        expect(error).toMatchObject({ name: "AbortError" });
        expect(grants).toHaveLength(1);
    });

    test("an explicitly aborted read is never retried", async () => {
        const aborted = new DOMException("cancelled", "AbortError");
        installFetch(async () => { throw aborted; });
        expect(await getResourceBlob("resource:reference").catch((error: unknown) => error)).toBe(aborted);
        expect(grants).toHaveLength(1);
        expect(reads).toHaveLength(1);
    });
});
