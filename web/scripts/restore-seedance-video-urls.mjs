import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = join(webRoot, "public/inspirations/seedance.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
if (!/^[a-f0-9]{40}$/.test(catalog.revision) || !Array.isArray(catalog.entries)) throw new Error("Seedance catalog revision or entries invalid");
const sourceURL = `https://raw.githubusercontent.com/LearnPrompt/awesome-seedance/${catalog.revision}/data/cases.json`;
const sourceFile = process.argv[2];
const source = sourceFile
    ? JSON.parse(readFileSync(sourceFile, "utf8"))
    : await (async () => {
        const response = await fetch(sourceURL, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Pinned Seedance source HTTP ${response.status}`);
        return response.json();
    })();
const sourceCases = Array.isArray(source) ? source : source.cases;
if (!Array.isArray(sourceCases)) throw new Error("Pinned Seedance source has no cases");
const bySlug = new Map(sourceCases.map((item) => [item.slug, item]));
function addVideoURLsPreservingCatalog(path, additions) {
    if (!additions.size) return;
    let currentId = "";
    const lines = [];
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const id = line.match(/^\s+"id": "([^"]+)",?$/);
        if (id) currentId = id[1];
        lines.push(line);
        const image = line.match(/^(\s+)"image": /);
        if (image && additions.has(currentId)) lines.push(`${image[1]}"videoUrl": ${JSON.stringify(additions.get(currentId))},`);
    }
    writeFileSync(path, lines.join("\n"));
}
const candidates = catalog.entries.flatMap((entry) => {
    if (entry.videoUrl) return [];
    const sourceItem = bySlug.get(entry.id?.replace(/^seedance:/, ""));
    const url = sourceItem?.mediaUrl;
    if (typeof url !== "string" || !/^https:\/\/media\.goodcase\.ai\/[^?#]+\.mp4(?:[?#]|$)/i.test(url)) return [];
    return [{ entry, url }];
});
let cursor = 0;
const valid = new Set();
const failures = [];
async function probeVideoURL(url) {
    if (process.argv.includes("--curl")) {
        const { stdout } = await execFileAsync(process.platform === "win32" ? "curl.exe" : "curl", ["-fsSI", "--max-time", "15", "-o", process.platform === "win32" ? "NUL" : "/dev/null", "-w", "%{http_code} %{content_type}", url], { timeout: 18_000 });
        if (!/^200 video\//i.test(stdout.trim())) throw new Error(stdout.trim());
        return;
    }
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(12_000) });
    const mediaType = response.headers.get("content-type") || "";
    if (!response.ok || !mediaType.toLowerCase().startsWith("video/")) throw new Error(`HTTP ${response.status}, ${mediaType}`);
}
async function worker() {
    while (cursor < candidates.length) {
        const index = cursor++;
        const { entry, url } = candidates[index];
        try {
            await probeVideoURL(url);
            valid.add(entry.id);
        } catch (error) {
            failures.push({ id: entry.id, reason: String(error) });
        }
    }
}
await Promise.all(Array.from({ length: 12 }, () => worker()));
for (const { entry, url } of candidates) if (valid.has(entry.id)) entry.videoUrl = url;
addVideoURLsPreservingCatalog(catalogPath, new Map(candidates.filter(({ entry }) => valid.has(entry.id)).map(({ entry, url }) => [entry.id, url])));
const galleryPath = join(webRoot, "public/inspirations/gallery-pool.json");
const gallery = JSON.parse(readFileSync(galleryPath, "utf8"));
const restoredByID = new Map(catalog.entries.filter((entry) => entry.videoUrl).map((entry) => [entry.id, entry.videoUrl]));
let galleryRestored = 0;
const galleryAdditions = new Map();
for (const entry of gallery.entries || []) {
    if (entry.videoUrl || !restoredByID.has(entry.id)) continue;
    entry.videoUrl = restoredByID.get(entry.id);
    galleryAdditions.set(entry.id, entry.videoUrl);
    galleryRestored++;
}
addVideoURLsPreservingCatalog(galleryPath, galleryAdditions);
console.log(JSON.stringify({ revision: catalog.revision, candidates: candidates.length, restored: valid.size, galleryRestored, unavailable: failures.length, failures: failures.slice(0, 20) }));
