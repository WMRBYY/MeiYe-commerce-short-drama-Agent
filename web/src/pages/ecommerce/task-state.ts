import type { GenerationTask } from "@/services/api/task-center";

export function mergeCommerceTask(incoming: GenerationTask, previous?: GenerationTask): GenerationTask {
    // Batch checks and subscriptions can finish out of order. A user retry has
    // a newer updatedAt and must still be allowed to reopen the same task ID.
    if (previous && Date.parse(incoming.updatedAt) < Date.parse(previous.updatedAt)) return previous;
    return {
        ...incoming,
        outputs: incoming.outputs?.map((output) => ({ ...output, materializedAssetId: output.materializedAssetId || previous?.outputs?.find((item) => item.outputIndex === output.outputIndex)?.materializedAssetId })) || previous?.outputs,
    };
}
