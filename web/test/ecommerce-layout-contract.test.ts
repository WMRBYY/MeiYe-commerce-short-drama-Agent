import { expect, test } from "bun:test";
import { commerceLayoutContract, commerceLayoutInstruction, commercePhotographyBrief } from "../src/pages/ecommerce/layout-contract";

test("copy determines card count and all regions remain bounded and separate", () => {
    for (const ratio of ["1024x1824", "9:16", "1:2", "1:1", "3:4", "16:9"]) {
        for (const count of [0, 1, 2, 3, 4, 6, 8]) {
            const copy = ["滴管设计", "滴一滴，取用更直观", ...Array.from({ length: count }, (_, i) => `细节${i}｜已确认的短说明`)].join("\n");
            const layout = commerceLayoutContract({ ratio, copy });
            expect(layout.groups).toHaveLength(count);
            for (const box of [layout.heading, layout.artwork, layout.information]) {
                expect(box.x).toBeGreaterThanOrEqual(8);
                expect(box.y).toBeGreaterThanOrEqual(8);
                expect(box.x + box.width).toBeLessThanOrEqual(92);
                expect(box.y + box.height).toBeLessThanOrEqual(92);
                expect(box.height).toBeGreaterThanOrEqual(0);
            }
            expect(layout.heading.y + layout.heading.height).toBeLessThan(layout.artwork.y);
            if (count) expect(layout.artwork.y + layout.artwork.height).toBeLessThan(layout.information.y);
        }
    }
});

test("conflicting layout examples and empty six-row cards cannot override the final layout", () => {
    const brief = commercePhotographyBrief("【本屏唯一拍摄要求】旧重复要求\n【本屏具体内容】Same blue serum bottle, gold cap, original logo intact. Camera: 85mm, right-front view. Text area: headline and two callout insets on the left.\n【真人商业摄影执行】重复长规则\n【留白与防裁切·最终排版约束】重复规则");
    expect(brief).toContain("Same blue serum bottle");
    expect(brief).toContain("Camera: 85mm");
    expect(brief).not.toContain("callout");
    expect(brief).not.toContain("重复");
    const prompt = commerceLayoutInstruction({ ratio: "9:16", copy: "滴管设计\n滴一滴，取用更直观\n瓶肩过渡清晰\n标签原文，识别不跑偏", informationComponent: "细节放大窗｜右侧两处放大框和六行卡片" });
    expect(prompt).toContain("实际存在的 2 组信息");
    expect(prompt).not.toContain("六行");
    expect(prompt).not.toContain("右侧两处");
});

test("reference layouts retain their reading order instead of adopting the automatic grid", () => {
    const prompt = commerceLayoutInstruction({ ratio: "9:16", copy: "标题\n副标题", informationComponent: "标题导语｜按参考排版" }, true);
    expect(prompt).toContain("继承用户参考版式的阅读顺序");
    expect(prompt).not.toContain("商品与场景区 x=");
});

test("old reviewed label/description paragraphs stay together as four cards", () => {
    const layout = commerceLayoutContract({ ratio: "9:16", copy: "看包装\n先看这里\n\n滴管结构\n一眼能辨认\n\n瓶身轮廓\n线条更干净\n\n原文字样\n信息更直接\n\n取用方式\n日常更顺手" });
    expect(layout.groups).toHaveLength(4);
    expect(layout.groups[0]).toBe("滴管结构\n一眼能辨认");
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(2);
});

test("scene and closing pages keep their image-first rhythm within safe bounds", () => {
    for (const ratio of ["9:16", "16:9"]) {
        const layout = commerceLayoutContract({ ratio, copy: "海蓝精华\n把日常护理写得更清楚", informationComponent: "留白收束｜商品大图与情绪标题" });
        expect(layout.artwork.y + layout.artwork.height).toBeLessThan(layout.heading.y);
        expect(layout.heading.y + layout.heading.height).toBe(88);
    }
});
