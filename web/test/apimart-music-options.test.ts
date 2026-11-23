import { test } from "bun:test";
import assert from "node:assert/strict";
import { apimartMusicOptions, isAPIMartMusicProtocol } from "../src/lib/apimart-music-options";

test("APIMart music options preserve documented names and explicit false or zero", () => {
    assert.equal(isAPIMartMusicProtocol("apimart-suno"), true);
    assert.equal(isAPIMartMusicProtocol("openai-audio"), false);
    assert.deepEqual(apimartMusicOptions("apimart-suno", JSON.stringify({ custom: false, style_weight: 0, style: "  synthwave  ", voice: "alloy", invalid: { nested: true } })), {
        custom: false, style_weight: 0, style: "synthwave",
    });
    assert.deepEqual(apimartMusicOptions("apimart-flowmusic", JSON.stringify({ version: "lyria-3.5", lyrics: "  verse  ", length: 120, audio_format: "wav" })), {
        version: "lyria-3.5", lyrics: "verse", length: 120,
    });
    assert.deepEqual(apimartMusicOptions("apimart-flowmusic", "not-json"), {});
    assert.deepEqual(apimartMusicOptions("apimart-suno", JSON.stringify({ _protocol: "apimart-flowmusic", title: "old song" })), {});
});
