import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createCanvasProjectWithRemoteSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { flushCanvasStorePersistence } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 短剧首页交给画布的一次启动：画布加载完（素材转入完）后由画布页消费，只执行一次。 */
export type DramaCanvasLaunch = {
    key: string;
    kind: "agent" | "image" | "video";
    /** agent：作为画布助手首条消息自动发送；image/video：目标节点的提示词。 */
    prompt: string;
    /** image/video：要直接开始生成的节点。 */
    nodeId?: string;
    /** 本次上传、已转入画布的素材；image/video 模式下连到目标节点作参考。 */
    assetIds: string[];
};

export const DRAMA_LAUNCH_STATE_KEY = "dramaLaunch";

export function readDramaLaunch(state: unknown): DramaCanvasLaunch | undefined {
    if (!state || typeof state !== "object") return undefined;
    const value = (state as Record<string, unknown>)[DRAMA_LAUNCH_STATE_KEY];
    if (!value || typeof value !== "object") return undefined;
    const launch = value as Partial<DramaCanvasLaunch>;
    if (typeof launch.key !== "string" || typeof launch.prompt !== "string") return undefined;
    if (launch.kind !== "agent" && launch.kind !== "image" && launch.kind !== "video") return undefined;
    return {
        key: launch.key,
        kind: launch.kind,
        prompt: launch.prompt,
        nodeId: typeof launch.nodeId === "string" ? launch.nodeId : undefined,
        assetIds: Array.isArray(launch.assetIds) ? launch.assetIds.filter((id): id is string => typeof id === "string") : [],
    };
}

export type DramaGenerationSpec = {
    model: string;
    ratio: string;
    resolution: string;
    seconds?: number;
};

/** 建一张新画布并给出跳转地址与状态；image/video 模式预置一个带模型参数的生成节点。 */
export async function createDramaCanvas(input: { title: string; kind: DramaCanvasLaunch["kind"]; prompt: string; agentPrompt: string; spec?: DramaGenerationSpec; assetIds: string[] }) {
    let target: CanvasNodeData | undefined;
    if (input.kind !== "agent" && input.spec) {
        const type = input.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
        target = createCanvasNode(
            type,
            { x: 520, y: 0 },
            {
                prompt: input.prompt,
                composerContent: input.prompt,
                generationMode: input.kind,
                model: input.spec.model,
                size: input.spec.ratio || undefined,
                ...(input.kind === "image"
                    ? { imageResolution: input.spec.resolution || undefined, imageSizeSource: "user" as const }
                    : { vquality: input.spec.resolution ? input.spec.resolution.replace(/p$/i, "") : undefined, seconds: input.spec.seconds ? String(input.spec.seconds) : undefined }),
            },
        );
    }
    if (input.assetIds.length) await saveRemoteUserDataNow([]);
    const { id, syncError } = await createCanvasProjectWithRemoteSync(input.title, undefined, target ? { nodes: [target], connections: [] } : undefined);
    await flushCanvasStorePersistence();
    const params = new URLSearchParams();
    if (input.kind === "agent") params.set("agent", "1");
    if (input.assetIds.length) {
        params.set("mode", "handoff");
        input.assetIds.forEach((assetId) => params.append("asset", assetId));
    }
    const launch: DramaCanvasLaunch = {
        key: `${id}:${Date.now()}`,
        kind: input.kind,
        prompt: input.kind === "agent" ? input.agentPrompt : input.prompt,
        nodeId: target?.id,
        assetIds: input.assetIds,
    };
    const query = params.toString();
    return { path: `/canvas/${encodeURIComponent(id)}${query ? `?${query}` : ""}`, state: { [DRAMA_LAUNCH_STATE_KEY]: launch }, syncError };
}
