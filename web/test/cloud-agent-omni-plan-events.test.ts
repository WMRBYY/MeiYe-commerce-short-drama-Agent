import { expect, test } from "bun:test";
import type { Dispatch, SetStateAction } from "react";
import { applyAgentEvent } from "@/components/canvas/canvas-cloud-agent-events";
import type { CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import type { AgentEvent } from "@/services/api/agent";

const event = (type: string, seq: number, payload: Record<string, unknown>): AgentEvent => ({
    eventId: `event-${seq}`, runId: "run-1", seq, type, payload, createdAt: new Date(0).toISOString(),
});

function replay(omni: boolean) {
    let messages: CloudAgentChatMessage[] = [];
    const setMessages: Dispatch<SetStateAction<CloudAgentChatMessage[]>> = (action) => { messages = typeof action === "function" ? action(messages) : action; };
    const noop = (() => {}) as Dispatch<SetStateAction<never>>;
    const apply = (item: AgentEvent) => applyAgentEvent(item, setMessages, noop, noop, omni);
    const plan = [
        { id: "copy", title: "策划插画文案并落到 Markdown 节点", status: "doing" },
        { id: "image", title: "生成插画并等待结果", status: "pending" },
    ];
    apply(event("plan_updated", 1, { items: plan }));
    apply(event("tool_completed", 2, { toolName: "canvas_apply_ops", callId: "write-1", arguments: JSON.stringify({ ops: [{ type: "add_node", nodeType: "text", content: "小猫看书" }] }), result: { committed: true } }));
    apply(event("tool_completed", 3, { toolName: "generate_media", callId: "image-1", arguments: '{"mode":"image"}', result: { phase: "completion", status: "succeeded", nodeId: "image-node" } }));
    apply(event("plan_updated", 4, { items: plan }));
    return messages.find((message) => message.id === "plan-run-1")?.planItems;
}

test("omni replay advances the visible plan from verified results and resists an older model update", () => {
    expect(replay(true)?.map((item) => item.status)).toEqual(["done", "done"]);
});

test("legacy modes keep model-owned plan statuses", () => {
    expect(replay(false)?.map((item) => item.status)).toEqual(["doing", "pending"]);
});
