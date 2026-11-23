import { afterEach, beforeEach, expect, test } from "bun:test";

import { apiClient } from "@/services/api/request";
import { addSkill, discoverGitHubSkills, installGitHubSkill, listAddedSkills } from "@/services/api/skills";

test("added Skills retries a transient backend proxy failure", async () => {
    const original = apiClient.request;
    let attempts = 0;
    apiClient.request = (async () => {
        attempts += 1;
        if (attempts === 1) {
            throw {
                isAxiosError: true,
                message: "Request failed with status code 502",
                response: { status: 502, data: "Bad Gateway", headers: {} },
            };
        }
        return { data: { code: 0, data: { skills: [] }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;

    try {
        await expect(listAddedSkills()).resolves.toEqual({ skills: [] });
        expect(attempts).toBe(2);
    } finally {
        apiClient.request = original;
    }
});

test("a pending skills response cannot replace the cache after installation", async () => {
    const original = apiClient.request;
    let resolveStale: ((value: unknown) => void) | undefined;
    const staleResponse = new Promise((resolve) => {
        resolveStale = resolve;
    });
    let reads = 0;
    const envelope = (skills: unknown[]) => ({ data: { code: 0, data: { skills }, msg: "ok" }, status: 200, headers: {} });
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        reads += 1;
        return reads === 1 ? staleResponse : envelope([{ skillId: "preset", isAdded: true }]);
    }) as typeof apiClient.request;

    try {
        await addSkill("preset"); // Invalidate a cache left by another reader.
        const pending = listAddedSkills();
        await addSkill("preset");
        const fresh = await listAddedSkills();
        resolveStale?.(envelope([]));
        await pending;
        expect(fresh.skills).toEqual([{ skillId: "preset", isAdded: true }]);
        expect((await listAddedSkills()).skills).toEqual(fresh.skills);
        expect(reads).toBe(2);
    } finally {
        resolveStale?.(envelope([]));
        apiClient.request = original;
    }
});

test("GitHub discovery forwards the repository scope and cancellation signal through the API envelope", async () => {
    const original = apiClient.request;
    const controller = new AbortController();
    const input = { url: "https://github.com/zenstory-ai/drama-skills", ref: "release/v2", subdir: "skills" };
    const discovered = { sourceUrl: input.url, sourceRef: input.ref, sourceCommit: "abc123", skills: [{ name: "short-drama", subdir: "skills/short-drama" }] };
    apiClient.request = (async (config) => {
        expect(config.method).toBe("post");
        expect(config.url).toBe("/skills/discover/github");
        expect(config.data).toEqual(input);
        expect(config.signal?.aborted).toBe(false);
        return { data: { code: 0, data: discovered, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    try {
        expect(await discoverGitHubSkills(input, controller.signal)).toEqual(discovered);
    } finally {
        apiClient.request = original;
    }
});

test("GitHub discovery cancellation is preserved instead of becoming an installation error", async () => {
    const original = apiClient.request;
    const controller = new AbortController();
    apiClient.request = (async (config) => {
        controller.abort();
        expect(config.signal?.aborted).toBe(true);
        throw { __CANCEL__: true };
    }) as typeof apiClient.request;
    try {
        await expect(discoverGitHubSkills({ url: "https://github.com/owner/repo" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    } finally {
        apiClient.request = original;
    }
});

test("GitHub installation preserves the selected directory and user settings", async () => {
    useUserStore.setState({ user: { ...skillUser, role: "admin" } });
    const original = apiClient.request;
    const input = { url: "https://github.com/zenstory-ai/drama-skills", ref: "main", subdir: "skills/short-drama-write", tag: "film", platformRootId: "short-drama", isPrivate: true, autoUpdate: false };
    apiClient.request = (async (config) => {
        expect(config.method).toBe("post");
        expect(config.url).toBe("/skills/install/github");
        expect(config.data).toEqual(input);
        return { data: { code: 0, data: { skill: { skillId: "installed" } }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    try {
        expect((await installGitHubSkill(input)).skill.skillId).toBe("installed");
    } finally {
        apiClient.request = original;
    }
});

import { useUserStore } from "@/stores/use-user-store";
const skillUser = { id: "skill-user", username: "member", displayName: "Member", role: "user" as const, status: "active" as const };
beforeEach(() => useUserStore.setState({ user: skillUser, hydrated: true }));
afterEach(() => useUserStore.setState({ user: null, hydrated: false }));
