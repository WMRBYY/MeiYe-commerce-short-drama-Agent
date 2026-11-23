import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("剧本模特库的选择、上传、收藏及账号隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/script-model-library.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 60000);
