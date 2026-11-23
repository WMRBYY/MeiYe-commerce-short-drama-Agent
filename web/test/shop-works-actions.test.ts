import { describe, expect, test } from "bun:test";
import type { Asset } from "@/stores/use-asset-store";
import { collectShopWorkIds, deleteShopWorkIds } from "@/pages/shop/shop-works-actions";

const asset = (id: string, kind = "image", status = "confirmed") => ({ id, kind, status }) as Asset;
const currentUser = () => {};

describe("电商作品批量删除", () => {
    test("全部删除收集尚未加载的分页，排除非作品、归档及筛选外素材，并去重", async () => {
        const pages = [
            { assets: [asset("first"), asset("audio", "audio"), asset("archived", "image", "archived")], hasMore: true },
            { assets: [asset("first"), asset("second", "video"), asset("hidden")], hasMore: false },
        ];
        const requested: number[] = [];
        const ids = await collectShopWorkIds(
            async (page) => {
                requested.push(page);
                return pages[page - 1];
            },
            (item) => item.id !== "hidden",
            currentUser,
        );
        expect(requested).toEqual([1, 2]);
        expect(ids).toEqual(["first", "second"]);
    });

    test("后续页读取失败不会返回部分名单", async () => {
        await expect(
            collectShopWorkIds(
                async (page) => {
                    if (page === 2) throw new Error("网络中断");
                    return { assets: [asset("first")], hasMore: true };
                },
                () => true,
                currentUser,
            ),
        ).rejects.toThrow("网络中断");
    });

    test("不完整空页中断统计，空结果允许取消", async () => {
        await expect(
            collectShopWorkIds(
                async () => ({ assets: [], hasMore: true }),
                () => true,
                currentUser,
            ),
        ).rejects.toThrow("未读取完整");
        expect(
            await collectShopWorkIds(
                async () => ({ assets: [], hasMore: false }),
                () => true,
                currentUser,
            ),
        ).toEqual([]);
    });

    test("读取期间切换账号，不接受旧账号名单", async () => {
        let switched = false;
        await expect(
            collectShopWorkIds(
                async () => {
                    switched = true;
                    return { assets: [asset("first")], hasMore: false };
                },
                () => true,
                () => {
                    if (switched) throw new Error("账号已切换");
                },
            ),
        ).rejects.toThrow("账号已切换");
    });

    test("超过接口上限按 1000 个分批，成功后才通知界面移除", async () => {
        const ids = Array.from({ length: 1001 }, (_, i) => `work-${i}`);
        const events: string[] = [];
        await deleteShopWorkIds([...ids, ids[0]], {
            assertCurrentUser: currentUser,
            deleteBatch: async (batch) => {
                events.push(`request:${batch.length}`);
            },
            onDeleted: (batch) => {
                events.push(`removed:${batch.length}`);
            },
        });
        expect(events).toEqual(["request:1000", "removed:1000", "request:1", "removed:1"]);
    });

    test("部分失败不移除失败批次、不继续后续批次，剩余名单可重试", async () => {
        const ids = Array.from({ length: 2001 }, (_, i) => `work-${i}`);
        const removed: string[] = [];
        let requests = 0;
        await expect(
            deleteShopWorkIds(ids, {
                assertCurrentUser: currentUser,
                deleteBatch: async () => {
                    if (++requests === 2) throw new Error("删除失败");
                },
                onDeleted: (batch) => {
                    removed.push(...batch);
                },
            }),
        ).rejects.toThrow("删除失败");
        expect(requests).toBe(2);
        expect(removed).toEqual(ids.slice(0, 1000));
        const remaining = ids.filter((id) => !removed.includes(id));
        await deleteShopWorkIds(remaining, {
            assertCurrentUser: currentUser,
            deleteBatch: async () => {},
            onDeleted: (batch) => {
                removed.push(...batch);
            },
        });
        expect(removed).toEqual(ids);
    });

    test("批次间切换账号停止后续删除", async () => {
        let switched = false;
        let requests = 0;
        await expect(
            deleteShopWorkIds(
                Array.from({ length: 1001 }, (_, i) => `work-${i}`),
                {
                    assertCurrentUser: () => {
                        if (switched) throw new Error("账号已切换");
                    },
                    deleteBatch: async () => {
                        requests++;
                    },
                    onDeleted: () => {
                        switched = true;
                    },
                },
            ),
        ).rejects.toThrow("账号已切换");
        expect(requests).toBe(1);
    });

    test("空或非法 ID 不发删除请求", async () => {
        let requests = 0;
        for (const ids of [[], ["first", " "]]) {
            await expect(
                deleteShopWorkIds(ids, {
                    assertCurrentUser: currentUser,
                    deleteBatch: async () => {
                        requests++;
                    },
                    onDeleted: () => {},
                }),
            ).rejects.toThrow("重新选择");
        }
        expect(requests).toBe(0);
    });
});
