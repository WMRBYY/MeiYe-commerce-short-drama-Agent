import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("模板素材导入失败时阻断分析，成功完整传递素材与描述", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shop-template-import.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("12 pass");
    expect(output).toContain("0 fail");
}, 20000);
