import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import localforage from "localforage";
import { emptyEcommerceDraft, type EcommerceExecutionRequest, type EcommerceProject } from "../src/services/api/ecommerce";
import { http, ApiError } from "../src/services/api/request";
import { setActiveUserScope } from "../src/lib/user-scope";
import { sendDetailRequest, resumeDetailRequests } from "../src/pages/shop/detail-outbox";

const dom = new Window({ url: "http://localhost/" });
const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
const storage = new Map<string, string>();
const originals = { getItem: localforage.getItem, setItem: localforage.setItem, removeItem: localforage.removeItem, keys: localforage.keys };
localforage.getItem = (async (key: string) => storage.get(key) || null) as typeof localforage.getItem;
localforage.setItem = (async (key: string, value: string) => {
    storage.set(key, value);
    return value;
}) as typeof localforage.setItem;
localforage.removeItem = async (key: string) => {
    storage.delete(key);
};
localforage.keys = async () => [...storage.keys()];
let calls: Array<{ path: string; input: EcommerceExecutionRequest }> = [];
let disconnected = true;
let rejection: ApiError | undefined;
const post = spyOn(http, "post").mockImplementation(async (path, input) => {
    calls.push({ path, input: input as EcommerceExecutionRequest });
    if (rejection) throw rejection;
    if (disconnected) throw new ApiError("连接中断", { retryable: true });
    return { id: `project-${(input as EcommerceExecutionRequest).id}`, userId: "owner" } as never;
});
beforeEach(() => {
    storage.clear();
    calls = [];
    disconnected = true;
    rejection = undefined;
    setActiveUserScope("owner");
});
afterAll(() => {
    post.mockRestore();
    Object.assign(localforage, originals);
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    dom.happyDOM.abort();
});
const request = (id: string): EcommerceExecutionRequest => ({
    id,
    draft: emptyEcommerceDraft(),
    prompt: "商品策划",
    inputSignature: "signature",
    referenceImages: [],
    image: { kind: "image", model: "test", channelId: "channel", parameters: {}, references: [] },
});

test("断网提交后刷新重连复用相同编号和完整输入", async () => {
    const input = request("request-one");
    await expect(sendDetailRequest("owner", input)).rejects.toThrow("连接中断");
    expect(storage.size).toBe(1);
    disconnected = false;
    const restored: EcommerceProject[] = [];
    await resumeDetailRequests("owner", (project) => restored.push(project));
    expect(calls).toHaveLength(2);
    expect(calls[1].input).toEqual(input);
    expect(restored[0].id).toBe("project-request-one");
    expect(storage.size).toBe(0);
});
test("并发保存多个请求不会互相覆盖恢复记录", async () => {
    await Promise.allSettled([sendDetailRequest("owner", request("request-two")), sendDetailRequest("owner", request("request-three"))]);
    disconnected = false;
    const restored: string[] = [];
    await resumeDetailRequests("owner", (project) => restored.push(project.id));
    expect(restored.sort()).toEqual(["project-request-three", "project-request-two"]);
});
test("切换账号不提交原账号请求，切回后仍能恢复", async () => {
    await Promise.allSettled([sendDetailRequest("owner", request("request-four"))]);
    disconnected = false;
    setActiveUserScope("other");
    await resumeDetailRequests("owner", () => {
        throw new Error("串号");
    });
    expect(calls).toHaveLength(1);
    setActiveUserScope("owner");
    await resumeDetailRequests("owner", () => undefined);
    expect(calls).toHaveLength(2);
});
test("批量请求走同一电商后台，坏记录不妨碍其他请求恢复", async () => {
    storage.set("shop-detail-request:broken:user:owner", "{");
    const batch = { id: "batch-one", kind: "shop-edit" as const, title: "批量生图", clientState: [], jobs: [] };
    await Promise.allSettled([sendDetailRequest("owner", batch)]);
    disconnected = false;
    await resumeDetailRequests("owner", () => undefined);
    expect(calls.at(-1)?.path).toBe("/ecommerce/executions/batch");
});

for (const status of [401, 408, 429]) {
    test(`HTTP ${status} 保留受理请求，登录恢复或重连后仍用原编号`, async () => {
        disconnected = false;
        rejection = new ApiError("临时无法受理", { status });
        const input = request(`temporary-${status}`);
        await expect(sendDetailRequest("owner", input)).rejects.toThrow("临时无法受理");
        expect(storage.size).toBe(1);
        rejection = undefined;
        const restored: string[] = [];
        await resumeDetailRequests("owner", (project) => restored.push(project.id));
        expect(calls[1].input).toEqual(input);
        expect(restored).toEqual([`project-temporary-${status}`]);
        expect(storage.size).toBe(0);
    });
}

test("明确的参数拒绝不在后台反复提交", async () => {
    disconnected = false;
    rejection = new ApiError("参数不合法", { status: 422 });
    await expect(sendDetailRequest("owner", request("invalid-request"))).rejects.toThrow("参数不合法");
    await resumeDetailRequests("owner", () => undefined);
    expect(storage.size).toBe(0);
    expect(calls).toHaveLength(1);
});
