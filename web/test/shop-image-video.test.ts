import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频创作入口按一次性模板导入并保留模式草稿", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-image-video.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("9 pass");
    expect(output).toContain("0 fail");
}, 20000);
