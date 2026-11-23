import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("详情图报价与可拖拽作品栏的专项回归通过", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-detail-layout-pricing.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 30000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("4 pass");
    expect(output).toContain("0 fail");
}, 40000);
