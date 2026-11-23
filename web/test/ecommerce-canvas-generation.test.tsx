import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasLayer, EcommerceCanvasDraftRequest, EcommerceCanvasGeneration, EcommerceCanvasGenerationRequest, EcommerceCanvasLayerCommandRequest, EcommerceCanvasReferenceRequest } from "../src/pages/ecommerce/result-canvas";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { EcommerceResultCanvas } = await import("../src/pages/ecommerce/result-canvas");
const { cloneWorkflowNodes } = await import("../src/pages/shop/shop-canvas-workflows");

test("workflow copies isolate identifiers, configs and video jobs", () => {
    const source: CanvasLayer[] = [
        { id: "input", type: "text", text: "商品事实", x: 0, y: 0 },
        { id: "video", type: "draft", draftKind: "video-replace", x: 400, y: 0, inputs: ["input", "missing"], videoProjectId: "old-job", config: { video: { resourceId: "reference", projectId: "owned-project" }, notes: "保留衣服" } },
    ];
    const copied = cloneWorkflowNodes(source, true);
    expect(copied[0].id).not.toBe(source[0].id);
    expect(copied[1].inputs).toEqual([copied[0].id]);
    expect(copied[0].groupId).toBe(copied[1].groupId);
    expect(copied[1].videoProjectId).toBeUndefined();
    expect((copied[1].config as { video: { projectId?: string } }).video.projectId).toBeUndefined();
    expect((source[1].config as { video: { projectId: string } }).video.projectId).toBe("owned-project");
    copied[0].text = "独立修改";
    expect(source[0].text).toBe("商品事实");
});

test("context text creation is immediate and stale external selection does not clear it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selection = { ids: [], nonce: 123 };
    let snapshot: CanvasLayer[] = [];
    const render = (create: boolean) =>
        root.render(
            <EcommerceResultCanvas
                storageKey="immediate-text-user"
                graphEnabled
                count={0}
                ratio="1:1"
                actions={null}
                selectLayersRequest={selection}
                onSnapshotChange={(nodes) => {
                    snapshot = nodes;
                }}
                toolRequest={create ? { tool: "text", nonce: 124, text: "新商品文案", position: { x: 800, y: 400 } } : undefined}
            >
                {null}
            </EcommerceResultCanvas>,
        );
    try {
        await act(async () => render(false));
        await act(async () => render(true));
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].text).toBe("新商品文案");
        expect(host.querySelector("[data-node-id].is-selected")).toBeTruthy();
        expect(host.querySelector("textarea")?.value).toBe("新商品文案");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("graph multi-selection can group, duplicate internal connections and delete without dangling edges", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let snapshot: CanvasLayer[] = [];
    const receive = (nodes: CanvasLayer[]) => {
        snapshot = nodes;
    };
    const workflow = {
        nonce: 10,
        nodes: [
            { id: "copy", type: "text" as const, text: "商品文案", x: 0, y: 0 },
            { id: "draft", type: "draft" as const, draftKind: "chat", x: 400, y: 0, inputs: ["copy"] },
        ],
    };
    const render = (command?: EcommerceCanvasLayerCommandRequest, ids: string[] = []) =>
        root.render(
            <EcommerceResultCanvas
                storageKey="graph-regression-user"
                count={0}
                ratio="1:1"
                actions={null}
                graphEnabled
                workflowRequest={workflow}
                onSnapshotChange={receive}
                selectLayersRequest={{ ids, nonce: command?.nonce || 10 }}
                layerCommandRequest={command}
            >
                {null}
            </EcommerceResultCanvas>,
        );
    try {
        await act(async () => render());
        const ids = snapshot.map((n) => n.id);
        expect(ids).toHaveLength(2);
        await act(async () => render({ action: "group", ids, nonce: 11 }, ids));
        const group = snapshot[0].groupId;
        expect(group).toBeTruthy();
        expect(snapshot[1].groupId).toBe(group);
        await act(async () => render({ action: "duplicate", ids, nonce: 12 }, ids));
        expect(snapshot).toHaveLength(4);
        const clones = snapshot.filter((n) => !ids.includes(n.id));
        expect(clones[1].inputs).toEqual([clones[0].id]);
        expect(clones[0].groupId).not.toBe(group);
        expect(clones[1].groupId).toBe(clones[0].groupId);
        await act(async () => render({ action: "delete", ids: [clones[0].id], nonce: 13 }));
        expect(snapshot.find((n) => n.id === clones[1].id)?.inputs).toEqual([]);
        expect(snapshot.find((n) => n.id === ids[1])?.inputs).toEqual([ids[0]]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
test("grouped nodes move independently while the group handle moves all members with undo and redo", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let snapshot: CanvasLayer[] = [];
    let selected: string[] = [];
    const workflow = {
        nonce: 200,
        nodes: [
            { id: "input", type: "text" as const, text: "商品信息", x: 0, y: 0 },
            { id: "output", type: "draft" as const, draftKind: "image", x: 400, y: 0, inputs: ["input"] },
        ],
    };
    const render = (historyRequest?: { action: "undo" | "redo"; nonce: number }) =>
        root.render(
            <EcommerceResultCanvas
                storageKey="group-drag-regression"
                count={0}
                ratio="1:1"
                actions={null}
                graphEnabled
                workflowRequest={workflow}
                historyRequest={historyRequest}
                onSnapshotChange={(nodes) => {
                    snapshot = nodes;
                }}
                onSelectLayers={(ids) => {
                    selected = ids;
                }}
            >
                {null}
            </EcommerceResultCanvas>,
        );
    const pointer = async (target: Element, type: string, x: number, y: number) => {
        Object.assign(target, { setPointerCapture: () => {} });
        await act(async () => target.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y, ctrlKey: true })));
    };
    try {
        await act(async () => render());
        const before = structuredClone(snapshot);
        const node = host.querySelector(`[data-node-id="${before[0].id}"]`)!;
        await pointer(node, "pointerdown", 100, 100);
        await pointer(node, "pointermove", 180, 140);
        await pointer(node, "pointerup", 180, 140);
        expect(snapshot[0].x).toBe(before[0].x + 80);
        expect(snapshot[0].y).toBe(before[0].y + 40);
        expect(snapshot[1]).toEqual(before[1]);
        expect(snapshot[0].groupId).toBe(before[0].groupId);
        expect(selected).toEqual([before[0].id]);
        const individual = structuredClone(snapshot);
        await act(async () => render({ action: "undo", nonce: 201 }));
        expect(snapshot).toEqual(before);
        await act(async () => render({ action: "redo", nonce: 202 }));
        expect(snapshot).toEqual(individual);

        const handle = host.querySelector(".sp-node-group-handle")!;
        await pointer(handle, "pointerdown", 100, 100);
        await pointer(handle, "pointermove", 140, 180);
        await pointer(handle, "pointerup", 140, 180);
        for (let index = 0; index < snapshot.length; index++) {
            expect(snapshot[index]).toEqual({ ...individual[index], x: individual[index].x + 40, y: individual[index].y + 80 });
        }
        expect(selected).toEqual(before.map((node) => node.id));
        const together = structuredClone(snapshot);
        await act(async () => render({ action: "undo", nonce: 203 }));
        expect(snapshot).toEqual(individual);
        await act(async () => render({ action: "redo", nonce: 204 }));
        expect(snapshot).toEqual(together);
        await pointer(handle, "pointerdown", 100, 100);
        await pointer(handle, "pointerup", 100, 100);
        expect(selected).toEqual(before.map((node) => node.id));
        expect(host.querySelector('[aria-label="节点生成配置"]')).toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

test("generated canvas node retains its place when its task finishes and after remount", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    let root = createRoot(host);
    const request = { keys: ["e:task-1"], nonce: 1 };
    const running = [{ key: "e:task-1", status: "running" as const, resourceId: "", label: "商品图片", stage: "排队中" }];
    const done = [{ ...running[0], status: "done" as const, resourceId: "resource-1" }];
    const view = (items: typeof running | typeof done, generationRequest?: typeof request) => (
        <EcommerceResultCanvas storageKey="test-user" count={0} ratio="1:1" actions={null} generations={items} generationRequest={generationRequest}>
            {null}
        </EcommerceResultCanvas>
    );
    try {
        await act(async () => root.render(view(running, request)));
        const node = host.querySelector<HTMLElement>("[data-node-id]");
        expect(node?.textContent).toContain("排队中");
        expect(node?.querySelector(".sk-creating")).not.toBeNull();
        const id = node?.dataset.nodeId;
        await act(async () => root.render(view(done, request)));
        expect(host.querySelector("[data-node-id]")?.getAttribute("data-node-id")).toBe(id);
        expect(host.querySelector("[data-node-id] img")?.getAttribute("alt")).toBe("商品图片");
        expect(host.querySelector(".sk-creating")).toBeNull();
        await act(async () => root.unmount());
        root = createRoot(host);
        await act(async () => root.render(view(done)));
        expect(host.querySelector("[data-node-id]")?.getAttribute("data-node-id")).toBe(id);
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(1);
        await act(async () => root.render(view([])));
        expect(host.querySelector("[data-node-id] img")).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("failed image generation stops the shared animation and keeps the error in place", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const request = { keys: ["e:failed-task"], nonce: 1 };
    const view = (failed: boolean) => (
        <EcommerceResultCanvas
            storageKey="failed-animation-user"
            count={0}
            ratio="1:1"
            actions={null}
            generationRequest={request}
            generations={[{ key: "e:failed-task", status: failed ? "failed" : "running", resourceId: "", label: "商品图片", stage: "生成中", progress: 42, error: "生成失败，请重试" }]}
        >
            {null}
        </EcommerceResultCanvas>
    );
    try {
        await act(async () => root.render(view(false)));
        const id = host.querySelector("[data-node-id]")?.getAttribute("data-node-id");
        expect(host.querySelector(".sk-creating")?.textContent).toContain("42%");
        await act(async () => root.render(view(true)));
        expect(host.querySelector(".sk-creating")).toBeNull();
        expect(host.querySelector("[role=alert]")?.textContent).toContain("生成失败，请重试");
        expect(host.querySelector("[data-node-id]")?.getAttribute("data-node-id")).toBe(id);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("video nodes use the shared animation only while generating", async () => {
    const api = await import("../src/services/api/video-replication");
    const poll = spyOn(api, "getVideoReplicationProject").mockImplementation(async () => {
        throw new Error("offline test");
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const draft = { kind: "video-replace", label: "视频", nonce: 1 };
    const view = (updateNodeRequest?: { id: string; patch: Partial<CanvasLayer>; nonce: number }) => (
        <EcommerceResultCanvas storageKey="video-animation-user" count={0} ratio="1:1" actions={null} draftRequest={draft} updateNodeRequest={updateNodeRequest}>
            {null}
        </EcommerceResultCanvas>
    );
    try {
        await act(async () => root.render(view()));
        expect(host.querySelector(".sk-creating")).toBeNull();
        const id = host.querySelector<HTMLElement>("[data-node-id]")!.dataset.nodeId!;
        await act(async () => root.render(view({ id, patch: { videoProjectId: "video-task", videoStage: "生成视频中" }, nonce: 2 })));
        expect(host.querySelector(".sk-creating")?.textContent).toContain("生成视频中");
        await act(async () => root.render(view({ id, patch: { videoFailed: true, videoStage: "生成失败，请重试" }, nonce: 3 })));
        expect(host.querySelector(".sk-creating")).toBeNull();
        expect(host.querySelector("[role=alert]")?.textContent).toContain("生成失败，请重试");
        await act(async () => root.render(view({ id, patch: { type: "video", resourceId: "video-result" }, nonce: 4 })));
        expect(host.querySelector(".sk-creating")).toBeNull();
        expect(host.querySelector("video")?.getAttribute("src")).toContain("video-result");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        poll.mockRestore();
    }
});

test("a configured draft becomes the first generation without replacing its node identity", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const openCalls: string[] = [];
    const draftRequest = { kind: "pose", label: "姿势参考", nonce: 2 };
    try {
        await act(async () =>
            root.render(
                <EcommerceResultCanvas storageKey="draft-user" count={0} ratio="1:1" actions={null} draftRequest={draftRequest} onOpenDraft={(id) => openCalls.push(id)}>
                    {null}
                </EcommerceResultCanvas>,
            ),
        );
        const node = host.querySelector<HTMLElement>("[data-node-id]")!;
        const id = node.dataset.nodeId!;
        expect(node.textContent).toContain("姿势参考");
        await act(async () => node.querySelector<HTMLButtonElement>("button")!.click());
        expect(openCalls).toEqual([id]);
        await act(async () =>
            root.render(
                <EcommerceResultCanvas
                    storageKey="draft-user"
                    count={0}
                    ratio="1:1"
                    actions={null}
                    draftRequest={draftRequest}
                    generationRequest={{ keys: ["e:first", "e:second"], targetId: id, nonce: 3 }}
                    generations={[{ key: "e:first", status: "running", resourceId: "", label: "姿势参考", stage: "排队中" }]}
                >
                    {null}
                </EcommerceResultCanvas>,
            ),
        );
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2);
        expect(host.querySelector(`[data-node-id="${id}"]`)?.textContent).toContain("排队中");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("reference cards survive generation and a new run from a completed node has independent input edges", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let snapshot: CanvasLayer[] = [];
    const draftRequest = { kind: "chat", label: "对话生图", nonce: 302 };
    const render = (referenceRequest?: EcommerceCanvasReferenceRequest, generationRequest?: EcommerceCanvasGenerationRequest, generations?: EcommerceCanvasGeneration[]) =>
        root.render(
            <EcommerceResultCanvas
                storageKey="reference-cards-generation"
                count={0}
                ratio="1:1"
                actions={null}
                graphEnabled
                draftRequest={draftRequest}
                referenceRequest={referenceRequest}
                generationRequest={generationRequest}
                generations={generations}
                onSnapshotChange={(nodes) => {
                    snapshot = nodes;
                }}
            >
                {null}
            </EcommerceResultCanvas>,
        );
    try {
        await act(async () => render());
        const originalId = snapshot[0].id;
        const references = [
            { kind: "image" as const, resourceId: "reference-product", name: "商品主体" },
            { kind: "image" as const, resourceId: "reference-scene", name: "场景" },
        ];
        await act(async () => render({ nodeId: originalId, references, nonce: 303 }));
        const sourceNodes = snapshot.filter((node) => node.generatedReference);
        const sourceIds = sourceNodes.map((node) => node.id);
        expect(sourceNodes.map((node) => [node.type, node.text])).toEqual([
            ["image", "商品主体"],
            ["image", "场景"],
        ]);
        expect(sourceNodes.every((node) => node.x < snapshot[0].x)).toBe(true);
        expect(new Set(sourceNodes.map((node) => node.y)).size).toBe(2);
        expect(snapshot[0]).toMatchObject({ inputs: sourceIds, managedInputIds: sourceIds });
        expect(host.querySelectorAll(".sp-connection-line:not(.is-preview)")).toHaveLength(2);

        await act(async () => render(undefined, { keys: ["e:original", "e:sibling"], targetId: originalId, nonce: 304, references }, [{ key: "e:original", status: "done", resourceId: "rendered", label: "成片" }]));
        expect(snapshot.find((node) => node.id === originalId)).toMatchObject({ type: "generation", resourceId: "rendered", inputs: sourceIds });
        expect(snapshot.find((node) => node.generationKey === "e:sibling")?.inputs).toEqual(sourceIds);
        expect(snapshot.filter((node) => node.generatedReference)).toHaveLength(2);
        const completed = snapshot.find((node) => node.id === originalId);

        const audio = { kind: "audio" as const, resourceId: "new-audio", name: "参考声音" };
        const newRun = { keys: ["e:new"], targetId: originalId, nonce: 305, references: [audio] };
        await act(async () => render(undefined, newRun));
        const audioNode = snapshot.find((node) => node.resourceId === "new-audio");
        const generated = snapshot.find((node) => node.generationKey === "e:new");
        expect(audioNode).toMatchObject({ type: "audio", generatedReference: true, text: "参考声音" });
        expect(host.querySelector("audio")?.getAttribute("src")).toContain("new-audio");
        expect(generated).toMatchObject({ inputs: [audioNode?.id] });
        expect(generated!.x).toBeGreaterThan(completed!.x);
        expect(snapshot.find((node) => node.id === originalId)).toEqual(completed);
        const unchanged = snapshot;
        await act(async () => render(undefined, { ...newRun, nonce: 306 }));
        expect(snapshot).toBe(unchanged);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("a newly observed completed result resolves its own node before applying a reference request", async () => {
    const key = "observation-reference-race";
    localStorage.setItem(
        `ecommerce-canvas:${key}`,
        JSON.stringify([
            { id: "source", type: "generation", generationKey: "e:before-save", x: 0, y: 0 },
            { id: "target", type: "draft", draftKind: "chat", x: 330, y: 0 },
        ]),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let snapshot: CanvasLayer[] = [];
    try {
        await act(async () =>
            root.render(
                <EcommerceResultCanvas
                    storageKey={key}
                    count={0}
                    ratio="1:1"
                    actions={null}
                    graphEnabled
                    generations={[{ key: "e:before-save", status: "done", resourceId: "actual-output", label: "刚生成的图" }]}
                    referenceRequest={{ nodeId: "target", references: [{ nodeId: "source", resourceId: "actual-output", kind: "image" }], nonce: 1 }}
                    onSnapshotChange={(nodes) => {
                        snapshot = nodes;
                    }}
                >
                    {null}
                </EcommerceResultCanvas>,
            ),
        );
        expect(snapshot).toHaveLength(2);
        expect(snapshot[0]).toMatchObject({ id: "source", resourceId: "actual-output" });
        expect(snapshot[1]).toMatchObject({ inputs: ["source"], managedInputIds: ["source"] });
    } finally {
        await act(async () => root.unmount());
        host.remove();
        localStorage.removeItem(`ecommerce-canvas:${key}`);
    }
});

test("a completed video opens its inputs and a reused video draft does not inherit its task", async () => {
    const key = "reuse-completed-video";
    const normalVideoDraft = { prompt: "展示商品包装", ratio: "9:16", references: [] };
    const normalVideoLinks = JSON.stringify([["source", "video-source", null]]);
    localStorage.setItem(
        `ecommerce-canvas:${key}`,
        JSON.stringify([
            { id: "source", type: "video", resourceId: "video-source", x: 0, y: 0 },
            { id: "result", type: "video", resourceId: "video-output", draftKind: "product-video", videoTaskId: "original-task", normalVideoDraft, normalVideoLinks, inputs: ["source"], managedInputIds: ["source"], x: 410, y: 0 },
        ]),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let snapshot: CanvasLayer[] = [];
    const opened: Array<{ id: string; kind: string; layer?: CanvasLayer; sources?: string[] }> = [];
    const render = (draftRequest?: EcommerceCanvasDraftRequest) =>
        root.render(
            <EcommerceResultCanvas
                storageKey={key}
                count={0}
                ratio="1:1"
                actions={null}
                graphEnabled
                draftRequest={draftRequest}
                onOpenDraft={(id, kind, references, _config, layer) => opened.push({ id, kind, layer, sources: references?.map((ref) => ref.id) })}
                onSnapshotChange={(nodes) => {
                    snapshot = nodes;
                }}
            >
                {null}
            </EcommerceResultCanvas>,
        );
    const press = (target: Element, type: string) => act(async () => target.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: 100, clientY: 100 })));
    try {
        await act(async () => render());
        const rendered = host.querySelector('[data-node-id="result"]')!;
        Object.assign(rendered, { setPointerCapture: () => {} });
        const video = rendered.querySelector("video")!;
        await press(video, "pointerdown");
        await press(video, "pointerup");
        expect(opened[0]).toMatchObject({ id: "result", kind: "product-video", layer: { videoTaskId: "original-task" }, sources: ["source"] });
        const play = rendered.querySelector(".sp-video-controls button")!;
        await press(play, "pointerdown");
        await press(play, "pointerup");
        expect(opened).toHaveLength(1);
        await act(async () => render({ kind: "product-video", label: "视频生成", nonce: 410, reuse: { sourceId: "result", config: undefined } }));
        expect(snapshot[1]).toMatchObject({ id: "result", resourceId: "video-output", videoTaskId: "original-task" });
        expect(snapshot[2]).toMatchObject({ type: "draft", normalVideoDraft, normalVideoLinks, inputs: ["source"], managedInputIds: ["source"] });
        expect(snapshot[2].videoTaskId).toBeUndefined();
        expect(opened[1]).toMatchObject({ id: snapshot[2].id, kind: "product-video", layer: { normalVideoDraft }, sources: ["source"] });
    } finally {
        await act(async () => root.unmount());
        host.remove();
        localStorage.removeItem(`ecommerce-canvas:${key}`);
    }
});

test("running and completed nodes expose their submitted settings without treating a drag or cancelled press as inspection", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let snapshot: CanvasLayer[] = [];
    const inspected: CanvasLayer[] = [];
    const reopened: Array<{ id: string; config: unknown }> = [];
    const config = { image: { imageModel: "qa-model", notes: "保留商品纹理", ratio: "3:4", resolution: "2K" }, chat: { text: "", refs: [], count: 2 }, links: "[]" };
    const request = { keys: ["t:first:1", "t:first:2"], nonce: 201, submitted: { draftKind: "background", text: "换背景", config } };
    const task = { key: request.keys[0], label: "换背景", status: "running", resourceId: "", stage: "排队中" } satisfies EcommerceCanvasGeneration;
    const render = (item: EcommerceCanvasGeneration, reuse?: EcommerceCanvasDraftRequest) =>
        root.render(
            <EcommerceResultCanvas
                storageKey="inspect-generation"
                graphEnabled
                count={0}
                ratio="1:1"
                actions={null}
                generations={[item]}
                generationRequest={request}
                draftRequest={reuse}
                onSnapshotChange={(nodes) => {
                    snapshot = nodes;
                }}
                onInspectGeneration={(node) => inspected.push(node)}
                onOpenDraft={(id, _kind, _references, seed) => reopened.push({ id, config: seed })}
            >
                {null}
            </EcommerceResultCanvas>,
        );
    const pointer = async (target: Element, type: string, x = 200, y = 200) => {
        Object.assign(target, { setPointerCapture: () => {} });
        await act(async () => target.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y, ctrlKey: true })));
    };
    try {
        await act(async () => render(task));
        const nodeId = snapshot[0].id;
        const element = () => host.querySelector(`[data-node-id="${nodeId}"]`)!;
        await pointer(element(), "pointerdown");
        await pointer(element(), "pointermove", 260, 200);
        await pointer(element(), "pointermove", 200, 200);
        await pointer(element(), "pointerup");
        await pointer(element(), "pointerdown");
        await pointer(element(), "pointercancel");
        expect(inspected).toHaveLength(0);
        await pointer(element(), "pointerdown");
        await pointer(element(), "pointerup");
        expect(inspected[0]).toMatchObject({ id: nodeId, generationKey: request.keys[0], config });
        expect(snapshot[1]).toMatchObject({ generationKey: request.keys[1], draftKind: "background", config });

        const done = { ...task, status: "done" as const, resourceId: "generated-result" };
        await act(async () => render(done));
        await act(async () => element().dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
        expect(inspected[1]).toMatchObject({ id: nodeId, resourceId: "generated-result" });
        await act(async () => render(done, { kind: "background", label: "换背景", nonce: 202, reuse: { sourceId: nodeId, config } }));
        expect(snapshot[0]).toMatchObject({ id: nodeId, generationKey: request.keys[0], resourceId: "generated-result" });
        expect(snapshot[2]).toMatchObject({ type: "draft", draftKind: "background", config });
        expect(snapshot[2].generationKey).toBeUndefined();
        expect(reopened).toEqual([{ id: snapshot[2].id, config }]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
