import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("详情图已完成结果恢复与未知状态回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-detail-restore.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("7 pass");
    expect(output).toContain("0 fail");
}, 40000);
