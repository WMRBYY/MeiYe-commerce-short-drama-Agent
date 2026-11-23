import { projectDraft, type EcommerceDraft, type EcommercePlan, type EcommerceProject } from "@/services/api/ecommerce";

export function restoreSubmittedCommerceRequest(project: EcommerceProject | null, plan: EcommercePlan | null, cached?: EcommerceDraft | null): EcommerceDraft | null {
    if (cached !== undefined) return cached ? structuredClone(cached) : null;
    if (!project) return null;
    const saved = projectDraft(project);
    if (plan?.images.some((image) => image.taskId)) return saved;
    const previous = plan?.previousImages?.findLast((image) => image.sourceDraft)?.sourceDraft;
    if (previous) return structuredClone(previous);
    return saved.planningTaskId || saved.directionsTaskId ? saved : null;
}
