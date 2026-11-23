import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDraft } from "../src/stores/use-inspiration-store";
import { playableInspirationVideoUrl } from "../src/lib/inspirations/catalog";

const publicRoot = join(import.meta.dir, "../public/inspirations");
const seedance = JSON.parse(readFileSync(join(publicRoot, "seedance.json"), "utf8"));
const gallery = JSON.parse(readFileSync(join(publicRoot, "gallery-pool.json"), "utf8"));

test("restored gallery videos use the same signed CDN route as their source case", () => {
    const byId = new Map(seedance.entries.map((entry: { id: string; videoUrl?: string }) => [entry.id, entry.videoUrl]));
    const galleryVideos = gallery.entries.filter((entry: { mode: string }) => entry.mode === "video");
    expect(galleryVideos.length).toBe(89);
    for (const entry of galleryVideos) {
        expect(entry.videoUrl).toBe(byId.get(entry.id));
        expect(entry.videoUrl).toMatch(/^\/api\/public\/inspirations\/videos\/[0-9a-f]{64}$/);
    }
});

test("cases without an upstream video URL remain explicitly unavailable", () => {
    const videos = seedance.entries.filter((entry: { mode: string }) => entry.mode === "video");
    expect(videos.length).toBe(767);
    expect(videos.filter((entry: { videoUrl?: string }) => !entry.videoUrl).map((entry: { id: string }) => entry.id)).toEqual(["seedance:real-case-06-aimikoda"]);
});

test("Seedance cases with source media can play while missing media stays unavailable", () => {
    const videos = seedance.entries.filter((entry: { mode: string }) => entry.mode === "video");
    const playable = videos.filter((entry: { videoUrl?: string }) => Boolean(playableInspirationVideoUrl(entry)));
    expect(playable.length).toBe(766);
    expect(playableInspirationVideoUrl(playable[0])).toBe(playable[0].videoUrl);
    expect(playableInspirationVideoUrl(videos.find((entry: { id: string }) => entry.id === "seedance:real-case-06-aimikoda"))).toBeUndefined();
});

test("custom inspiration keeps its playable video URL through draft normalization", () => {
    const draft = { title: "My video", description: "", image: "/cover.webp", videoUrl: "/welcome/charge/sequence.mp4", mode: "video", prompt: "A video" };
    expect(normalizeDraft(draft).videoUrl).toBe(draft.videoUrl);
    expect(() => normalizeDraft({ ...draft, videoUrl: "javascript:alert(1)" })).toThrow("视频地址必须是 HTTPS 或站内路径");
});
