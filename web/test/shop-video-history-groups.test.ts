import { describe, expect, test } from "bun:test";

import { groupGalleryBatchesByDay } from "../src/pages/workbench/workbench-gallery-groups";

describe("电商视频生成记录日期分组", () => {
    test("跨年时把上年最后一天归到昨天，并保留同一天的任务顺序", () => {
        const now = new Date(2027, 0, 1, 12);
        const items = [
            { id: "new", createdAt: new Date(2027, 0, 1, 8).toISOString() },
            { id: "old-a", createdAt: new Date(2026, 11, 31, 22).toISOString() },
            { id: "old-b", createdAt: new Date(2026, 11, 31, 10).toISOString() },
        ];
        const groups = groupGalleryBatchesByDay(items, now);
        expect(groups.map((group) => group.label)).toEqual(["今天", "昨天"]);
        expect(groups[1].items.map((item) => item.id)).toEqual(["old-a", "old-b"]);
    });

    test("闰年跨月与无法识别日期的历史记录不会丢失", () => {
        const groups = groupGalleryBatchesByDay([{ createdAt: new Date(2028, 1, 29, 18).toISOString() }, { createdAt: "invalid" }], new Date(2028, 2, 1, 9));
        expect(groups.map((group) => group.label)).toEqual(["昨天", "较早记录"]);
        expect(groups.flatMap((group) => group.items)).toHaveLength(2);
    });
});
