import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { HistorySyncCache } from "./creation-history-sync";

export const CREATION_CONVERSATIONS_KEY = "creation-conversations-v1";
export const CREATION_HISTORY_SYNC_KEY = "creation-history-sync-v1";
const CREATION_DELETED_CONVERSATIONS_KEY = "creation-conversations-deleted-v1";
const CREATION_DELETED_MESSAGES_KEY = "creation-messages-deleted-v1";
let fallbackSaveTail = Promise.resolve();

type PendingCreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: string;
    status?: string;
    taskIds?: string[];
    errorKind?: string;
};

export type StoredCreationConversation = {
    id: string;
    messages: PendingCreationMessage[];
};

export function updateCreationConversationSnapshot<T extends { id: string }>(conversations: T[], conversationId: string, updater: (conversation: T) => T) {
    return conversations.map((conversation) => (conversation.id === conversationId ? updater(conversation) : conversation));
}

// 对话、生成任务与素材是独立持久状态；删除历史记录不能在这里级联清理任务或资源。
export function removeCreationConversationSnapshot<T extends { id: string }>(conversations: T[], conversationId: string) {
    if (!conversationId) throw new Error("缺少要删除的创作对话 ID");
    const next = conversations.filter((conversation) => conversation.id !== conversationId);
    if (next.length === conversations.length) throw new Error("要删除的创作对话不存在");
    return next;
}

/**
 * 媒体消息的前端等待可能先于后端结束（轮询中断、长视频），消息曾被判失败但任务其实已经成功。
 * 失败态一并纳入恢复：任务成功就把结果补回消息；后端已确认失败（errorKind=task）的不再反复订阅。
 */
function isRecoverableCreationMessage(message: PendingCreationMessage) {
    if (message.role !== "assistant" || !message.taskIds?.length) return false;
    if (message.mode === "text") return message.status === "streaming" || message.status === "pending";
    return message.status === "pending" || (message.status === "error" && message.errorKind !== "task");
}

export function pendingCreationTaskKey(conversations: StoredCreationConversation[]) {
    return conversations.flatMap((conversation) => conversation.messages.flatMap((message) => (isRecoverableCreationMessage(message) ? [`${conversation.id}:${message.id}:${(message.taskIds || []).join(",")}`] : []))).join("|");
}

export function pendingCreationTaskIds(conversations: StoredCreationConversation[]) {
    const taskIds = conversations.flatMap((conversation) =>
        conversation.messages.flatMap((message) => {
            if (!isRecoverableCreationMessage(message)) return [];
            return message.taskIds || [];
        }),
    );
    return Array.from(new Set(taskIds));
}

export async function loadCreationConversations<T extends StoredCreationConversation>(scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const synced = await storage.getItem(CREATION_HISTORY_SYNC_KEY);
    if (synced) {
        const envelope = JSON.parse(synced);
        if (envelope.version !== 1 || !Array.isArray(envelope.conversations)) throw new Error("创作对话同步缓存无效");
        return envelope.conversations as T[];
    }
    const [value, deletedValue, deletedMessagesValue] = await Promise.all([storage.getItem(CREATION_CONVERSATIONS_KEY), storage.getItem(CREATION_DELETED_CONVERSATIONS_KEY), storage.getItem(CREATION_DELETED_MESSAGES_KEY)]);
    if (!value) return null;
    const deletedMessages = new Set(deletedMessagesValue ? (JSON.parse(deletedMessagesValue) as string[]) : []);
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("创作对话持久状态无效");
    }
    if (!Array.isArray(parsed)) throw new Error("创作对话持久状态无效");
    const deleted = new Set(deletedValue ? (JSON.parse(deletedValue) as string[]) : []);
    const visible = (parsed as T[]).filter((conversation) => !deleted.has(conversation.id));
    return deletedMessages.size ? visible.map((conversation) => ({ ...conversation, messages: conversation.messages.filter((message) => !deletedMessages.has(message.id)) })) : visible;
}

export function persistableCreationConversations<T extends StoredCreationConversation>(conversations: T[]) {
    return conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => {
            const candidate = message as PendingCreationMessage & { resultUrls?: unknown; resultStorageKeys?: unknown };
            if (!Array.isArray(candidate.resultStorageKeys) || candidate.resultStorageKeys.length === 0) return message;
            const { resultUrls: _transientResultUrls, ...persistedMessage } = candidate;
            return persistedMessage as typeof message;
        }),
    })) as T[];
}

export async function saveCreationConversations<T extends StoredCreationConversation>(conversations: T[], deletedIds: string[] = [], deletedMessageIds: string[] = [], scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const save = async () => {
        if (getActiveUserScope() !== scope) throw new Error("账号已切换，已停止保存旧账号创作历史");
        const [syncedValue, legacyValue, deletedValue, deletedMessagesValue] = await Promise.all([
            storage.getItem(CREATION_HISTORY_SYNC_KEY),
            storage.getItem(CREATION_CONVERSATIONS_KEY),
            storage.getItem(CREATION_DELETED_CONVERSATIONS_KEY),
            storage.getItem(CREATION_DELETED_MESSAGES_KEY),
        ]);
        const synced = syncedValue ? (JSON.parse(syncedValue) as HistorySyncCache) : null;
        if (synced && (synced.version !== 1 || !Array.isArray(synced.conversations) || !synced.bases || !Array.isArray(synced.deleted) || !Array.isArray(synced.conflicts))) throw new Error("创作历史同步缓存无效，原记录已保留");
        const currentValue = synced ? JSON.stringify(synced.conversations) : legacyValue;
        const deleted = new Set<string>(deletedValue ? (JSON.parse(deletedValue) as string[]) : []);
        for (const id of synced?.deleted || []) deleted.add(id);
        for (const base of Object.values(synced?.bases || {})) if (base.deleted) deleted.add(base.id);
        for (const id of deletedIds) deleted.add(id);
        // 消息按 id 合并，删除的消息必须记墓碑，否则旧标签页的保存会把它合并回来。
        const deletedMessages = new Set<string>(deletedMessagesValue ? (JSON.parse(deletedMessagesValue) as string[]) : []);
        for (const id of deletedMessageIds) deletedMessages.add(id);
        if (deletedMessages.size) {
            conversations = conversations.map((conversation) => ({ ...conversation, messages: conversation.messages.filter((message) => !deletedMessages.has(message.id)) }));
        }
        const current = currentValue ? (JSON.parse(currentValue) as T[]) : [];
        if (!Array.isArray(current)) throw new Error("创作对话持久状态无效");
        if (synced) {
            synced.removedMessages = Object.assign(Object.create(null), synced.removedMessages);
            for (const conversation of [...current, ...conversations]) {
                const pending = (synced.removedMessages[conversation.id] = Object.assign(Object.create(null), synced.removedMessages[conversation.id]));
                for (const message of conversation.messages) {
                    if (deletedMessages.has(message.id)) pending[message.id] ??= synced.bases[conversation.id]?.messages.find((item) => item.id === message.id)?.revision || 0;
                }
                for (const id of Object.keys(pending)) deletedMessages.add(id);
                for (const message of synced.bases[conversation.id]?.messages || []) if (message.deleted) deletedMessages.add(message.id);
            }
        }
        const merged = new Map<string, T>(current.filter((item) => !deleted.has(item.id)).map((item) => [item.id, item]));
        for (const incoming of persistableCreationConversations(conversations)) {
            if (deleted.has(incoming.id)) continue;
            const previous = merged.get(incoming.id);
            if (!previous) {
                merged.set(incoming.id, incoming);
                continue;
            }
            const messages = new Map(previous.messages.map((message) => [message.id, message]));
            for (const message of incoming.messages) {
                const old = messages.get(message.id);
                // A stale tab must not revert a completed task to pending.
                if (old?.status === "done" && message.status !== "done") continue;
                messages.set(message.id, message);
            }
            merged.set(incoming.id, { ...previous, ...incoming, messages: [...messages.values()].sort((a, b) => (a as { createdAt?: string }).createdAt?.localeCompare((b as { createdAt?: string }).createdAt || "") || 0) } as T);
        }
        if (getActiveUserScope() !== scope) throw new Error("账号已切换，已停止保存旧账号创作历史");
        if (deletedIds.length) await storage.setItem(CREATION_DELETED_CONVERSATIONS_KEY, JSON.stringify([...deleted]));
        if (deletedMessageIds.length) await storage.setItem(CREATION_DELETED_MESSAGES_KEY, JSON.stringify([...deletedMessages].slice(-5000)));
        const values = deletedMessages.size ? [...merged.values()].map((conversation) => ({ ...conversation, messages: conversation.messages.filter((message) => !deletedMessages.has(message.id)) })) : [...merged.values()];
        if (synced) {
            // Keep the server revision ledger and pending tombstones in the same durable envelope.
            await storage.setItem(CREATION_HISTORY_SYNC_KEY, JSON.stringify({ ...synced, conversations: values, deleted: [...deleted].filter((id) => !synced.bases[id]?.deleted) }));
        } else {
            await storage.setItem(CREATION_CONVERSATIONS_KEY, JSON.stringify(values));
        }
        emitCreationConversationsChanged();
    };
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
        await navigator.locks.request(`creation-conversations:${scope}`, save);
        return;
    }
    const pending = fallbackSaveTail.then(save, save);
    fallbackSaveTail = pending.then(
        () => undefined,
        () => undefined,
    );
    await pending;
}

/** 存储写入后广播：侧栏「对话」列表据此刷新。 */
export const CREATION_CONVERSATIONS_CHANGED_EVENT = "creation-conversations:changed";
/** 侧栏发出的操作请求；创作页挂载时处理并 preventDefault，避免页面内存状态覆盖存储。 */
export const CREATION_CONVERSATION_REQUEST_EVENT = "creation-conversations:request";
/** 创作页当前打开的对话，用于侧栏高亮。 */
export const CREATION_CONVERSATION_ACTIVE_EVENT = "creation-conversations:active";

export type CreationConversationRequest = { type: "open"; id: string } | { type: "new" } | { type: "rename"; id: string; title: string } | { type: "pin"; id: string; pinned: boolean } | { type: "delete"; id: string };

let activeCreationConversationId = "";

function emitCreationConversationsChanged() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CREATION_CONVERSATIONS_CHANGED_EVENT));
}

export function currentActiveCreationConversationId() {
    return activeCreationConversationId;
}

export function announceActiveCreationConversation(id: string) {
    activeCreationConversationId = id;
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CREATION_CONVERSATION_ACTIVE_EVENT, { detail: id }));
}

/** 返回 true 表示创作页已接手处理；否则调用方需自行写存储或跳转。 */
export function requestCreationConversation(request: CreationConversationRequest) {
    if (typeof window === "undefined") return false;
    const event = new CustomEvent<CreationConversationRequest>(CREATION_CONVERSATION_REQUEST_EVENT, { detail: request, cancelable: true });
    return !window.dispatchEvent(event);
}

/** 创作页未挂载时，侧栏直接修改存储中的对话标题或置顶状态。 */
export async function patchStoredCreationConversation(id: string, patch: { title?: string; pinned?: boolean }) {
    const scope = getActiveUserScope();
    const stored = (await loadCreationConversations<StoredCreationConversation & { title?: string; pinned?: boolean }>(scope)) || [];
    const target = stored.find((item) => item.id === id);
    if (!target) throw new Error("对话不存在或已被删除");
    await saveCreationConversations([{ ...target, ...patch }], [], [], scope);
}

export async function deleteStoredCreationConversation(id: string) {
    await saveCreationConversations([], [id]);
}
