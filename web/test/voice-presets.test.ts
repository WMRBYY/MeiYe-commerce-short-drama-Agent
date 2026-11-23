import { expect, test } from "bun:test";
import { VOICE_PRESETS, voicePresetDisabledReason, voicePresetFile, voicePresetFileName, voicePresetUrl } from "@/pages/ecommerce/video/voice-presets";

test("six distinct audio presets have stable URLs and readable reference names", () => {
    expect(VOICE_PRESETS).toHaveLength(6);
    expect(new Set(VOICE_PRESETS.map((v) => v.id)).size).toBe(6);
    for (const voice of VOICE_PRESETS) {
        expect(voicePresetUrl(voice)).toBe(`/audio/voice-presets/${voice.id}.mp3`);
        expect(voicePresetFileName(voice)).toContain(voice.name);
    }
});
test("the shipped samples are distinct real MP3 files and can be added as named uploads", async () => {
    const hashes = new Set<string>();
    const originalFetch = globalThis.fetch;
    try {
        for (const voice of VOICE_PRESETS) {
            const sample = Bun.file(new URL(`../public${voicePresetUrl(voice)}`, import.meta.url));
            const bytes = await sample.arrayBuffer();
            expect(bytes.byteLength).toBeGreaterThan(2000);
            hashes.add(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
            globalThis.fetch = (async () => new Response(bytes, { headers: { "content-type": "audio/mpeg" } })) as typeof fetch;
            const upload = await voicePresetFile(voice);
            expect(upload.name).toBe(voicePresetFileName(voice));
            expect(upload.size).toBe(bytes.byteLength);
            expect(upload.type).toBe("audio/mpeg");
        }
        expect(hashes.size).toBe(6);
        globalThis.fetch = (async () => new Response("<html>SPA fallback</html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
        await expect(voicePresetFile(VOICE_PRESETS[0])).rejects.toThrow("无效");
        globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
        await expect(voicePresetFile(VOICE_PRESETS[0])).rejects.toThrow("加载失败");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
test("adding presets respects duplicates, model capacity and the combined duration", () => {
    const voice = VOICE_PRESETS[0];
    expect(voicePresetDisabledReason(voice, 3, 15000, [])).toBe("");
    expect(voicePresetDisabledReason(voice, 0, 15000, [])).toContain("数量");
    expect(voicePresetDisabledReason(voice, 2, 1000, [])).toContain("时长");
    expect(voicePresetDisabledReason(voice, 2, 15000, [voicePresetFileName(voice)])).toContain("已添加");
});
