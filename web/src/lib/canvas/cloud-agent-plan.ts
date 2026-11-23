import type { CloudAgentPlanItem, CloudAgentUserQuestion } from "@/components/canvas/canvas-cloud-agent-chat-ui";

type PlanCarrier = { planItems?: CloudAgentPlanItem[]; planTerminal?: boolean };

/**
 * 从对话消息流里挑出**当前该展示的那份**待办清单。
 *
 * 一个对话会跨多轮运行，**每轮各有一条** `plan-${runId}` 清单消息，它们都在同一个 messages
 * 数组里。这里必须取**最新**的那条：取第一条（`messages.find`）会把清单永远钉在第 1 轮的
 * 初始状态 —— 后面怎么推进都不刷新、全部做完也不消失（2026-09-16 实测反馈）。
 */
export function latestAgentPlanItems(messages: readonly PlanCarrier[]): CloudAgentPlanItem[] {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const items = messages[index].planItems;
        if (items?.length) return items;
    }
    return [];
}

/**
 * 计划清单可以在运行结束后仍保留未完成项。这个标记必须和清单一起
 * 持久化，否则从本地历史恢复时，未完成项会被误显示为仍在执行。
 */
export function latestAgentPlanTerminal(messages: readonly PlanCarrier[]): boolean {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const items = messages[index].planItems;
        if (items?.length) return messages[index].planTerminal === true;
    }
    return false;
}

/** 全部完成才收起清单；只要还有未开始/进行中，就一直占着输入框上方那一行。 */
export function agentPlanVisible(items: readonly CloudAgentPlanItem[]): boolean {
    return items.length > 0 && items.some((entry) => entry.status !== "done");
}

/** Reconcile replayed omni events from the server's verified tool receipts. */
export function advanceOmniPlanFromTool(items: readonly CloudAgentPlanItem[], payload: Record<string, unknown>): CloudAgentPlanItem[] {
    const index = items.findIndex((item) => item.status === "doing");
    const active = index >= 0 ? index : items.findIndex((item) => item.status !== "done");
    if (active < 0) return [...items];
    const title = items[active].title.toLowerCase();
    if (/核对|质检|交付|审核/u.test(title)) return [...items];
    const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result) ? payload.result as Record<string, unknown> : {};
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(String(payload.arguments || "{}")) as Record<string, unknown>; } catch { return [...items]; }
    let matched = false;
    if (payload.toolName === "canvas_apply_ops" && result.committed === true && Array.isArray(args.ops)) {
        matched = args.ops.some((candidate) => {
            const op = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
            const patch = op.patch && typeof op.patch === "object" ? op.patch as Record<string, unknown> : {};
            const textWrite = (op.type === "add_node" && ["text", "markdown"].includes(String(op.nodeType)) && String(op.content || "").trim()) || (op.type === "update_node" && String(patch.content || "").trim());
            return Boolean(textWrite && /文案|策划|剧本|文本|markdown|提示词/u.test(title)) || (op.type === "connect_nodes" && /连线|连接/u.test(title));
        });
    } else if (payload.toolName === "generate_media" && result.phase === "completion" && result.status === "succeeded" && typeof result.nodeId === "string" && result.nodeId && !result.writebackError && !/(?:[2-9][0-9]*|[二三四五六七八九十多])\s*(?:张|段|幅|个镜头|镜头)/u.test(title)) {
        matched = args.mode === "image" ? /图片|插画|生图|海报/u.test(title) : args.mode === "video" ? /视频|动画|短片/u.test(title) : args.mode === "audio" ? /音频|配音|音效/u.test(title) : false;
    }
    if (!matched) return [...items];
    const next = items.map((item) => ({ ...item }));
    next[active].status = "done";
    next[active].verified = true;
    const pending = next.findIndex((item, position) => position > active && item.status === "pending");
    if (pending >= 0) next[pending].status = "doing";
    return next;
}

export function preserveOmniVerifiedPlan(previous: readonly CloudAgentPlanItem[], incoming: readonly CloudAgentPlanItem[]): CloudAgentPlanItem[] {
    const completed = new Set(previous.filter((item) => item.status === "done" && item.verified).map((item) => `${item.id}\u0000${item.title}`));
    return incoming.map((item) => completed.has(`${item.id}\u0000${item.title}`) ? { ...item, status: "done", verified: true } : item);
}

type QuestionCarrier = { role: string; question?: CloudAgentUserQuestion };

/**
 * 挑出**当前还没作答**的那道提问。
 *
 * 取最后一条带 question 的消息；如果它之后已经有用户消息，说明用户答过了，面板收起。
 *
 * 为什么需要它：运行中输入框是禁用的，模型在正文里提问用户根本答不了
 * （生产实测它连问 4 轮、白烧十几步）。`ask_user` 让本轮干净收尾并把问题结构化，
 * 这个选择器决定「现在该不该把选项面板亮给用户」。
 */
export function pendingAgentQuestion(messages: readonly QuestionCarrier[]): CloudAgentUserQuestion | undefined {
    let index = -1;
    for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
        if (messages[cursor].question) {
            index = cursor;
            break;
        }
    }
    if (index < 0) return undefined;
    // 之后只要出现过用户发言，就说明这道题已经答过了。
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
        if (messages[cursor].role === "user") return undefined;
    }
    return messages[index].question;
}
