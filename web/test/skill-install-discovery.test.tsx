import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { GitHubSkillDiscovery } from "@/services/api/skills";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement,
    HTMLBodyElement: dom.HTMLBodyElement, HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot,
    Event: dom.Event, MouseEvent: dom.MouseEvent, KeyboardEvent: dom.KeyboardEvent,
    ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const { SkillInstallModal } = await import("@/pages/skills/skill-install-modal");
const originalRequest = apiClient.request;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
const repoURL = "https://github.com/zenstory-ai/drama-skills";
const envelope = (data: unknown) => ({ data: { code: 0, data, msg: "ok" }, status: 200, headers: {} });

afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    host = undefined;
    apiClient.request = originalRequest;
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function click(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.replace(/\s/g, "") === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
}

async function type(id: string, value: string) {
    const input = document.getElementById(id) as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

async function choose(id: string, label: string) {
    const input = document.getElementById(id)!;
    expect(input).not.toBeNull();
    await act(async () => input.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((item) => item.textContent === label);
    expect(option).toBeDefined();
    await act(async () => option!.click());
}

async function fixture(discover: (signal?: AbortSignal) => Promise<GitHubSkillDiscovery>) {
    const installs: unknown[] = [];
    let discoveries = 0;
    let installed = 0;
    apiClient.request = (async (config) => {
        if (config.url === "/skills/curation") return envelope({ enabled: true, revision: 1, categories: [], assignments: [], roots: [{ id: "drama", name: "短剧影视", enabled: true }] });
        if (config.url === "/skills/discover/github") {
            discoveries += 1;
            return envelope(await discover(config.signal as AbortSignal));
        }
        if (config.url === "/skills/install/github") {
            installs.push(config.data);
            return envelope({ skill: { skillId: "installed" } });
        }
        throw new Error(`Unexpected request: ${config.url}`);
    }) as typeof apiClient.request;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = async (open: boolean) => {
        await act(async () => root!.render(<App><SkillInstallModal open={open} onClose={() => {}} onInstalled={() => { installed += 1; }} onManualCreate={() => {}} /></App>));
    };
    await render(true);
    await click("GitHub");
    await type("url", repoURL);
    await choose("tag", "短剧影视");
    return { installs, render, discoveries: () => discoveries, installed: () => installed };
}

function discovery(subdirs = ["skills/short-drama", "skills/short-drama-write"]): GitHubSkillDiscovery {
    return { sourceUrl: repoURL, sourceRef: "main", sourceCommit: "abc123", skills: subdirs.map((subdir) => ({ subdir, name: subdir.split("/").at(-1) || "root" })) };
}

test("a skill collection waits for explicit selection and preserves privacy, category and sync settings", async () => {
    const view = await fixture(async () => discovery());
    await act(async () => (document.getElementById("is_public") as HTMLButtonElement).click());
    await act(async () => (document.getElementById("autoUpdate") as HTMLButtonElement).click());
    await click("安装技能");
    expect(view.installs).toEqual([]);
    expect(document.body.textContent).toContain("仓库包含 2 个技能");
    await click("安装技能");
    expect(view.discoveries()).toBe(1);
    expect(view.installs).toEqual([]);
    await choose("subdir", "skills/short-drama-write");
    await click("安装技能");
    expect(view.installs).toEqual([{ url: repoURL, ref: "main", subdir: "skills/short-drama-write", tag: "drama", platformRootId: "drama", isPrivate: true, autoUpdate: false }]);
    expect(view.installed()).toBe(1);
});

for (const subdir of ["", "skills/only-skill"]) {
    test(`a single ${subdir || "root"} skill installs automatically using the discovered branch`, async () => {
        const view = await fixture(async () => discovery([subdir]));
        await click("安装技能");
        expect(view.installs).toHaveLength(1);
        expect(view.installs[0]).toMatchObject({ url: repoURL, ref: "main", subdir: subdir || undefined, isPrivate: false, autoUpdate: true });
        expect(view.installed()).toBe(1);
    });
}

test("an explicit skill directory installs directly without scanning the repository", async () => {
    const view = await fixture(async () => { throw new Error("Discovery must not run"); });
    await type("subdir", "skills/short-drama-write");
    await type("ref", "stable");
    await click("安装技能");
    expect(view.discoveries()).toBe(0);
    expect(view.installs[0]).toMatchObject({ subdir: "skills/short-drama-write", ref: "stable" });
});

test("changing the URL cancels discovery and ignores a late result", async () => {
    let resolve: ((value: GitHubSkillDiscovery) => void) | undefined;
    let signal: AbortSignal | undefined;
    const view = await fixture((requestSignal) => {
        signal = requestSignal;
        return new Promise((done) => { resolve = done; });
    });
    await click("安装技能");
    expect(view.discoveries()).toBe(1);
    await type("url", "https://github.com/other/repo");
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve!(discovery(["skills/stale"])));
    expect(view.installs).toEqual([]);
    expect(document.getElementById("subdir")?.getAttribute("placeholder")).toBe("skills/ai-director");
    expect((document.getElementById("subdir") as HTMLInputElement).value).toBe("");
});

test("editing privacy while discovery waits cannot auto-install with the old public setting", async () => {
    let resolve: ((value: GitHubSkillDiscovery) => void) | undefined;
    let signal: AbortSignal | undefined;
    const view = await fixture((requestSignal) => {
        signal = requestSignal;
        return new Promise((done) => { resolve = done; });
    });
    await click("安装技能");
    await act(async () => (document.getElementById("is_public") as HTMLButtonElement).click());
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve!(discovery(["skills/only"])));
    expect(view.installs).toEqual([]);
    expect(document.getElementById("is_public")?.getAttribute("aria-checked")).toBe("false");
    await click("安装技能");
    await act(async () => resolve!(discovery(["skills/only"])));
    expect(view.installs[0]).toMatchObject({ isPrivate: true });
});

test("rapid repeated installation clicks start only one request", async () => {
    const view = await fixture(async () => discovery(["skills/only"]));
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "安装技能")!;
    await act(async () => { button.click(); button.click(); });
    expect(view.discoveries()).toBe(1);
    expect(view.installs).toHaveLength(1);
});

test("switching modes before validation completes cannot install the previous repository", async () => {
    const view = await fixture(async () => discovery(["skills/only"]));
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    await act(async () => {
        buttons.find((item) => item.textContent === "安装技能")!.click();
        buttons.find((item) => item.textContent === "Markdown")!.click();
    });
    expect(view.discoveries()).toBe(0);
    expect(view.installs).toEqual([]);
});

test("changing the ref, switching modes and reopening clear discovered directories", async () => {
    const view = await fixture(async () => discovery());
    await click("安装技能");
    await choose("subdir", "skills/short-drama-write");
    await type("ref", "next");
    expect((document.getElementById("subdir") as HTMLInputElement).value).toBe("");
    await click("安装技能");
    await choose("subdir", "skills/short-drama-write");
    await click("Markdown");
    await click("GitHub");
    expect((document.getElementById("subdir") as HTMLInputElement).value).toBe("");
    await click("安装技能");
    await view.render(false);
    await view.render(true);
    await click("GitHub");
    expect((document.getElementById("url") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("subdir") as HTMLInputElement).value).toBe("");
    expect(view.installs).toEqual([]);
});
