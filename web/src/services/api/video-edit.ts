import { http } from "./request";

export type ClipMode = "koubo" | "mix" | "subtitle" | "behind";
export type ClipStatus = "analyzing" | "ready" | "rendering" | "succeeded" | "failed" | "cancelled";
export type ClipSubtitle = { startMs: number; endMs: number; text: string };
export type ClipPlacement = { resourceId: string; startMs: number; endMs: number; sourceStartMs: number; reason?: string };
export type ShopClipVisual = {
    subtitleStyle: "outline" | "solid" | "panel" | "highlight" | "serif" | "bubble";
    animation: "none" | "fade" | "rise" | "pop";
    filter: "original" | "warm" | "cool" | "soft" | "crisp" | "mono";
    transition: "cut" | "dissolve" | "slide";
    widget: "none" | "label" | "underline" | "corner" | "progress";
    layout: "full" | "pip";
};
export type ClipTemplate = {
    id: string;
    name: string;
    description: string;
    group?: string;
    tags?: string[];
    modes?: ClipMode[];
    visual?: ShopClipVisual;
    preview?: { foreground: string; background: string; accent: string; font: string };
    previewUrl?: string;
};
export type ClipPlan = {
    version: number;
    templateVersion: number;
    sourceResourceId: string;
    materials: string[];
    transcript: ClipSubtitle[];
    placements: ClipPlacement[];
    templateId: string;
    title: string;
    autoRender?: boolean;
    referenceText?: string;
    visual?: ShopClipVisual;
    trimStartMs?: number;
    trimEndMs?: number;
    sourceDurationMs?: number;
    pricingVersion?: number;
    credits?: number;
    director?: {
        captionMaxChars: number;
        categoryId: string;
        categoryPath: string;
        knowledgeIds: string[];
        knowledgeDigest: string;
        summary: string;
        evidence: string[];
    };
    behindText: string;
    behindPosition?: "top" | "center" | "bottom";
    subjectBox?: number[];
    musicResourceId?: string;
    musicVolume?: number;
    width: number;
    height: number;
    durationMs: number;
};
export type ClipProject = {
    id: string;
    mode: ClipMode;
    title: string;
    status: ClipStatus;
    retryStage: "analyze" | "render";
    stage: string;
    progress: number;
    error: string;
    plan: ClipPlan;
    outputResourceId: string;
    taskId: string;
    createdAt: string;
    updatedAt: string;
};
export type ClipCapabilities = {
    modes: Record<ClipMode, { enabled: boolean; reason?: string }>;
    renderModes: Record<ClipMode, { enabled: boolean; reason?: string }>;
    autoModes: Record<ClipMode, { enabled: boolean; reason?: string }>;
    templates: ClipTemplate[];
};
export type CreateClipInput = {
    idempotencyKey: string;
    expectedCredits: number;
    mode: ClipMode;
    sourceResourceId: string;
    materialResourceIds?: string[];
    templateId: string;
    title: string;
    autoRender?: boolean;
    referenceText?: string;
    visual?: ShopClipVisual;
    trimStartMs?: number;
    trimEndMs?: number;
    behindText?: string;
    behindPosition?: ClipPlan["behindPosition"];
    subjectBox?: number[];
    musicResourceId?: string;
    musicVolume?: number;
};
export type ClipQuote = { credits: number; chargeMode: "free" | "fixed"; label: string; chargeAt: "submit" | "render" };
export type ClipQuoteInput = Omit<CreateClipInput, "idempotencyKey" | "expectedCredits"> | { projectId: string };

const base = "/ecommerce/clips";
export const getClipCapabilities = (signal?: AbortSignal) => http.get<ClipCapabilities>(`${base}/capabilities`, { signal });
export const listClips = (signal?: AbortSignal) => http.get<{ items: ClipProject[] }>(base, { signal });
export const getClip = (id: string, signal?: AbortSignal) => http.get<ClipProject>(`${base}/${encodeURIComponent(id)}`, { signal });
const walletChanged = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("wallet:updated"));
};
export const createClip = async (input: CreateClipInput) => {
    const result = await http.post<ClipProject>(base, input);
    walletChanged();
    return result;
};
export const quoteClip = (input: ClipQuoteInput, signal?: AbortSignal) => http.post<ClipQuote>(`${base}/quote`, input, { signal });
export const saveClipPlan = (id: string, plan: ClipPlan) => http.put<ClipProject>(`${base}/${encodeURIComponent(id)}/plan`, { plan });
export const renderClip = async (id: string, idempotencyKey: string, plan: ClipPlan, expectedCredits?: number) => {
    const result = await http.post<ClipProject>(`${base}/${encodeURIComponent(id)}/render`, { idempotencyKey, plan, expectedCredits });
    walletChanged();
    return result;
};
export const retryClip = async (id: string, idempotencyKey: string, expectedCredits?: number) => {
    const result = await http.post<ClipProject>(`${base}/${encodeURIComponent(id)}/retry`, { idempotencyKey, expectedCredits });
    walletChanged();
    return result;
};
export const cancelClip = async (id: string) => {
    const result = await http.post<ClipProject>(`${base}/${encodeURIComponent(id)}/cancel`, {});
    walletChanged();
    return result;
};
