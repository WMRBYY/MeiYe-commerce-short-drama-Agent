import { afterEach, expect, spyOn, test } from "bun:test";
import * as storage from "@/lib/localforage-storage";
import { deleteStoredCreationConversation, loadCreationConversations, patchStoredCreationConversation, saveCreationConversations, CREATION_HISTORY_SYNC_KEY } from "@/services/creation-conversation-store";

let restore = () => {};
afterEach(() => restore());

function disk() {
    const message = { id: "m", role: "assistant", status: "done", content: "saved" };
    const base = { id: "c", revision: 4, metadataRevision: 2, messages: [{ id: "m", revision: 3, data: message }] };
    const conflict = { id: "other", at: "saved", local: { id: "other", messages: [] } };
    const values = new Map<string, string>([[CREATION_HISTORY_SYNC_KEY, JSON.stringify({ version: 1, conversations: [{ id: "c", title: "before", messages: [message] }], bases: { c: base }, conflicts: [conflict], deleted: [], removedMessages: {} })]]);
    const mock = spyOn(storage, "localForageStorageForScope").mockReturnValue({
        getItem: async (key) => values.get(key) || null,
        setItem: async (key, value) => {
            values.set(key, value);
        },
        removeItem: async (key) => {
            values.delete(key);
        },
    });
    restore = () => mock.mockRestore();
    return { read: () => JSON.parse(values.get(CREATION_HISTORY_SYNC_KEY)!), base, conflict };
}

test("侧栏重命名和置顶更新新版缓存并保留云端修订与冲突副本", async () => {
    const fixture = disk();
    await patchStoredCreationConversation("c", { title: "renamed", pinned: true });
    expect((await loadCreationConversations())?.[0]).toMatchObject({ title: "renamed", pinned: true });
    expect(fixture.read().bases.c).toEqual(fixture.base);
    expect(fixture.read().conflicts).toEqual([fixture.conflict]);
});

test("侧栏删除保留同步墓碑，旧快照不能恢复已删除对话", async () => {
    const fixture = disk();
    const old = (await loadCreationConversations())!;
    await deleteStoredCreationConversation("c");
    await saveCreationConversations(old);
    expect(await loadCreationConversations()).toEqual([]);
    expect(fixture.read().deleted).toEqual(["c"]);
    expect(fixture.read().bases.c).toEqual(fixture.base);
});

test("离页删除消息保留服务器修订，旧快照不能复活消息", async () => {
    const fixture = disk();
    const old = (await loadCreationConversations())!;
    await saveCreationConversations([], [], ["m"]);
    await saveCreationConversations(old);
    expect((await loadCreationConversations())?.[0].messages).toEqual([]);
    expect(fixture.read().removedMessages.c).toEqual({ m: 3 });
});
