import { describe, expect, test } from "bun:test";

import { normalizeAdminLogicalModel, type AdminLogicalModel } from "../src/services/api/logical-models";
import { logicalModelCodePattern, normalizeLogicalModelCode } from "../src/lib/logical-model-code";

function legacyModel() {
    return {
        id: "model-1",
        code: "seedance",
        name: "Seedance",
        description: "",
        capability: "video",
        sortOrder: 0,
        pricePolicy: "channel",
        billingMode: "fixed_request",
        unitPriceMicrocredits: 0,
        inputPriceMicrocredits: 0,
        outputPriceMicrocredits: 0,
        cachedPriceMicrocredits: 0,
        capabilitySpec: { version: 1, capability: "video" },
        enabled: true,
        activeRevisionId: "revision-1",
        revisionVersion: 1,
        available: false,
    } as AdminLogicalModel;
}

describe("后台前台模型响应归一化", () => {
    test("兼容旧响应中缺失的集合字段", () => {
        const model = normalizeAdminLogicalModel(legacyModel());

        expect(model.routes).toEqual([]);
        expect(model.priceTiers).toEqual([]);
        expect(model.legacyModelIds).toEqual([]);
        expect(model.capabilityProfiles).toEqual([]);
        expect(model.defaultOptions).toEqual({});
    });

    test("保留当前响应中的线路和价格档", () => {
        const input = legacyModel();
        input.routes = [{ id: "route-1" } as AdminLogicalModel["routes"][number]];
        input.priceTiers = [{ selector: { resolution: "720p" } } as AdminLogicalModel["priceTiers"][number]];

        const model = normalizeAdminLogicalModel(input);

        expect(model.routes).toHaveLength(1);
        expect(model.priceTiers).toHaveLength(1);
    });
});

test("路由组代码会规范空格、大小写和常见连字符", () => {
    expect(normalizeLogicalModelCode("GPT -image-2.5")).toBe("gpt-image-2.5");
    expect(normalizeLogicalModelCode(" GPT Image 2.5 ")).toBe("gpt-image-2.5");
    expect(normalizeLogicalModelCode("GPT－image-2.5")).toBe("gpt-image-2.5");
    expect(logicalModelCodePattern.test(normalizeLogicalModelCode("GPT -image-2.5"))).toBe(true);
    expect(logicalModelCodePattern.test(normalizeLogicalModelCode("图片模型"))).toBe(false);
});
