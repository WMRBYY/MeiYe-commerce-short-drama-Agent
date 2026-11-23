import { createClientUUID } from "@/lib/client-id";
import { Button, Collapse, Input, InputNumber, Modal, Select, Switch } from "antd";
import { ArrowUpRight, CopyCheck, Images, ShoppingBag, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { RollingCreditAmount } from "@/components/rolling-credit-text";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getResource, uploadResourceFile, resolveResourceUrl, resourceStorageKey } from "@/services/api/resources";
import { getEcommerceProject, projectDraft, projectPlan, saveEcommerceProject, type EcommerceDraft, type EcommercePlan, type EcommerceProject, type EcommerceReference, type EcommerceReferenceRole, emptyEcommerceDraft } from "@/services/api/ecommerce";
import { queryGenerationTask, retryGenerationTask, subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { resolveModelChannel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { refreshSystemChannels } from "@/lib/user-session";
import { imageTypes, languages, options, platforms, styles, imageSizeLabel } from "@/pages/ecommerce/catalog";
import { quoteCommerce, settleCommercePlan, submitCommerceImages, submitCommercePlan, commerceRequiredImageReferenceCount } from "@/pages/ecommerce/workflow";
import { ecommerceTypeConfig, fieldLabel, typeValidation } from "@/pages/ecommerce/type-config";
import { CreationOptions } from "@/pages/ecommerce/creation-options";
import { assertCommercePlanCurrent, commerceInputSignature, reviseCommerceFacts, excludeCommerceFacts } from "@/pages/ecommerce/planner";
import { CommerceFactReview } from "@/pages/ecommerce/fact-review";
import { directCommercePlan } from "@/pages/ecommerce/direct-plan";
import { PlanningActivity } from "@/pages/ecommerce/planning-activity";
import { GenerationConfirmation } from "@/pages/ecommerce/generation-confirmation";
import { useCommerceAdminModels } from "@/pages/ecommerce/admin-models";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-commerce-panel.css";

type ConnectedImage = { nodeId: string; title: string; resourceId?: string; previewUrl?: string; role: EcommerceReferenceRole };
type Props = {
    node: CanvasNodeData;
    connected: ConnectedImage[];
    mode: "agent" | "clone";
    onClose: () => void;
    onPatch: (patch: Record<string, unknown>) => void;
    onUpload: (resourceId: string, role: EcommerceReferenceRole, name: string) => void;
    onRole: (nodeId: string, role: EcommerceReferenceRole) => void;
    onPlan: (project: EcommerceProject, plan: EcommercePlan) => void;
    onTask: (project: EcommerceProject, plan: EcommercePlan, task?: GenerationTask) => void;
    onWorkbench: (projectId: string) => void;
};
const roleOptions = options([["primary", "商品图"], ["detail", "细节参考"], ["sku", "SKU 参考"], ["style", "版式 / 风格模板"], ["logo", "品牌 Logo"], ["package", "包装图"]]);
const example: Record<string, string> = {
    category: "例如：家用小电器", brand: "例如：已注册的真实品牌名称", description: "例如：便携式香薰机，适合卧室与办公桌使用。",
    claims: "例如：已确认的续航、功能、配件；不填写未经核实的功效。", colors: "例如：米白色、深灰色", materials: "例如：已确认的 ABS 外壳",
    specifications: "例如：型号、容量、电压等真实参数", dimensions: "例如：长 12 cm × 宽 8 cm × 高 15 cm", packaging: "例如：主机、充电线、说明书各一件",
    lockedDetails: "例如：Logo 位置、接口形状、SKU 颜色不得修改", audience: "例如：注重居家氛围的年轻用户", scene: "例如：卧室床头、办公桌、礼品开箱",
    pricePosition: "例如：中端，售价约 199 元", stylePrompt: "例如：柔和自然光、浅灰背景、充足留白", instruction: "例如：突出已确认的卖点，参考上传模板的构图；不要改变商品外观。",
};
const terminal = (status: GenerationTask["status"]) => ["succeeded", "failed", "cancelled"].includes(status);
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
function sizeRatio(value: string): number | null {
    const match = /^(\d+)\s*[:x×]\s*(\d+)$/i.exec(value);
    return match ? Number(match[1]) / Number(match[2]) : null;
}

export function CanvasCommercePanel({ node, connected, mode, onClose, onPatch, onUpload, onRole, onPlan, onTask, onWorkbench }: Props) {
    const config = useEffectiveConfig();
    const projectId = typeof node.metadata?.pluginData?.ecommerceProjectId === "string" ? node.metadata.pluginData.ecommerceProjectId : "";
    const cached = node.metadata?.pluginData?.draft as EcommerceDraft | undefined;
    const [draft, setDraft] = useState<EcommerceDraft>(() => ({ ...emptyEcommerceDraft(), ...cached }));
    const [project, setProject] = useState<EcommerceProject | null>(null);
    const projectRef = useRef<EcommerceProject | null>(null);
    const [plan, setPlan] = useState<EcommercePlan | null>(null);
    const [tasks, setTasks] = useState<Record<string, GenerationTask>>({});
    const [busy, setBusy] = useState(false);
    const [stage, setStage] = useState("");
    const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
    const [quote, setQuote] = useState<{ image: number; agent: number; total: number } | null>(null);
    const [directMode, setDirectMode] = useState(false);
    const [planningTask, setPlanningTask] = useState<GenerationTask>();
    const planningPending = Boolean(draft.planningTaskId && !plan);
    useEffect(() => { if (plan?.images.every((image) => image.id.startsWith("direct-"))) setDirectMode(true); }, [plan]);
    const [uploading, setUploading] = useState(false);
    const [advanced, setAdvanced] = useState(false);
    const [copyMode, setCopyMode] = useState(typeof node.metadata?.pluginData?.copyMode === "string" ? node.metadata.pluginData.copyMode : "keep");
    const [cloneRatio, setCloneRatio] = useState(typeof node.metadata?.pluginData?.cloneRatio === "string" ? node.metadata.pluginData.cloneRatio : "template");
    const autoGenerate = useRef(false);
    const settled = useRef("");
    const materializing = useRef(new Set<string>());
    const reported = useRef(new Set<string>());
    // Planning (and template analysis in clone mode) always runs on the
    // administrator's model. Saved drafts keep their planned model so existing
    // plans stay valid; a new planning submission is stamped with this one.
    const adminModels = useCommerceAdminModels(config);
    const planningModel = adminModels.planningModel;
    const adminModelIssue = adminModels.problem || (adminModels.loaded ? "" : "正在读取后台指定的电商 Agent 模型，请稍后重试");
    const imageModels = useMemo(() => selectableModelsByCapability(config, "image").filter((value) => resolveModelChannel(config, value).scope === "system"), [config]);
    const imageProfile = draft.imageModel ? modelCapabilityConfigFor(config, draft.imageModel).image : undefined;
    const connectedRefs = connected.flatMap((item): EcommerceReference[] => item.resourceId ? [{ resourceId: item.resourceId, role: item.role, name: item.title }] : []);
    const previousConnectedIds = Array.isArray(node.metadata?.pluginData?.connectedReferenceIds) ? node.metadata.pluginData.connectedReferenceIds as string[] : [];
    const references = [...draft.references.filter((ref) => !previousConnectedIds.includes(ref.resourceId) && !connected.some((item) => item.resourceId === ref.resourceId)), ...connectedRefs];
    useEffect(() => {
        const current = connectedRefs.map((ref) => ref.resourceId);
        if (current.join("|") !== previousConnectedIds.join("|")) onPatch({ connectedReferenceIds: current });
    }, [connectedRefs.map((ref) => ref.resourceId).join("|"), previousConnectedIds.join("|")]);
    const count = mode === "clone" ? references.filter((ref) => ref.role === "style").length : draft.imageType === "sku" ? draft.skus.reduce((sum, sku) => sum + sku.count, 0) : draft.count;
    const workingDraft = { ...draft, count, references, ...(mode === "clone" ? { imageType: "set", noText: copyMode === "none", cloneOptions: { copyMode, ratioMode: cloneRatio } } : {}) };
    const update = <K extends keyof EcommerceDraft>(key: K, value: EcommerceDraft[K]) => {
        setDraft((current) => { const next = { ...current, [key]: value }; onPatch({ draft: next }); return next; });
    };
    const setProjectState = (value: EcommerceProject) => { projectRef.current = value; setProject(value); onPatch({ ecommerceProjectId: value.id }); };
    const save = async (nextDraft: EcommerceDraft, nextPlan: EcommercePlan | null) => {
        const current = projectRef.current;
        if (!current) throw new Error("尚未创建电商项目");
        const saved = await saveEcommerceProject(current, nextDraft, nextPlan);
        setProjectState(saved);
        return saved;
    };

    useEffect(() => {
        let active = true;
        const refresh = () => { void refreshSystemChannels().catch((error) => { if (active) setStage(`模型目录更新失败：${errorText(error)}`); }); };
        refresh();
        const timer = window.setInterval(refresh, 30_000);
        window.addEventListener("focus", refresh);
        return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
    }, []);
    useEffect(() => {
        if (!projectId) return;
        let active = true;
        void getEcommerceProject(projectId).then((value) => { if (!active) return; setProjectState(value); setDraft(projectDraft(value)); setPlan(projectPlan(value)); }).catch((error) => setStage(errorText(error)));
        return () => { active = false; };
    }, [projectId]);
    useEffect(() => {
        setDraft((current) => {
            const imageModel = imageModels.includes(current.imageModel) ? current.imageModel : imageModels.find((value) => (modelCapabilityConfigFor(config, value).image?.references.maxImages || 0) >= (mode === "clone" ? 2 : 1)) || "";
            if (current.imageModel === imageModel) return current;
            const profile = imageModel ? modelCapabilityConfigFor(config, imageModel).image : undefined;
            return { ...current, imageModel, ratio: profile?.size.default || current.ratio, resolution: profile?.resolution.supported ? profile.resolution.default : profile?.quality.default || current.resolution };
        });
    }, [config, imageModels, mode]);
    useEffect(() => {
        if ((!directMode && !planningModel) || !workingDraft.imageModel) { setQuote(null); return; }
        let active = true;
        void quoteCommerce(config, { ...workingDraft, agentModel: planningModel }, count, mode === "clone", !directMode).then((value) => { if (active) setQuote(value); }).catch((error) => { if (active) { setQuote(null); setStage(`报价失败：${errorText(error)}`); } });
        return () => { active = false; };
    }, [config, directMode, planningModel, draft.imageModel, draft.ratio, draft.resolution, count, references.map((ref) => `${ref.role}:${ref.resourceId}`).join("|")]);
    const taskIds = plan?.images.map((image) => image.taskId).filter((id): id is string => Boolean(id)) || [];
    useEffect(() => {
        if (!taskIds.length) return;
        taskIds.forEach((id) => { void queryGenerationTask(id).then((task) => setTasks((current) => ({ ...current, [id]: task }))).catch(() => undefined); });
        return subscribeGenerationTasks(taskIds, (task) => setTasks((current) => ({ ...current, [task.id]: task })));
    }, [taskIds.join("|")]);
    useEffect(() => {
        for (const id of taskIds) {
            const task = tasks[id];
            if (!task) continue;
            if (task.status === "succeeded" && !task.outputs?.some((output) => output.materializedAssetId) && !materializing.current.has(id)) {
                materializing.current.add(id);
                void materializeGenerationTaskAssets(task).then((ready) => { setTasks((current) => ({ ...current, [id]: ready })); if (project && plan) onTask(project, plan, ready); }).catch((error) => { materializing.current.delete(id); setStage(`图片保存失败：${errorText(error)}`); });
            } else if (project && plan) {
                const signature = `${id}:${task.status}:${task.outputs?.map((output) => output.materializedAssetId || "").join(",") || ""}`;
                if (!reported.current.has(signature)) { reported.current.add(signature); onTask(project, plan, task); }
            }
        }
    }, [taskIds.join("|"), tasks, project, plan]);
    useEffect(() => {
        const id = draft.planningTaskId;
        if (!id || plan || !project || settled.current === id) return;
        const finish = (task: GenerationTask) => {
            setPlanningTask(task);
            if (!terminal(task.status) || settled.current === id) return;
            settled.current = id;
            void settleCommercePlan(task, workingDraft, project).then(async (result) => {
                let finalPlan = result.plan;
                let finalProject = result.project;
                if (mode === "clone" && cloneRatio === "template") {
                    const templates = result.draft.references.filter((ref) => ref.role === "style");
                    const sizes = imageProfile?.size.values || [];
                    const resources = await Promise.all(templates.map((ref) => getResource(ref.resourceId)));
                    finalPlan = { ...finalPlan, images: finalPlan.images.map((image, index) => {
                        const resource = resources[index];
                        const ratio = resource?.width && resource?.height ? resource.width / resource.height : null;
                        const match = ratio ? sizes.find((value) => { const supported = sizeRatio(value); return supported && Math.abs(supported / ratio - 1) < .06; }) : null;
                        if (!match) throw new Error(`模板 ${index + 1} 无法匹配当前模型支持的画幅；请选择统一比例或更换模型`);
                        return { ...image, ratio: match };
                    }) };
                    finalProject = await saveEcommerceProject(finalProject, result.draft, finalPlan);
                }
                setProjectState(finalProject); setDraft(result.draft); setPlan(finalPlan); onPlan(finalProject, finalPlan);
                setStage(`策划完成 · ${finalPlan.images.length} 张方案待审阅`);
                if (autoGenerate.current && !finalPlan.uncertainFacts.length) await generate(finalPlan, result.draft, finalProject);
            }).catch((error) => {
                const next = { ...workingDraft, planningTaskId: undefined };
                setDraft(next); onPatch({ draft: next });
                void save(next, null).catch((failure) => setStage(`策划失败，保存状态也失败：${errorText(failure)}`));
                setStage(`策划失败：${errorText(error)}`);
            });
        };
        void queryGenerationTask(id).then(finish).catch((error) => setStage(errorText(error)));
        return subscribeGenerationTasks([id], finish);
    }, [draft.planningTaskId, project, plan]);

    async function upload(files: FileList | null, role: EcommerceReferenceRole) {
        if (!files?.length) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 30 * 1024 * 1024) throw new Error("只支持 30 MB 以内的 PNG、JPEG 或 WebP 图片");
                const resource = await uploadResourceFile(file, "image", { fileName: file.name });
                onUpload(resource.id, role, file.name);
            }
            setStage("图片已上传并连接到节点");
        } catch (error) { setStage(errorText(error)); }
        finally { setUploading(false); }
    }
    async function uploadSku(files: FileList | null, skuId: string) {
        const file = files?.[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 30 * 1024 * 1024) { setStage("SKU 图片仅支持 30 MB 以内的 PNG、JPEG 或 WebP"); return; }
        setUploading(true);
        try {
            const resource = await uploadResourceFile(file, "image", { fileName: file.name });
            const next = { ...draft, skus: draft.skus.map((sku) => sku.id === skuId ? { ...sku, resourceId: resource.id } : sku) };
            setDraft(next);
            onPatch({ draft: next });
            onUpload(resource.id, "sku", file.name);
            setStage("SKU 专属图片已连接，并绑定至对应规格");
        } catch (error) { setStage(errorText(error)); }
        finally { setUploading(false); }
    }
    async function generate(selectedPlan = plan, selectedDraft = workingDraft, selectedProject = projectRef.current) {
        if (!selectedPlan || !selectedProject) return;
        try { assertCommercePlanCurrent(selectedPlan, selectedDraft); } catch (error) { setStage(errorText(error)); return; }
        if (!quote) { setStage("等待服务端报价后再生成"); return; }
        setBusy(true);
        try {
            const result = await submitCommerceImages(config, selectedDraft, selectedPlan, selectedProject, (saved, next) => { setProjectState(saved); setPlan(next); onTask(saved, next); }, mode === "clone");
            setProjectState(result.project); setPlan(result.plan); setStage(`已提交 ${result.plan.images.filter((image) => image.taskId).length} / ${result.plan.images.length} 张真实图片任务`);
        } catch (error) { setStage(`提交中断：${errorText(error)}。先核对历史任务再重试，避免重复扣费。`); }
        finally { setBusy(false); }
    }
    async function planNow(direct = false) {
        if (plan?.images.some((image) => image.taskId)) { setStage("已有付费图片任务，请新建节点重新策划"); return; }
        const source = { ...workingDraft, agentModel: planningModel };
        if (!source.productName.trim() || !source.references.some((ref) => ref.role === "primary")) { setStage("请填写商品名称并上传或连接商品图片"); return; }
        if (source.references.length > 24) { setStage("参考图最多 24 张，请减少图片后再策划"); return; }
        if (mode === "clone" && (source.references.filter((ref) => ref.role === "primary").length > 7 || source.references.filter((ref) => ref.role === "style").length > 12)) { setStage("复刻最多 7 张商品图、12 张版式模板"); return; }
        if (source.count < 1 || source.count > 30) { setStage("生成数量须为 1–30 张"); return; }
        const missingTypeFact = mode === "agent" ? typeValidation(source) : null;
        if (missingTypeFact) { setStage(missingTypeFact); return; }
        if (mode === "clone" && !source.references.some((ref) => ref.role === "style")) { setStage("请上传或连接至少一张版式模板"); return; }
        if (adminModelIssue) { setStage(adminModelIssue); return; }
        if (!imageModels.includes(source.imageModel)) { setStage("请选择已配置且可用的生图模型"); return; }
        if ((imageProfile?.references.maxImages || 0) < commerceRequiredImageReferenceCount(source, mode === "clone")) { setStage("当前图片模型无法接收单张任务所需参考图，请更换支持多参考图的模型"); return; }
        const agentMaxImages = modelCapabilityConfigFor(config, planningModel).text?.references.maxImages || 0;
        if (agentMaxImages < source.references.length) { setStage(`后台指定的策划模型最多读取 ${agentMaxImages} 张图片，当前提供 ${source.references.length} 张；请减少参考图或联系管理员更换模型。`); return; }
        if (!quote) { setStage("等待服务端报价后再策划"); return; }
        autoGenerate.current = direct;
        setBusy(true);
        try {
            const result = await submitCommercePlan(config, source, projectRef.current);
            setProjectState(result.project); setDraft({ ...source, planningTaskId: result.task.id }); setPlan(null); setPlanningTask(result.task);
            setStage("Agent 正在结合参考图与补充要求构建图片方案");
        } catch (error) { setStage(`策划提交失败：${errorText(error)}`); }
        finally { setBusy(false); }
    }
    async function generateDirect() {
        if (plan?.images.some((image) => image.taskId)) { setStage("此节点已有任务，请新建节点以保留作品。"); return; }
        setBusy(true);
        try {
            const next = directCommercePlan(workingDraft);
            await quoteCommerce(config, workingDraft, count, false, false);
            const { createEcommerceProject } = await import("@/services/api/ecommerce");
            const saved = await saveEcommerceProject(projectRef.current || await createEcommerceProject(), workingDraft, next);
            setProjectState(saved); setPlan(next);
            onPlan(saved, next);
            const result = await submitCommerceImages(config, workingDraft, next, saved, (current, currentPlan) => { setProjectState(current); setPlan(currentPlan); onTask(current, currentPlan); });
            setStage(`已直接提交 ${result.plan.images.length} 张图片，未调用策划模型`);
        } catch (error) { setStage(errorText(error)); }
        finally { setBusy(false); }
    }
    async function retry(imageId: string) {
        const image = plan?.images.find((item) => item.id === imageId);
        if (!image?.taskId || !plan) return;
        setBusy(true);
        try {
            const task = await retryGenerationTask(image.taskId);
            const next = { ...plan, images: plan.images.map((item) => item.id === imageId ? { ...item, taskId: task.id } : item) };
            const saved = await save(workingDraft, next); setPlan(next); setTasks((current) => ({ ...current, [task.id]: task })); onTask(saved, next, task);
        } catch (error) { setStage(`重试状态未确认：${errorText(error)}，请先检查历史任务`); }
        finally { setBusy(false); }
    }
    const field = (label: string, key: keyof EcommerceDraft, rows = 1) => <label className="canvas-commerce-field" key={key}><span>{label}</span>{rows > 1 || key === "lockedDetails" ? <Input.TextArea autoSize={{ minRows: key === "lockedDetails" ? 5 : rows, maxRows: 14 }} value={String(draft[key] || "")} placeholder={example[key]} onChange={(event) => update(key, event.target.value as never)} /> : <Input value={String(draft[key] || "")} placeholder={example[key]} onChange={(event) => update(key, event.target.value as never)} />}</label>;
    const setPlanImage = (id: string, key: "prompt" | "copy", value: string) => setPlan((current) => current ? { ...current, images: current.images.map((image) => image.id === id ? { ...image, [key]: value } : image) } : null);
    const completed = plan?.images.filter((image) => image.taskId && tasks[image.taskId]?.status === "succeeded" && tasks[image.taskId]?.outputs?.some((output) => output.materializedAssetId)).length || 0;
    const formLocked = busy || Boolean(draft.planningTaskId && !plan) || Boolean(plan?.images.some((image) => image.taskId));
    const unlinkedReferences = draft.references.filter((ref) => !connected.some((item) => item.resourceId === ref.resourceId));
    return <section className="canvas-commerce-panel" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={mode === "clone" ? "一键复刻节点配置" : "电商 Agent 节点配置"} onMouseDown={(event) => { if (!(event.target as HTMLElement).closest(".canvas-commerce-heading") || (event.target as HTMLElement).closest("button")) event.stopPropagation(); }} onPointerDown={(event) => event.stopPropagation()}>
        <header className="canvas-commerce-heading"><div>{mode === "clone" ? <CopyCheck size={18} /> : <ShoppingBag size={18} />}<strong>{mode === "clone" ? "一键复刻" : "电商 Agent"}</strong><small>{project ? `项目 ${project.id.slice(0, 8)}` : "画布创作节点 · 拖动标题可移动"}</small></div><button type="button" aria-label="收起节点配置" onClick={onClose}><X size={18} /></button></header>
        <div className="canvas-commerce-scroll">
            <div inert={formLocked}>
            <p className="canvas-commerce-intro">{mode === "clone" ? "多张商品图与版式模板共同参考，每张模板独立生成一张。" : "连接商品图片或直接上传；可先策划，也可按自己的要求直接生成。"}</p>
            {mode === "agent" ? <label className="canvas-commerce-toggle">跳过 AI 策划，直接生成 <Switch checked={directMode} onChange={setDirectMode} /></label> : null}
            {stage ? <p className="canvas-commerce-stage" role="status">{stage}</p> : null}
            {planningPending ? <PlanningActivity key={draft.planningTaskId} task={planningTask} references={references.length} count={count} /> : null}
            {plan && plan.inputSignature !== commerceInputSignature(workingDraft) ? <p className="canvas-commerce-stage" role="status">配置或连线图片已变更，请重新策划后生成。</p> : null}
            <div className="canvas-commerce-upload-grid">{([["primary", "产品图"], ["style", mode === "clone" ? "版式模板" : "风格参考图"]] as const).map(([role, label]) => <label key={role} className="canvas-commerce-upload"><strong>{label} · {references.filter((ref) => ref.role === role).length}{mode === "clone" ? ` / ${role === "primary" ? 7 : 12}` : ""}</strong><span>上传图片，或将图片节点连线到本节点</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={uploading} onChange={(event) => { void upload(event.target.files, role); event.target.value = ""; }} /></label>)}</div>
            </div>
            {connected.length ? <div className="canvas-commerce-connected" role="group" aria-label="已连接图片节点"><strong>已连接图片节点 · {connected.length}</strong>{connected.map((item) => <div className="canvas-commerce-connected-item" key={item.nodeId}>
                <button type="button" className="canvas-commerce-preview-trigger" disabled={!item.previewUrl && !item.resourceId} aria-label={`放大查看 ${item.title}`} title={item.previewUrl || item.resourceId ? `放大查看 ${item.title}` : "图片预览暂不可用"} onClick={() => (item.resourceId || item.previewUrl) && setPreviewImage({ src: item.resourceId ? resolveResourceUrl(resourceStorageKey(item.resourceId)) : item.previewUrl!, title: item.title })}>
                    {item.resourceId ? <CachedResourceImage storageKey={resourceStorageKey(item.resourceId)} src={item.previewUrl} alt="" loading="lazy" decoding="async" draggable={false} /> : item.previewUrl ? <img src={item.previewUrl} alt="" loading="lazy" draggable={false} /> : <Images size={20} aria-hidden="true" />}
                </button>
                <div className="canvas-commerce-connected-info"><span title={item.title}>{item.title}</span>{!item.resourceId ? <small>正在保存资源或需重新上传</small> : null}</div>
                <Select size="small" aria-label={`设置 ${item.title} 的图片用途`} disabled={formLocked} value={item.role} options={roleOptions} onChange={(value) => onRole(item.nodeId, value)} />
            </div>)}</div> : null}
            {unlinkedReferences.length ? <div className="canvas-commerce-thumbs" aria-label="其他已添加参考图">{unlinkedReferences.map((ref, index) => { const src = resolveResourceUrl(resourceStorageKey(ref.resourceId)); const title = ref.name || `参考图 ${index + 1}`; return <button type="button" key={`${ref.resourceId}-${index}`} aria-label={`放大查看 ${title}`} title={title} onClick={() => setPreviewImage({ src, title })}><CachedResourceImage storageKey={resourceStorageKey(ref.resourceId)} alt="" loading="lazy" decoding="async" draggable={false} /></button>; })}</div> : null}
            <div inert={formLocked}>
            {field("商品名称", "productName")}
            {mode === "clone" ? <><label className="canvas-commerce-field"><span>文案处理</span><Select value={copyMode} options={options([["keep", "保留有依据的原文案"], ["replace", "按商品事实重写"], ["none", "不添加文字"]])} onChange={(value) => { setCopyMode(value); onPatch({ copyMode: value }); }} /></label><label className="canvas-commerce-field"><span>输出比例</span><Select value={cloneRatio} options={options([["template", "按各模板比例（需模型支持）"], ["selected", "统一使用下方比例"]])} onChange={(value) => { setCloneRatio(value); onPatch({ cloneRatio: value }); }} /></label></> : <div className="canvas-commerce-row"><label className="canvas-commerce-field"><span>平台</span><Select value={draft.platform} options={options(platforms)} showSearch optionFilterProp="label" onChange={(value) => update("platform", value)} /></label><label className="canvas-commerce-field"><span>创作类型</span><Select value={draft.imageType} options={options(imageTypes)} onChange={(value) => { const preset = ecommerceTypeConfig[value]; setDraft((current) => { const next = { ...current, imageType: value, typeOptions: {}, count: preset?.defaultCount || current.count, noText: Boolean(preset?.noText), ...(value === "white" ? { style: "white" } : {}) }; onPatch({ draft: next }); return next; }); }} /></label></div>}
            {mode === "agent" ? <div className="canvas-commerce-type-brief"><strong>{ecommerceTypeConfig[draft.imageType]?.brief}</strong>{ecommerceTypeConfig[draft.imageType]?.fields.map((key) => <label className="canvas-commerce-field" key={key}><span>{fieldLabel[key]}{ecommerceTypeConfig[draft.imageType]?.required?.includes(key) ? " · 必填" : ""}</span><Input.TextArea autoSize={{ minRows: key === "lockedDetails" ? 5 : key === "claims" || key === "scene" ? 2 : 1, maxRows: 12 }} value={draft[key]} placeholder={example[key]} onChange={(event) => update(key, event.target.value)} /></label>)}{field("补充要求 · 指定文案、顺序、角度与尺寸展示", "instruction", 6)}</div> : null}
            {mode === "agent" ? <CreationOptions draft={draft} className="canvas-commerce-field" onChange={(value) => update("typeOptions", value)} /> : null}
            <div className="canvas-commerce-row"><label className="canvas-commerce-field"><span>{mode === "clone" ? "模板数量 / 输出张数" : "生成数量"}</span><InputNumber min={1} max={30} precision={0} value={count} disabled={mode === "clone" || draft.imageType === "sku"} onChange={(value) => update("count", value || 1)} /></label><label className="canvas-commerce-field"><span>输出语言</span><Select value={draft.language} options={options(languages)} onChange={(value) => update("language", value)} /></label></div>
            <label className="canvas-commerce-field"><span>图片生成模型</span><ModelPicker config={config} capability="image" value={draft.imageModel} onChange={(value) => { const profile = modelCapabilityConfigFor(config, value).image; setDraft((current) => { const next = { ...current, imageModel: value, ratio: profile?.size.default || current.ratio, resolution: profile?.resolution.supported ? profile.resolution.default : profile?.quality.default || current.resolution }; onPatch({ draft: next }); return next; }); }} modelFilter={(value) => imageModels.includes(value)} requirements={{ input: { textCount: 1, imageCount: mode === "clone" ? Math.max(2, references.filter((ref) => ref.role === "primary").length + 1) : Math.max(1, references.length), referenceImageCount: mode === "clone" ? Math.max(2, references.filter((ref) => ref.role === "primary").length + 1) : Math.max(1, references.length), videoCount: 0, audioCount: 0, characterCount: 0 } }} fullWidth showOptionPrices /></label>
            <div className="canvas-commerce-row"><label className="canvas-commerce-field"><span>画幅比例 / 尺寸</span><Select value={draft.ratio} options={(imageProfile?.size.values || []).map((value) => ({ value, label: imageSizeLabel(value) }))} onChange={(value) => update("ratio", value)} /></label><label className="canvas-commerce-field"><span>画质 / 分辨率</span><Select value={draft.resolution} options={(imageProfile?.resolution.supported ? imageProfile.resolution.values : [imageProfile?.quality.default || "auto"]).map((value) => ({ value, label: value }))} onChange={(value) => update("resolution", value)} /></label></div>
            <Button type="text" block onClick={() => setAdvanced((value) => !value)}>{advanced ? "收起高级参数" : "展开全部电商参数"}</Button>
            {advanced ? <Collapse ghost defaultActiveKey={["facts"]} items={[
                { key: "facts", label: "商品事实与品牌", children: <div className="canvas-commerce-stack">{field("分类", "category")}{field("品牌", "brand")}{field("商品简介", "description", 2)}{field("已确认的卖点", "claims", 2)}{field("产品颜色", "colors")}{field("已确认的材质", "materials")}{field("规格参数", "specifications", 2)}{field("尺寸", "dimensions")}{field("包装与配件", "packaging", 2)}{field("禁止修改的产品细节", "lockedDetails", 2)}</div> },
                { key: "market", label: "市场与商业风格", children: <div className="canvas-commerce-stack">{field("目标用户", "audience")}{field("使用场景", "scene")}{field("价格定位", "pricePosition")}<label className="canvas-commerce-field"><span>视觉风格</span><Select value={draft.style} options={options(styles)} onChange={(value) => update("style", value)} /></label>{field("自定义风格提示", "stylePrompt", 2)}<label className="canvas-commerce-field"><span>商品保真</span><Select value={draft.fidelity} options={options([["strict", "严格保真"], ["standard", "标准保真"], ["creative", "创意增强"]])} onChange={(value) => update("fidelity", value)} /></label><label className="canvas-commerce-toggle">不添加文字 <Switch checked={draft.noText} onChange={(value) => update("noText", value)} /></label></div> },
                { key: "sku", label: `SKU 管理 · ${draft.skus.length}`, children: <div className="canvas-commerce-stack">{draft.skus.map((sku, index) => <div className="canvas-commerce-sku" key={sku.id}><Input placeholder="SKU 名称" value={sku.name} onChange={(event) => update("skus", draft.skus.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /><Input placeholder="颜色" value={sku.color} onChange={(event) => update("skus", draft.skus.map((item, i) => i === index ? { ...item, color: event.target.value } : item))} /><Input placeholder="规格" value={sku.spec} onChange={(event) => update("skus", draft.skus.map((item, i) => i === index ? { ...item, spec: event.target.value } : item))} /><Input placeholder="包装方式" value={sku.packaging} onChange={(event) => update("skus", draft.skus.map((item, i) => i === index ? { ...item, packaging: event.target.value } : item))} /><Input placeholder="专属卖点" value={sku.claims} onChange={(event) => update("skus", draft.skus.map((item, i) => i === index ? { ...item, claims: event.target.value } : item))} /><InputNumber min={0} max={30} value={sku.count} onChange={(value) => update("skus", draft.skus.map((item, i) => i === index ? { ...item, count: value || 0 } : item))} /><Button size="small" onClick={() => update("skus", draft.skus.filter((_, i) => i !== index))}>移除</Button></div>)}<Button onClick={() => update("skus", [...draft.skus, { id: createClientUUID(), name: "", color: "", spec: "", packaging: "", claims: "", price: "", count: 1 }])}>添加 SKU</Button></div> },
                { key: "more", label: "更多参考图", children: <div className="canvas-commerce-stack">{([["detail", "商品细节"], ["sku", "SKU 图片"], ["logo", "品牌 Logo"], ["package", "包装图"]] as const).map(([role, label]) => <label className="canvas-commerce-upload" key={role}><strong>{label}</strong><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { void upload(event.target.files, role); event.target.value = ""; }} /></label>)}</div> },
            ]} /> : null}
            {advanced && draft.imageType === "sku" && mode === "agent" ? <div className="canvas-commerce-stack">{draft.skus.map((sku) => <label className="canvas-commerce-field" key={sku.id}><span>{sku.name || "未命名 SKU"} · {sku.resourceId ? "已绑定专属参考图" : "上传专属参考图"}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => { void uploadSku(event.target.files, sku.id); event.target.value = ""; }} /></label>)}</div> : null}
            {mode === "clone" ? field("商品信息 / 复刻要求", "instruction", 6) : null}
            {plan ? <div className="canvas-commerce-plan"><strong>已策划 {plan.images.length} 张 · 已完成 {completed} 张</strong><p>{plan.productSummary}</p><CommerceFactReview facts={plan.uncertainFacts} onApply={(verified) => {
                const next = reviseCommerceFacts(workingDraft, plan.uncertainFacts, verified);
                setDraft(next); setPlan(null); onPatch({ draft: next }); setStage("真实资料已更新，请重新策划");
                void save(next, null).catch((error) => setStage(errorText(error)));
            }} onExclude={() => { setPlan(excludeCommerceFacts(plan)); setStage("未核实主张已作为逐图排除约束，请审阅提示词后生成"); }} />{plan.images.map((image, index) => <details key={image.id}><summary>图 {index + 1} · {image.theme} · {image.taskId ? tasks[image.taskId]?.status || "已提交" : "待生成"}</summary><label>提示词<Input.TextArea rows={4} value={image.prompt} disabled={Boolean(image.taskId)} onChange={(event) => setPlanImage(image.id, "prompt", event.target.value)} /></label><label>文案<Input value={image.copy} disabled={Boolean(image.taskId)} onChange={(event) => setPlanImage(image.id, "copy", event.target.value)} /></label>{image.taskId && ["failed", "cancelled"].includes(tasks[image.taskId]?.status || "") ? <Button size="small" disabled={busy} onClick={() => void retry(image.id)}>重试这张</Button> : null}</details>)}</div> : null}
            </div>
        </div>
        <footer className="canvas-commerce-footer">
            <p>已选 {count} / 30 张 · 策划 <RollingCreditAmount value={quote?.agent ?? null} />{quote ? " 积分" : "待报价"} · 单图 <RollingCreditAmount value={quote?.image ?? null} />{quote ? " 积分" : "待报价"} · 总预估 <RollingCreditAmount value={quote?.total ?? null} />{quote ? " 积分" : "待服务端报价"}</p>
            <small>实际扣费以服务端任务结算为准；生成任务逐张提交，失败可单独重试。</small>
            <div>
                <Button icon={<Sparkles size={15} />} loading={busy || planningPending} disabled={directMode || uploading} onClick={() => { if (!planningPending) void planNow(false); }}>{planningPending ? "Agent 正在策划…" : mode === "clone" ? "AI 分析模板" : "AI 一键策划"}</Button>
                {mode === "agent" ? <Button disabled={busy || uploading} onClick={() => { setAdvanced(true); document.querySelector(".canvas-commerce-panel .canvas-commerce-scroll")?.scrollTo({ top: 10000, behavior: "smooth" }); }}>自定义策划</Button> : null}
                {directMode ? <Button type="primary" disabled={busy || uploading || Boolean(draft.planningTaskId) || Boolean(plan?.images.some((image) => image.taskId))} onClick={() => void generateDirect()}>直接生成 {count} 张</Button> : plan ? <GenerationConfirmation plan={plan} draft={workingDraft} busy={busy} completed={plan.images.every((image) => Boolean(image.taskId))} label={mode === "clone" ? `一键复刻（${plan.images.length} 张）` : undefined} onSupplement={(verified) => { const next = reviseCommerceFacts(workingDraft, plan.uncertainFacts, verified); setDraft(next); setPlan(null); onPatch({ draft: next }); void save(next, null).catch((error) => setStage(errorText(error))); }} onConfirm={async (reviewed) => { const saved = await save(workingDraft, reviewed); setPlan(reviewed); await generate(reviewed, workingDraft, saved); }} /> : <Button type="primary" disabled={busy || uploading || Boolean(draft.planningTaskId)} onClick={() => void planNow(true)}>{mode === "clone" ? "分析并直接复刻" : "策划并生成"}</Button>}
                {project ? <Button icon={<ArrowUpRight size={15} />} onClick={() => onWorkbench(project.id)}>工作台编辑</Button> : null}
            </div>
        </footer>
        <Modal className="canvas-commerce-image-preview" open={Boolean(previewImage)} title={previewImage?.title} footer={null} centered width="min(92vw, 980px)" onCancel={() => setPreviewImage(null)} destroyOnHidden>{previewImage ? <img src={previewImage.src} alt={previewImage.title} /> : null}</Modal>
    </section>;
}
