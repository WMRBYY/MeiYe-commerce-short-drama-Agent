import { http } from "@/services/api/request";

export type AgentConversationDocumentResponse<T> = { revision: number; document: T };

export function getAgentConversationDocument<T>(canvasId: string) {
    return http.get<AgentConversationDocumentResponse<T>>(`/agent/canvases/${encodeURIComponent(canvasId)}/conversations`, { timeout: 8000 });
}

export function putAgentConversationDocument<T>(canvasId: string, revision: number, document: T) {
    return http.put<AgentConversationDocumentResponse<T>>(`/agent/canvases/${encodeURIComponent(canvasId)}/conversations`, { revision, document }, { timeout: 15000 });
}
