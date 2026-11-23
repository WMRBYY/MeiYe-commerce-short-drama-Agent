import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeDramaEpisodeDetail, normalizeDramaSummary } from "./drama";

test("normalizes legacy null arrays before the studio renders them", () => {
    const detail = normalizeDramaEpisodeDetail({
        episode: {} as never,
        shots: null as never,
        segments: [
            {
                request: { references: null as never } as never,
                shotIds: null as never,
            } as never,
        ],
        chapters: null as never,
        jobs: null as never,
        dialogueCheck: { missing: null as never } as never,
    });

    assert.deepEqual(detail.shots, []);
    assert.deepEqual(detail.chapters, []);
    assert.deepEqual(detail.jobs, []);
    assert.deepEqual(detail.segments[0].shotIds, []);
    assert.deepEqual(detail.segments[0].request.references, []);
    assert.deepEqual(detail.dialogueCheck?.missing, []);
});

test("normalizes legacy null summary collections", () => {
    const summary = normalizeDramaSummary({ episodes: null, inbox: null, jobCounts: null } as never);

    assert.deepEqual(summary.episodes, []);
    assert.deepEqual(summary.inbox, []);
    assert.deepEqual(summary.jobCounts, {});
});
