import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("单张改图提交、幂等恢复和并发保存合同", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-detail-edit.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("6 pass");
    expect(output).toContain("0 fail");
}, 40000);
