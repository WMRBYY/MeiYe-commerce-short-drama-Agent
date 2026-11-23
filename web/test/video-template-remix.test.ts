import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实视频编辑器正确回填素材元数据并隔离过期商品信息", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-template-remix.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("7 pass");
    expect(output).toContain("0 fail");
}, 20000);
