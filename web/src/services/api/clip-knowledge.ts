import { http } from "./request";

export type ClipKnowledgeEntry = {
    id: string;
    name: string;
    description: string;
    scope: string;
    categoryId?: string;
    categoryPath?: string;
    sourceIds: string[];
    enabled: boolean;
    content: string;
    defaultContent: string;
    customized: boolean;
};

export type ClipKnowledgeSource = {
    id: string;
    name: string;
    repository: string;
    commit: string;
    license: string;
    licenseUrl: string;
    use: string;
};

export type ClipKnowledgeStatus = {
    version: string;
    entries: ClipKnowledgeEntry[];
    sources: ClipKnowledgeSource[];
    coverage: {
        taxonomy: { version: string; commit: string; url: string; license: string; nodes: number; roots: number; leaves: number; level2: number };
        rootStrategies: number;
        familyStrategies: number;
        inheritanceNote: string;
    };
    updatedAt: string;
    modelConfigurationPath: string;
};

export type ClipKnowledgeCategory = {
    id: string;
    parentId: string;
    rootId: string;
    name: string;
    path: string;
    depth: number;
    children: number;
    strategyId: string;
    strategyPath: string;
    inherited: boolean;
};

export type ClipKnowledgeCategoryPage = {
    items: ClipKnowledgeCategory[];
    total: number;
    page: number;
    limit: number;
    lineage: Array<{ id: string; name: string; path: string }>;
};

const base = "/admin/shop-clips/knowledge";

export const getClipKnowledge = () => http.get<ClipKnowledgeStatus>(base);
export const updateClipKnowledge = (entries: Array<Pick<ClipKnowledgeEntry, "id" | "enabled" | "content">>) => http.put<ClipKnowledgeStatus>(base, { entries });
export const getClipKnowledgeCategories = (parent = "", query = "", page = 1) => http.get<ClipKnowledgeCategoryPage>(`${base}/categories?${new URLSearchParams({ parent, q: query, page: String(page) })}`);
