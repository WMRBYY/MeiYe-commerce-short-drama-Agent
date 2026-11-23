import { expect, test } from "bun:test";

import { DRAMA_STYLES } from "../src/pages/shop/script/drama-styles";

test("ancient absurd commerce is a selectable short-drama style", () => {
    expect(DRAMA_STYLES.some((style) => style.id === "ancient-absurd-commerce" && style.label === "古代无厘头卖货")).toBe(true);
});

test("the romance, workplace, family and healing presets start with an active event", () => {
    for (const id of ["ceo-romance", "workplace-comeback", "family-warmth", "healing-growth"]) {
        const style = DRAMA_STYLES.find((item) => item.id === id);
        expect(style?.examples.every((example) => /当场|立刻|突然|直接|被|刚|一声|砰|拍桌|推门|抢/.test(example))).toBe(true);
    }
});
