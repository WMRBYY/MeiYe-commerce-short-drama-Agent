import type { WorkbenchReference } from "./workbench-composer";

export type WorkbenchVideoNodeDraft = {
    prompt: string;
    submittedPrompt?: string;
    model: string;
    ratio: string;
    seconds: string;
    resolution: string;
    audio: boolean;
    watermark: boolean;
    references: Array<Pick<WorkbenchReference, "id" | "name" | "kind" | "role"> & { resourceId: string }>;
};
