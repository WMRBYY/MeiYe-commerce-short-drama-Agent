// 历史恢复复用相同归约，但不触发浏览器预演等实时副作用。
import { applyAgentEvent as reduceAgentEvent } from "@/lib/canvas/cloud-agent-events";
export * from "@/lib/canvas/cloud-agent-events";
export const applyAgentEvent = (event: Parameters<typeof reduceAgentEvent>[0], setMessages: Parameters<typeof reduceAgentEvent>[1], setRun: Parameters<typeof reduceAgentEvent>[2], setApproval: Parameters<typeof reduceAgentEvent>[3], omniRun = false) =>
    reduceAgentEvent(event, setMessages, setRun, setApproval, (detail) => {
        window.dispatchEvent(new CustomEvent("previs:preview-requested", { detail }));
    }, omniRun);
