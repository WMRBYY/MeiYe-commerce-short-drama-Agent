import { describe, expect, test } from "bun:test";
import { commercePlatformGroups, platforms, commerceAutoRatio } from "../src/pages/ecommerce/catalog";
import { commerceKnowledgeFor, commerceKnowledgePrompt, commercePlatformKnowledge, commercePlatformNoText, commerceRestrictedPhrase } from "../src/pages/ecommerce/platform-knowledge";
import { commercePlatformImageRule, commercePlatformListingMain } from "../src/pages/ecommerce/platform-style";
import { commerceAllowsText, commerceTextConstraint } from "../src/pages/ecommerce/creative-controls";
import { commercePlanningPayload } from "../src/pages/ecommerce/workflow";
import { emptyEcommerceDraft } from "../src/services/api/ecommerce";

describe("platform knowledge and listing assets", () => {
    test("every selectable marketplace has a distinct profile", () => {
        expect(commercePlatformKnowledge.profiles).toHaveLength(platforms.length);
        for (const [id] of platforms) expect(commerceKnowledgeFor(id)?.style).toBeTruthy();
        expect(new Set(commercePlatformKnowledge.profiles.map((p) => p.style)).size).toBe(platforms.length);
        expect(commercePlatformGroups.crossBorder).toContain("shein");
        expect(commerceAutoRatio("shein", "main")).toBe("3:4");
    });
    test("main, secondary and social assets have different text constraints", () => {
        expect(commercePlatformNoText("shein", "main")).toBe(true);
        expect(commercePlatformNoText("shein", "secondary")).toBe(false);
        expect(commercePlatformNoText("ebay", "secondary")).toBe(true);
        expect(commercePlatformNoText("tiktok", "main")).toBe(true);
        expect(commercePlatformNoText("tiktok", "social")).toBe(false);
        expect(commercePlatformListingMain("mercado-libre", "main")).toBe(false);
        expect(commercePlatformListingMain("amazon", "main")).toBe(true);
        expect(commercePlatformImageRule("etsy", "main")).toContain("未经编辑");
        expect(commerceKnowledgePrompt("emag", "main")).toContain("待官方后台核实");
    });
    test("risk phrases tolerate fullwidth, separators and invisible characters", () => {
        for (const copy of ["Ｂｅｓｔ　Ｓｅｌｌｅｒ", "FDA\u200b Approved", "全 网 最 低", "No.1"]) expect(commerceRestrictedPhrase(copy)).toBeTruthy();
        expect(commerceRestrictedPhrase("清爽日常穿搭")).toBeUndefined();
        expect(commerceRestrictedPhrase("Model No.10")).toBeUndefined();
    });
    test("detail modes pass promotional options without applying listing-only rules", () => {
        for (const imageType of ["single", "set", "detail"]) {
            const draft = {
                ...emptyEcommerceDraft(),
                platform: "tiktok",
                imageType,
                count: 1,
                creativeOptions: { textMode: "rich", copyTone: "brand", fontStyle: "editorial-serif", colorRhythm: "contrast", informationDensity: "detailed", layoutStyle: "feature-cards" } as const,
            };
            expect(commerceTextConstraint(draft)).toBe("platform");
            const promo = { ...draft, typeOptions: { purpose: "宣传图" } };
            expect(commerceAllowsText(promo)).toBe(true);
            const { prompt } = commercePlanningPayload(promo, 0);
            for (const value of ["宣传图", "丰富图文", "品牌叙事", "杂志宋衬线", "重点撞色", "详解丰富", "卖点模块"]) expect(prompt).toContain(value);
            expect(prompt).not.toContain("所有商品图不得外加文字");
            expect(commerceTextConstraint({ ...promo, imageType: "white" })).toBe("type");
            expect(commerceAllowsText({ ...promo, noText: true })).toBe(false);
        }
    });
});
