import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("剧本模型切换、草稿恢复、全部类型与素材前置校验", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/script-model-lock.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 60000);
