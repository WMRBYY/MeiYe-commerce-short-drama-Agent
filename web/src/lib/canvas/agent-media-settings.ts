import type { AgentMediaSettings } from "@/services/api/agent";

// Tool arguments also contain prompt and canvas references. Approval accepts only editable media fields.
export function agentEditableMediaSettings(settings: AgentMediaSettings): AgentMediaSettings {
    return {
        logicalModelId: settings.logicalModelId,
        channelId: settings.channelId,
        channelModelKey: settings.channelModelKey,
        size: settings.size,
        imageResolution: settings.imageResolution,
        imageParameters: settings.imageParameters,
        quality: settings.quality,
        durationSeconds: settings.durationSeconds,
        videoGenerateAudio: settings.videoGenerateAudio,
        videoWatermark: settings.videoWatermark,
        videoArkPrivateAssetUpload: settings.videoArkPrivateAssetUpload,
    };
}
