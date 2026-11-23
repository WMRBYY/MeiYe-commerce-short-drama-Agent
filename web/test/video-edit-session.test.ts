import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("video edit restoration and account isolation through the mounted production hook", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-edit-session.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}, 20000);
