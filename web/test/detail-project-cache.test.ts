import { expect, test } from "bun:test";
import type { StateStorage } from "zustand/middleware";

import { createDetailProjectCache } from "../src/pages/shop/detail-project-cache";
import type { EcommerceProject } from "../src/services/api/ecommerce";

const project = (id: string, revision = 1): EcommerceProject => ({ id, revision, name: id, status: "done", draftJson: "{}", planJson: '{"images":[]}', createdAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z" });
const storage = () => {
    const values = new Map<string, string>();
    const forScope = (scope: string): StateStorage => ({
        getItem: (key) => values.get(`${scope}:${key}`) || null,
        setItem: (key, value) => {
            values.set(`${scope}:${key}`, value);
        },
        removeItem: (key) => {
            values.delete(`${scope}:${key}`);
        },
    });
    return { forScope };
};

test("详情项目切页直接读内存，刷新恢复持久快照且账号隔离", async () => {
    const { forScope } = storage();
    const cache = createDetailProjectCache(forScope);
    cache.remember("owner", [project("finished", 3)]);
    expect(cache.read("owner")?.[0].id).toBe("finished");
    expect(cache.read("other")).toBeNull();
    await cache.flush("owner");
    const refreshed = createDetailProjectCache(forScope);
    expect((await refreshed.load("owner"))?.[0].revision).toBe(3);
    expect(await refreshed.load("other")).toBeNull();
});

test("迟到的旧列表不能覆盖已收到的完整方案", () => {
    const cache = createDetailProjectCache(storage().forScope);
    cache.remember("owner", [project("finished", 5)]);
    expect(cache.remember("owner", [project("finished", 3)], true)[0].revision).toBe(5);
});

test("服务端删除及本地删除都不会在刷新后复活", async () => {
    const { forScope } = storage();
    const cache = createDetailProjectCache(forScope);
    cache.remember("owner", [project("deleted-remotely"), project("deleted-locally"), project("retained")]);
    cache.remember("owner", [project("deleted-locally"), project("retained")], true);
    cache.forget("owner", ["deleted-locally"]);
    await cache.flush("owner");
    expect((await createDetailProjectCache(forScope).load("owner"))?.map((value) => value.id)).toEqual(["retained"]);
});

test("慢磁盘读取不能覆盖期间收到的服务器结果或删除", async () => {
    let resolve!: (value: string) => void;
    const cache = createDetailProjectCache(() => ({
        getItem: () =>
            new Promise<string>((done) => {
                resolve = done;
            }),
        setItem: () => {},
        removeItem: () => {},
    }));
    const loading = cache.load("owner");
    cache.remember("owner", [], true);
    resolve(JSON.stringify([project("old")]));
    expect(await loading).toEqual([]);
});

test("仅保留最近 100 个项目", () => {
    const cache = createDetailProjectCache(storage().forScope);
    cache.remember(
        "owner",
        Array.from({ length: 140 }, (_, index) => project(`project-${index}`)),
    );
    expect(cache.read("owner")).toHaveLength(100);
});
