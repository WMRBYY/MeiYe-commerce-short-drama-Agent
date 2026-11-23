import { useGlobalAgentStore } from "@/stores/use-global-agent-store";

/** 画布只发送开合命令；平台级面板独立订阅状态，避免开合时重渲染整个编辑器。 */
export function useCanvasAssistantVisibility() {
    const openAgent = useGlobalAgentStore((state) => state.openAgent);
    const closeAgent = useGlobalAgentStore((state) => state.closeAgent);

    return {
        closeAgent,
        openAgent,
    };
}
