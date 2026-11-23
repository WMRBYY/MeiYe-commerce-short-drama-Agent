import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { updateCommerceCanvasImage } from "@/pages/ecommerce/continuation";
import { assertCommerceClaimsGrounded } from "@/pages/ecommerce/planner";
import { assertCommerceImageReferenceCapacity, commerceGenerationRatio, commerceImageParameters, commerceImagePrompt, commerceImageReferences, commerceRegenerationVariation, manuallyEditedCommerceImage } from "@/pages/ecommerce/workflow";
import { getEcommerceProject, listEcommerceRounds, patchEcommerceRoundImage, projectDraft, projectPlan, saveEcommerceProject, type EcommercePlan, type EcommercePlanImage, type EcommerceProject, type EcommerceRound } from "@/services/api/ecommerce";
import type { GenerationTask } from "@/services/api/task-center";
import { createWorkbenchTask } from "@/services/api/workbench";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

/** 详情图里一张已出图的方案：在当前方案里，或在某个历史轮次里。 */
export type DetailPlanSource = { project: EcommerceProject; plan: EcommercePlan; image: EcommercePlanImage; round: EcommerceRound | null };

/** 按出图任务 ID 找到这张图的方案（当前方案优先，再翻历史轮次）。还没写进方案的屏（策划仍在保存）返回 null。 */
export async function findDetailPlanImage(projectId: string, taskId: string): Promise<DetailPlanSource | null> {
    const project = await getEcommerceProject(projectId);
    const plan = projectPlan(project);
    const active = plan?.images.find((image) => image.taskId === taskId);
    if (plan && active) return { project, plan, image: active, round: null };
    let before: number | undefined;
    for (let page = 0; page < 20; page++) {
        const result = await listEcommerceRounds(project.id, { limit: 50, before });
        const round = result.rounds.find((item) => item.plan?.images.some((entry) => entry.taskId === taskId));
        if (round?.plan) return { project, plan: round.plan, image: round.plan.images.find((entry) => entry.taskId === taskId)!, round };
        if (!result.hasMore || !result.rounds.length) break;
        before = result.rounds[result.rounds.length - 1].ordinal;
    }
    return null;
}

export type DetailRegenerateEdit = { prompt: string; copy: string; imageModel: string; ratio: string; resolution: string };

export async function completeDetailEditAttempt(projectId: string, imageId: string, taskId: string) {
    const storage = localForageStorageForScope(getActiveUserScope());
    const key = `detail-edit-attempt:${projectId}:${imageId}`;
    const raw = await storage.getItem(key);
    if (raw && (JSON.parse(String(raw)) as { taskId?: string }).taskId === taskId) await storage.removeItem(key);
}

/** Edit the actual selected output. The source image is the only reference and billing is one image. */
export async function editDetailImage(config: AiConfig, source: DetailPlanSource, resourceId: string, instruction: string, clientSubmissionId: string): Promise<{ task: GenerationTask; project: EcommerceProject }> {
    if (!resourceId || !instruction.trim() || !clientSubmissionId) throw new Error("请先选择图片并填写修改内容");
    const original = source.image;
    const profile = modelCapabilityConfigFor(config, original.imageModel).image;
    if (!profile || profile.references.maxImages < 1) throw new Error("当前模型不支持参考图片编辑，请先更换图片模型");
    if (!profile.size.values.includes(original.ratio) || (profile.resolution.supported && !profile.resolution.values.includes(original.resolution))) throw new Error("原图规格已不受当前模型支持，请先更新模型与规格");
    const parameters = commerceImageParameters(profile, original.ratio, original.resolution);
    const logicalModelId = logicalModelIDForConfig({ ...config, model: original.imageModel });
    const scope = getActiveUserScope();
    if (!scope || scope === "guest") throw new Error("请登录后修改图片");
    const storage = localForageStorageForScope(scope);
    const attemptKey = `detail-edit-attempt:${source.project.id}:${original.id}`;
    const signature = JSON.stringify([resourceId, instruction, original.imageModel, parameters]);
    const savedAttempt = await storage.getItem(attemptKey);
    const previous = savedAttempt ? (JSON.parse(String(savedAttempt)) as { signature: string; id: string }) : null;
    const submissionId = previous?.signature === signature ? previous.id : clientSubmissionId;
    // Preserve the receipt identity across closing/reopening after an uncertain
    // network response. Failure to persist aborts before a billable request.
    await storage.setItem(attemptKey, JSON.stringify({ signature, id: submissionId }));
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开图片");
    const task = await createWorkbenchTask({
        ecommerceProjectId: source.project.id,
        clientSubmissionId: submissionId,
        kind: "image",
        prompt: `对提供的这张原始成片进行局部修改，输出一张完整图片。保持原图尺寸比例、布局、商品身份、场景、光照及未指定区域不变。保留文字原有字体家族风格、字重、笔画、颜色、字号、倾斜角和基线；无法复现原字体时匹配最接近的字形，不要统一替换成默认黑体。删除文字时修复下方背景纹理，不留色块。\n\n${instruction.trim()}`,
        model: modelOptionName(original.imageModel),
        ...(logicalModelId ? { logicalModelId } : { channelId: resolveModelChannel(config, original.imageModel).id }),
        parameters,
        references: [{ resourceId, kind: "image", role: "reference" }],
    });
    await storage.setItem(attemptKey, JSON.stringify({ signature, id: submissionId, taskId: task.id }));
    const updated = { ...original, taskId: task.id, prompt: task.prompt || instruction, manualPrompt: true };
    if (source.round) {
        await patchEcommerceRoundImage(source.project.id, source.round.id, original.id, { version: source.round.version, image: { ...updated, roundId: source.round.id } });
        return { task, project: source.project };
    }
    const latest = await getEcommerceProject(source.project.id);
    const plan = projectPlan(latest);
    const latestImage = plan?.images.find((entry) => entry.id === original.id);
    if (!plan || !latestImage || (latestImage.taskId !== original.taskId && latestImage.taskId !== task.id)) throw new Error("修改任务已提交，但这张图的方案已更新，请在任务记录中查看结果");
    const saved = await saveEcommerceProject(
        latest,
        projectDraft(latest),
        updateCommerceCanvasImage(plan, original.id, (current) => ({ ...current, taskId: task.id, prompt: updated.prompt, manualPrompt: true })),
        latest.activeRoundId ? { historyMode: "rounds", advanceRound: false, activeRoundId: latest.activeRoundId } : undefined,
    );
    return { task, project: saved };
}

/**
 * 在详情图页直接重新生成一张：和电商 Agent 方案里的「重新生成」同一套提示词、参考图与参数校验，
 * 只是不跳页。提交后把新任务写回原方案（当前方案保存项目，历史轮次就地修改该轮），原图仍在资产库与任务历史里。
 */
export async function regenerateDetailImage(config: AiConfig, source: DetailPlanSource, edit: DetailRegenerateEdit): Promise<{ task: GenerationTask; project: EcommerceProject }> {
    const { plan, image: original, round } = source;
    const draft = original.sourceDraft || projectDraft(source.project);
    let edited: EcommercePlanImage = { ...original, prompt: edit.prompt.trim(), copy: edit.copy, imageModel: edit.imageModel, ratio: edit.ratio, resolution: edit.resolution };
    if (!edited.prompt) throw new Error("提示词不能为空");
    edited = manuallyEditedCommerceImage(original, edited);
    assertCommerceClaimsGrounded({ ...plan, images: [edited] }, draft, { hardOnly: true });
    const profile = modelCapabilityConfigFor(config, edited.imageModel).image;
    if (!profile) throw new Error("所选模型不能生成图片，请换一个模型");
    const index = Math.max(0, original.referenceScreen ? original.referenceScreen.screenIndex - 1 : plan.images.findIndex((item) => item.id === original.id));
    const refs = commerceImageReferences(draft, edited, index, false);
    assertCommerceImageReferenceCapacity(refs.length, profile.references.maxImages);
    if (!profile.size.values.includes(edited.ratio) || (profile.resolution.supported && !profile.resolution.values.includes(edited.resolution))) throw new Error("当前模型不支持所选比例或分辨率");
    const generated = { ...edited, ratio: commerceGenerationRatio(config, draft, edited) };
    const parameters = commerceImageParameters(profile, generated.ratio, generated.resolution);
    // 提示词没改时要求换一版，否则同一提示词会出几乎相同的图。
    const variation = original.prompt === edited.prompt ? `\n\n${commerceRegenerationVariation(draft, edited)}` : "";
    const logicalModelId = logicalModelIDForConfig({ ...config, model: edited.imageModel });
    const task = await createWorkbenchTask({
        ecommerceProjectId: source.project.id,
        kind: "image",
        prompt: `${commerceImagePrompt(draft, generated, original.sourceDraft ? draft.productName : plan.productSummary, original.sourceDraft && !generated.referenceScreen ? original.prompt : plan.visualStrategy, parameters, plan.images)}${variation}`,
        model: modelOptionName(edited.imageModel),
        ...(logicalModelId ? { logicalModelId } : { channelId: resolveModelChannel(config, edited.imageModel).id }),
        parameters,
        references: refs.map((ref) => ({ resourceId: ref.resourceId, kind: "image" as const, role: "reference" as const })),
    });
    const updated: EcommercePlanImage = { ...edited, taskId: task.id, sourceDraft: original.sourceDraft };
    if (round) {
        await patchEcommerceRoundImage(source.project.id, round.id, original.id, { version: round.version, image: { ...updated, roundId: round.id } });
        return { task, project: source.project };
    }
    // 重新读一次项目，用最新 revision 保存，避免覆盖期间别处的修改。
    const latest = await getEcommerceProject(source.project.id);
    const latestPlan = projectPlan(latest);
    if (!latestPlan?.images.some((item) => item.id === original.id)) throw new Error("新任务已提交，但这张图已不在当前方案里，请在任务记录里查看");
    const rounds = Boolean(latest.activeRoundId);
    const saved = await saveEcommerceProject(
        latest,
        projectDraft(latest),
        updateCommerceCanvasImage(latestPlan, original.id, () => updated),
        rounds ? { historyMode: "rounds", advanceRound: false, activeRoundId: latest.activeRoundId } : undefined,
    );
    return { task, project: saved };
}
