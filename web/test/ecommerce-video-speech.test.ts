import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实商品视频 hook 的提交参数隔离商品改词、静音与精准人物", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/ecommerce-video-speech.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("4 pass");
    expect(output).toContain("0 fail");
}, 20000);
