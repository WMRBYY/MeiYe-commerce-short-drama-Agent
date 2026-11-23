import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileMaterialMentions } from "@/pages/ecommerce/video/replication-mentions";

test("九类复刻提交与响应丢失恢复", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/replication-submission.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}, 20000);

test("素材重排后保留引用并检查已移除的图片", () => {
    const bindings = [{ token: "商品2", category: "product_image" as const, resourceId: "second" }];
    const assets = [{ id: "new-first", category: "product_image" as const, resourceId: "second" }];
    expect(compileMaterialMentions("按@商品2的包装", bindings, assets)).toBe("按@[node:new-first]的包装");
    expect(() => compileMaterialMentions("@商品2", bindings, [])).toThrow("已移除");
});
