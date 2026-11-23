import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { SHOP_VIDEO_TEMPLATES } from "../src/pages/shop/shop-template-catalog";

const publicDir = resolve(import.meta.dir, "../public");

// Read the actual MP4 movie header: a label or source-page duration cannot prove
// that the delivered reference contains more than fifteen seconds of video.
function movieSeconds(buffer: Buffer, start = 0, end = buffer.length): number {
    for (let at = start; at + 8 <= end;) {
        const size = buffer.readUInt32BE(at);
        const type = buffer.toString("ascii", at + 4, at + 8);
        if (size < 8 || at + size > end) throw new Error("Invalid MP4 box");
        if (type === "moov") return movieSeconds(buffer, at + 8, at + size);
        if (type === "mvhd") {
            const offset = at + (buffer[at + 8] === 1 ? 28 : 20);
            const scale = buffer.readUInt32BE(offset);
            const duration = buffer[at + 8] === 1 ? Number(buffer.readBigUInt64BE(offset + 4)) : buffer.readUInt32BE(offset + 4);
            return duration / scale;
        }
        at += size;
    }
    throw new Error("Movie header missing");
}

test("long templates ship playable MP4 files whose duration matches the catalog", () => {
    const templates = SHOP_VIDEO_TEMPLATES.filter((template) => template.durationSeconds > 15);
    expect(templates.length).toBeGreaterThanOrEqual(6);
    for (const template of templates) {
        const seconds = movieSeconds(readFileSync(resolve(publicDir, `.${template.videoUrl}`)));
        expect(seconds).toBeGreaterThan(15);
        expect(Math.abs(seconds - template.durationSeconds)).toBeLessThan(0.25);
        expect(statSync(resolve(publicDir, `.${template.posterUrl}`)).size).toBeGreaterThan(1000);
    }
});

test("edited templates retain distinct source clips and a complete license trail", () => {
    const manifest: Array<{ id: string; clips: string[] }> = JSON.parse(readFileSync(resolve(publicDir, "shop-templates/edits/sources.json"), "utf8"));
    for (const template of SHOP_VIDEO_TEMPLATES.filter((item) => item.sourceClips)) {
        expect(template.license.label).toBe("CC BY 4.0");
        expect(template.license.author).toBe("RefVid (service-f8bed296.example.invalid)");
        expect(template.sourceClips!.length).toBeGreaterThanOrEqual(4);
        expect(new Set(template.sourceClips).size).toBe(template.sourceClips!.length);
        expect(manifest.find((item) => item.id === template.id)?.clips).toEqual(template.sourceClips);
        for (const clip of template.sourceClips!) expect(statSync(resolve(publicDir, `shop-templates/refvid/${clip}.mp4`)).size).toBeGreaterThan(1000);
    }
});
