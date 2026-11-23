import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("服务端流程在真实页面刷新与导航后恢复", () => {
    const result = Bun.spawnSync([process.execPath, "test", "--timeout", "10000", "--test-name-pattern", "后台流程恢复|方向分析计时恢复", "./test/fixtures/ecommerce-page-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 120000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("7 pass");
    expect(output).toContain("0 fail");
}, 120000);
