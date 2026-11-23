import { apiBaseURL, compactApiParams, http } from "./request";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

/** 与首页作品区分类（HOME_GALLERY_CATEGORIES 中除「精选」外的 key）一致。 */
export const CANVAS_TEMPLATE_CATEGORIES = [
    { key: "drama", label: "短剧漫剧" },
    { key: "film", label: "影视作品" },
    { key: "anime", label: "动画动漫" },
    { key: "ads", label: "广告营销" },
    { key: "graphic", label: "平面设计" },
    { key: "ecommerce", label: "电商" },
] as const;

export type CanvasTemplateCategory = (typeof CANVAS_TEMPLATE_CATEGORIES)[number]["key"];
export type CanvasTemplateStatus = "pending" | "approved" | "rejected" | "offline";

export const CANVAS_TEMPLATE_REPORT_REASONS = [
    { key: "porn", label: "色情低俗" },
    { key: "infringement", label: "侵犯权益" },
    { key: "illegal", label: "违法违规" },
    { key: "discomfort", label: "引人不适" },
    { key: "spam", label: "垃圾广告" },
    { key: "other", label: "其他问题" },
] as const;

export type CanvasTemplateAuthor = {
    avatarMode?: "custom" | "default" | "";
    avatarPreset?: string;
    id: string;
    displayName: string;
    avatarUrl?: string;
    username?: string;
    followed: boolean;
    isSelf: boolean;
};

export type CanvasTemplate = {
    ecommerce?: EcommerceWorkMetadata;
    id: string;
    canvasId?: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    coverUrl: string;
    coverThumbUrl: string;
    videoUrl: string;
    videoDurationMs: number;
    videoWidth: number;
    videoHeight: number;
    videoBytes: number;
    allowDownload: boolean;
    nodeCount: number;
    connectionCount: number;
    likeCount: number;
    liked: boolean;
    status: CanvasTemplateStatus;
    reviewNote?: string;
    reportCount?: number;
    author: CanvasTemplateAuthor;
    publishedAt?: string;
    reviewedAt?: string;
    createdAt: string;
};

export type CanvasTemplateList = {
    items: CanvasTemplate[];
    total: number;
    page: number;
    pageSize: number;
    counts?: Partial<Record<CanvasTemplateStatus, number>>;
};

export type CanvasTemplateProject = {
    id: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    viewport?: ViewportTransform;
    backgroundMode?: "lines" | "dots" | "blank";
};

export type CanvasTemplateReport = { reason: string; detail: string; createdAt: string };

export type CanvasTemplateSubmitInput = {
    ecommerce?: EcommerceWorkMetadata;
    canvasId: string;
    title: string;
    description: string;
    category: CanvasTemplateCategory;
    tags: string[];
    videoResourceId: string;
    coverResourceId: string;
    allowDownload: boolean;
};

export function canvasTemplateCategoryLabel(key: string) {
    return CANVAS_TEMPLATE_CATEGORIES.find((item) => item.key === key)?.label || "其他";
}

/** 后端返回 /api/... 受控路径；前端与 API 分域部署时改写到 API 源。 */
export function canvasTemplateMediaUrl(path?: string) {
    if (!path) return "";
    const base = String(apiBaseURL).replace(/\/+$/, "");
    if (/^https?:\/\//i.test(base) && path.startsWith("/api/")) return `${base}${path.slice("/api".length)}`;
    return path;
}

export function submitCanvasTemplate(input: CanvasTemplateSubmitInput) {
    return http.post<{ template: CanvasTemplate }>("/canvas-templates", input);
}

export type EcommerceWorkMetadata = { prompt: string; model: string; referenceResourceIds: string[]; referenceVideoResourceId?: string; referenceCategories?: string[]; replaceMode?: string };
export type EcommerceWorkRemix = {
    prompt: string;
    replaceMode: string;
    subjectHint?: string;
    productName?: string;
    analysisSummary?: string;
    materials: { resourceId: string; category: string; name: string; width: number; height: number; durationMs: number }[];
};
export function remixEcommerceWork(id: string) {
    return http.post<EcommerceWorkRemix>(`/canvas-templates/${encodeURIComponent(id)}/remix`, undefined, { timeout: 300000 });
}

export function listMyCanvasTemplates(canvasId?: string, signal?: AbortSignal) {
    return http.get<{ items: CanvasTemplate[] }>("/canvas-templates/mine", { params: compactApiParams({ canvasId }), signal });
}

export function listPublicCanvasTemplates(params: { category?: string; q?: string; page?: number; pageSize?: number } = {}, signal?: AbortSignal) {
    return http.get<CanvasTemplateList>("/public/canvas-templates", { params: compactApiParams(params), signal });
}

export function getPublicCanvasTemplate(id: string, signal?: AbortSignal) {
    return http.get<{ template: CanvasTemplate }>(`/public/canvas-templates/${encodeURIComponent(id)}`, { signal });
}

export function getPublicCanvasTemplateCanvas(id: string, signal?: AbortSignal) {
    return http.get<{ project: CanvasTemplateProject }>(`/public/canvas-templates/${encodeURIComponent(id)}/canvas`, { signal });
}

export function setCanvasTemplateLike(id: string, liked: boolean) {
    const url = `/canvas-templates/${encodeURIComponent(id)}/like`;
    return liked ? http.post<{ liked: boolean; likeCount: number }>(url) : http.delete<{ liked: boolean; likeCount: number }>(url);
}

export function setUserFollow(userId: string, followed: boolean) {
    const url = `/users/${encodeURIComponent(userId)}/follow`;
    return followed ? http.post<{ followed: boolean }>(url) : http.delete<{ followed: boolean }>(url);
}

export function reportCanvasTemplate(id: string, input: { reason: string; detail: string }) {
    return http.post<{ reported: boolean }>(`/canvas-templates/${encodeURIComponent(id)}/report`, input);
}

export function listAdminCanvasTemplates(params: { status?: string; category?: string; q?: string; page?: number; pageSize?: number }, signal?: AbortSignal) {
    return http.get<CanvasTemplateList>("/admin/canvas-templates", { params: compactApiParams(params), signal });
}

export function getAdminCanvasTemplate(id: string, signal?: AbortSignal) {
    return http.get<{ template: CanvasTemplate; project: CanvasTemplateProject; reports: CanvasTemplateReport[] }>(`/admin/canvas-templates/${encodeURIComponent(id)}`, { signal });
}

export function reviewAdminCanvasTemplate(id: string, input: { action: "approve" | "reject" | "offline"; note?: string }) {
    return http.post<{ template: CanvasTemplate }>(`/admin/canvas-templates/${encodeURIComponent(id)}/review`, input);
}

export function formatTemplateDuration(ms?: number) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatTemplateBytes(bytes?: number) {
    const value = Math.max(0, bytes || 0);
    if (value >= 1 << 30) return `${(value / (1 << 30)).toFixed(2)} GB`;
    if (value >= 1 << 20) return `${(value / (1 << 20)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
}

/** 按视频高度给出清晰度标签（如 720P / 1080P / 4K）。 */
export function templateQualityLabel(width?: number, height?: number) {
    const short = Math.min(width || 0, height || 0) || height || 0;
    if (short >= 2160) return "4K";
    if (short >= 1440) return "2K";
    if (short >= 1080) return "1080P";
    if (short >= 720) return "720P";
    if (short >= 480) return "480P";
    return short > 0 ? `${short}P` : "原画";
}
