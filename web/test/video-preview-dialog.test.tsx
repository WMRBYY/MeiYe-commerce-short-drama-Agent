import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频预览弹窗隔离空格快捷键并在关闭时卸载媒体", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-preview-dialog.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 60000);
