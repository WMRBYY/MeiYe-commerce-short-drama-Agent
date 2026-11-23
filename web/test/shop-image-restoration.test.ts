import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("生图记录刷新、切换与工作台恢复回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-image-restoration.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("4 pass");
}, 35000);
