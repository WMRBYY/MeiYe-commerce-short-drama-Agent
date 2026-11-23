import { hasSkillLibraryAccess } from "@/lib/skill-access";
import { ApiError, http } from "@/services/api/request";
import type { CreateWorkbenchTaskInput } from "./workbench";
import type { CreateTaskInput } from "./task-center";

export type EcommerceReferenceRole = "primary" | "detail" | "sku" | "style" | "logo" | "package" | "competitor" | "model";
export type EcommerceReference = { resourceId: string; role: EcommerceReferenceRole; name?: string; catalogId?: string; width?: number; height?: number };
export type EcommerceReferenceMode = "product" | "style" | "detail" | "layout";
export type EcommerceLayoutObservation = { resourceId: string; layout: string; visual: string };
export type EcommerceReferenceScreen = {
    sourceResourceId: string;
    screenIndex: number;
    top: number;
    bottom: number;
    content: string;
    layout: string;
    visual: string;
    productView?: "whole" | "detail" | "supporting" | "none";
    sourceCopy?: string;
    bottomJoin?: string;
    resourceId?: string;
};
export type EcommerceSku = { id: string; name: string; color: string; spec: string; packaging: string; claims: string; price: string; resourceId?: string; count: number };
export type EcommerceCreativeOptions = {
    textMode: "auto" | "rich" | "concise" | "none";
    copyTone: "professional" | "brand" | "lifestyle" | "technical" | "editorial" | "campaign";
    fontStyle: "auto" | "modern-sans" | "geometric" | "editorial-serif" | "rounded" | "display";
    colorRhythm: "unified" | "tonal" | "alternating" | "contrast" | "scene";
    informationDensity: "auto" | "airy" | "balanced" | "detailed";
    layoutStyle: "auto" | "editorial" | "feature-cards" | "immersive" | "minimal" | "comparison";
};
export const defaultEcommerceCreativeOptions: EcommerceCreativeOptions = {
    textMode: "auto",
    copyTone: "professional",
    fontStyle: "auto",
    colorRhythm: "unified",
    informationDensity: "balanced",
    layoutStyle: "auto",
};
export type EcommercePackageProduct = Pick<EcommerceDraft, "productName" | "category" | "brand" | "materials" | "specifications" | "packaging" | "audience" | "scene" | "claims"> & { style: string };
export type EcommercePackageSlot = { kind: "main" | "detail"; ratio: string; title?: string; description?: string };
export type EcommercePackageRecognition = { product: EcommercePackageProduct; outline: { title: string; description: string }[] };

export type EcommerceDraft = {
    productName: string;
    category: string;
    brand: string;
    description: string;
    claims: string;
    materials: string;
    colors: string;
    specifications: string;
    packaging: string;
    productVisualStyle?: string;
    dimensions: string;
    audience: string;
    scene: string;
    pricePosition: string;
    lockedDetails: string;
    platform: string;
    region: string;
    imageType: string;
    count: number;
    /** 详情长图按实际屏数生成时为 0，自定义时为所选张数。 */
    detailScreenCount?: number;
    language: string;
    noText: boolean;
    agentModel: string;
    imageModel: string;
    ratio: string;
    resolution: string;
    style: string;
    stylePrompt: string;
    fidelity: string;
    instruction: string;
    skillIds: string[];
    planningTaskId?: string;
    modelEnabled: boolean;
    primaryModelResourceId?: string;
    references: EcommerceReference[];
    layoutReferences?: EcommerceReference[];
    skus: EcommerceSku[];
    typeOptions?: Record<string, string>;
    autoPackage?: { slots: EcommercePackageSlot[] };
    creativeOptions?: EcommerceCreativeOptions;
    cloneOptions?: { copyMode: string; ratioMode: string };
    referenceMode?: EcommerceReferenceMode;
    directionsTaskId?: string;
    creativeRecommendationId?: string;
    creativeDirectionId?: string;
    layoutReferenceId?: string;
    execution?: {
        id: string;
        kind?: "shop-edit" | "tryon";
        clientState?: unknown;
        jobs?: Array<{ key: string; taskId?: string; request: CreateWorkbenchTaskInput; dependsOn?: string; anchorAt?: "first" | "last" }>;
        status: "queued" | "running" | "awaiting_confirmation" | "failed" | "completed" | "partial_success";
        stage?: string;
        startedAt?: string;
        error?: string;
        planningTaskId?: string;
    };
};
export type EcommercePlanImage = {
    id: string;
    imageType: string;
    platform: string;
    language: string;
    goal: string;
    theme: string;
    composition: string;
    displayAssignment?: string;
    mainVisual: string;
    verifiedClaims: string;
    performanceAngle?: string;
    informationComponent?: string;
    copy: string;
    lighting: string;
    fidelity: string;
    prompt: string;
    negativePrompt: string;
    imageModel: string;
    ratio: string;
    resolution: string;
    skuId?: string;
    taskId?: string;
    manualPrompt?: boolean;
    assetId?: string;
    resourceId?: string;
    deliveryStatus?: "pending" | "delivered";
    referenceScreen?: EcommerceReferenceScreen;
    layoutReferenceId?: string;
    sourceDraft?: EcommerceDraft;
    /** Set only on images read from an archived round; edits must patch that round. */
    roundId?: string;
};
export type EcommercePlan = {
    productSummary: string;
    confirmedFacts: string[];
    uncertainFacts: string[];
    visualStrategy: string;
    qualityChecks: string[];
    images: EcommercePlanImage[];
    inputSignature?: string;
    referenceSummary?: string;
    referenceObservations?: EcommerceLayoutObservation[];
    previousImages?: EcommercePlanImage[];
};
/** Reviewable execution details of a recommended style; absent on older recommendations. */
export type EcommerceDirectionVisual = {
    style: string;
    why: string;
    palette: string[];
    typography?: string;
    layout?: string;
    scene?: string;
    lighting?: string;
    camera?: string;
    props?: string;
    colorGrade?: string;
    benchmark?: string;
};
/** `group` is set on style library entries ("preset:<key>"); recommended directions have none. */
export type EcommerceCreativeDirection = { id: string; name: string; summary: string; tags: string[]; categoryFit?: string; visual?: EcommerceDirectionVisual; group?: string };
export type EcommerceKnowledgeEvidence = { title: string; knowledgeType: string; sourceUrl: string; license: string; trustLevel: string };
export type EcommerceCreativeDirectionsResponse = {
    recommendationId: string;
    directions: EcommerceCreativeDirection[];
    evidence: EcommerceKnowledgeEvidence[];
    retrievalStatus: "ready" | "degraded";
    productCategory: string;
    /** Ready-made styles grouped by `group`; absent on older recommendations. */
    styleLibrary?: EcommerceCreativeDirection[];
};
/** `direction` is the confirmed style as the server stored it (a preset or a typed style is expanded there). */
export type EcommerceCreativeDirectionSelection = { recommendationId: string; directionId: string; status: string; planningContext?: Record<string, unknown>; direction?: EcommerceCreativeDirection };
/** The user's own wording of the confirmed style; sent only when it differs from the stored one. */
export type EcommerceStyleRewrite = { name: string; description: string };

export type EcommerceExecutionRequest = {
    id: string;
    projectId?: string;
    revision?: number;
    autoGenerate?: boolean;
    progressive?: boolean;
    draft: EcommerceDraft;
    prompt: string;
    inputSignature: string;
    referenceImages: Array<{ id: string; name?: string; type: "image/*"; dataUrl: ""; storageKey: string }>;
    image: {
        kind: "image";
        model: string;
        logicalModelId?: string;
        channelId?: string;
        parameters: Record<string, unknown>;
        references: Array<{ resourceId: string; kind: "image"; role: "reference" }>;
    };
};
export type EcommerceProject = {
    id: string;
    userId?: string;
    name: string;
    status: string;
    revision: number;
    draftJson: string;
    planJson: string;
    activeRoundId?: string;
    roundCount?: number;
    coverTaskIds?: string[];
    createdAt: string;
    updatedAt: string;
};
export type EcommerceRound = {
    id: string;
    projectId: string;
    ordinal: number;
    imageCount: number;
    version: number;
    createdAt: string;
    updatedAt: string;
    plan: EcommercePlan | null;
};
export type EcommerceRoundPage = { rounds: EcommerceRound[]; total: number; hasMore: boolean };
export type EcommerceRoundConversion = { createdRounds: number; totalRounds: number; totalImages: number };
export type EcommerceSaveOptions = { historyMode?: "rounds"; advanceRound?: boolean; activeRoundId?: string };

export const emptyEcommerceDraft = (): EcommerceDraft => ({
    productName: "",
    category: "",
    brand: "",
    description: "",
    claims: "",
    materials: "",
    colors: "",
    specifications: "",
    packaging: "",
    dimensions: "",
    audience: "",
    scene: "",
    pricePosition: "",
    lockedDetails: "",
    platform: "taobao",
    region: "",
    imageType: "set",
    count: 1,
    language: "zh-CN",
    noText: false,
    agentModel: "",
    imageModel: "",
    ratio: "1:1",
    resolution: "1k",
    style: "commercial",
    fidelity: "standard",
    stylePrompt: "",
    instruction: "",
    skillIds: [],
    modelEnabled: false,
    references: [],
    layoutReferences: [],
    skus: [],
    creativeOptions: { ...defaultEcommerceCreativeOptions },
    referenceMode: "product",
});

/** Keep product identity separate from inspiration, including when reopening older projects. */
export function normalizeEcommerceReferenceGroups(draft: EcommerceDraft): EcommerceDraft {
    const references = Array.isArray(draft.references) ? draft.references : [];
    const isLayout = (reference: EcommerceReference) => reference.role === "style" || reference.role === "competitor";
    const layoutReferences = Array.isArray(draft.layoutReferences) ? draft.layoutReferences : references.filter(isLayout);
    return { ...draft, skillIds: hasSkillLibraryAccess() ? draft.skillIds : [], references: references.filter((reference) => !isLayout(reference)), layoutReferences: layoutReferences.filter(isLayout) };
}

export function projectDraft(project: EcommerceProject): EcommerceDraft {
    try {
        const saved = JSON.parse(project.draftJson);
        return { ...emptyEcommerceDraft(), ...normalizeEcommerceReferenceGroups(saved), creativeOptions: { ...defaultEcommerceCreativeOptions, ...saved.creativeOptions } };
    } catch {
        return emptyEcommerceDraft();
    }
}
export function projectPlan(project: EcommerceProject): EcommercePlan | null {
    try {
        const plan = JSON.parse(project.planJson) as EcommercePlan;
        return Array.isArray(plan.images) ? plan : null;
    } catch {
        return null;
    }
}
export type EcommerceBatchExecutionRequest = {
    id: string;
    kind: "shop-edit" | "tryon";
    title: string;
    clientState: unknown;
    planning?: CreateTaskInput;
    jobs: Array<{ key: string; request: CreateWorkbenchTaskInput; dependsOn?: string; anchorAt?: "first" | "last" }>;
};
export function startEcommerceBatchExecution(input: EcommerceBatchExecutionRequest) {
    return http.post<EcommerceProject>("/ecommerce/executions/batch", input);
}
export function startEcommerceExecution(input: EcommerceExecutionRequest) {
    return http.post<EcommerceProject>("/ecommerce/executions", input);
}
export async function startEcommercePackageExecution(input: EcommerceExecutionRequest) {
    try {
        return await http.post<EcommerceProject>("/ecommerce/executions/auto-package", input);
    } catch (error) {
        if (error instanceof ApiError && error.status === 404 && !input.projectId) {
            throw new ApiError("自动套餐服务暂不可用，恢复连接后会继续提交。", { status: 404, retryable: true, cause: error });
        }
        throw error;
    }
}

export function confirmEcommerceExecution(projectId: string, decision: "exclude" | "approve") {
    return http.post<EcommerceProject>(`/ecommerce/projects/${encodeURIComponent(projectId)}/execution/confirm`, { decision });
}

export function retryEcommerceExecution(projectId: string, taskId?: string) {
    return http.post<EcommerceProject>(`/ecommerce/projects/${encodeURIComponent(projectId)}/execution/retry`, {}, { params: { taskId } });
}

export function listEcommerceProjects() {
    return http.get<{ projects: EcommerceProject[] }>("/ecommerce/projects").then(({ projects }) => projects || []);
}
export function listEcommerceProjectPage(page: number, pageSize: 20 | 50 | 100) {
    return http.get<{ projects: EcommerceProject[]; total: number; page: number; pageSize: number }>(`/ecommerce/projects?page=${page}&pageSize=${pageSize}`);
}
export function deleteEcommerceProjects(request: { ids?: string[]; all?: boolean; expectedTotal: number }) {
    return http.deleteWithBody<{ deleted: number }>("/ecommerce/projects", request);
}
export function createEcommerceProject() {
    return http.post<EcommerceProject>("/ecommerce/projects", {});
}
export function getEcommerceProject(id: string, options?: { history?: "active" }) {
    const suffix = options?.history ? `?history=${encodeURIComponent(options.history)}` : "";
    return http.get<EcommerceProject>(`/ecommerce/projects/${encodeURIComponent(id)}${suffix}`);
}
export function deleteEcommerceBatch(project: EcommerceProject) {
    return http.deleteWithBody<{ project: EcommerceProject; assetIds: string[] }>(`/ecommerce/projects/${encodeURIComponent(project.id)}/current-batch`, { revision: project.revision });
}
export function saveEcommerceProject(project: EcommerceProject, draft: EcommerceDraft, plan: EcommercePlan | null, options?: EcommerceSaveOptions) {
    return http.put<EcommerceProject>(`/ecommerce/projects/${encodeURIComponent(project.id)}`, {
        revision: project.revision,
        name: draft.productName || project.name,
        draft: { ...draft, skillIds: hasSkillLibraryAccess() ? draft.skillIds : [] },
        // Round-mode saves never upload archived rounds. The active plan is the
        // only plan the server stores on the project row.
        ...(plan ? { plan: options?.historyMode === "rounds" ? { ...plan, previousImages: undefined } : plan } : {}),
        ...(options?.historyMode ? { historyMode: options.historyMode, advanceRound: Boolean(options.advanceRound), ...(options.activeRoundId ? { activeRoundId: options.activeRoundId } : {}) } : {}),
    });
}
/** Idempotently converts legacy inline history into round rows. 404 on older servers. */
export function convertEcommerceProjectRounds(id: string, revision: number) {
    return http.post<{ project: EcommerceProject; conversion: EcommerceRoundConversion }>(`/ecommerce/projects/${encodeURIComponent(id)}/rounds-convert`, { revision });
}
export function listEcommerceRounds(id: string, options?: { limit?: number; before?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.before) params.set("before", String(options.before));
    const query = params.toString();
    return http.get<EcommerceRoundPage>(`/ecommerce/projects/${encodeURIComponent(id)}/rounds${query ? `?${query}` : ""}`);
}
export function patchEcommerceRoundImage(projectId: string, roundId: string, imageId: string, update: { version: number; image?: EcommercePlanImage; remove?: boolean }) {
    return http.patch<EcommerceRound>(`/ecommerce/projects/${encodeURIComponent(projectId)}/rounds/${encodeURIComponent(roundId)}/images/${encodeURIComponent(imageId)}`, update);
}

export function getEcommerceSkillPrompt(skillIds: string[]) {
    if (!hasSkillLibraryAccess() || !skillIds.length) return Promise.resolve("");
    return http.post<{ prompt: string }>("/ecommerce/skills/prompt", { skillIds }).then(({ prompt }) => prompt);
}

// The analysis model is chosen by the administrator; the server rejects a
// client-supplied model for this endpoint.
export function recommendEcommerceCreativeDirections(draft: EcommerceDraft, projectId: string) {
    return http.post<EcommerceCreativeDirectionsResponse>("/ecommerce/creative-directions", {
        projectId,
        productName: draft.productName,
        category: draft.category,
        description: draft.description,
        claims: draft.claims,
        materials: draft.materials,
        colors: draft.colors,
        specifications: draft.specifications,
        platform: draft.platform,
        region: draft.region,
        language: draft.language,
        imageType: draft.imageType,
        count: draft.count,
        instruction: draft.instruction,
        style: draft.style,
        stylePrompt: draft.stylePrompt,
        referenceMode: draft.referenceMode === "detail" ? "detail" : draft.layoutReferences?.length ? "style" : draft.referenceMode,
        materialPlan: draft.typeOptions?.materialPlan || "",
        referenceCount: draft.references.length,
    });
}

/** `directionId` is a recommended direction, a library style ("preset:<key>") or "custom". */
export function selectEcommerceCreativeDirection(recommendationId: string, directionId: string, rewrite?: EcommerceStyleRewrite) {
    return http.post<EcommerceCreativeDirectionSelection>(`/ecommerce/creative-directions/${encodeURIComponent(recommendationId)}/select`, { directionId, ...rewrite });
}
