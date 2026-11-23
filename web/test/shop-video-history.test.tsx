import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频历史网格保留任务操作且不影响原工作台", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-video-history.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 60000);
