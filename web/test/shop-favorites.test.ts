import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("收藏写入失败、连续点击与切换账号的回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-favorites.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("4 pass");
}, 35000);
