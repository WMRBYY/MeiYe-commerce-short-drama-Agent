import { describe, expect, it } from "bun:test";
import { AGENT_APPROVAL_SUPERSEDED_BY_NODE, agentApprovalMatchesSettings, agentApprovalModel, agentApprovalModelSelection, agentApprovalTargetGenerating, agentImageApproval, agentImageApprovalExtraParameters, agentImageApprovalRequirements, agentImageApprovalSizeSelection, agentMediaApprovalTargetNodeId, agentMediaSettings, agentVideoApproval } from "../src/lib/canvas/agent-media-approval";
import { agentEditableMediaSettings } from "../src/lib/canvas/agent-media-settings";
import { requestCreditCost } from "../src/lib/model-pricing";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { CanvasNodeData } from "../src/types/canvas";
import { createModelChannel, defaultConfig, encodeChannelModel, normalizeConfigSnapshot } from "../src/stores/use-config-store";

describe("image generation approval settings", () => {
    const args = { mode: "image", prompt: "保持参考图产品外观", size: "1024x1024", quality: "high", channelId: "platform", channelModelKey: "gpt-image-2", referenceNodeIds: ["product"] };
    it("reads both SSE approval requests and restored run snapshots", () => {
        const event = agentImageApproval({ toolName: "generate_media", arguments: args });
        const restored = agentImageApproval({ call: { function: { name: "generate_media", arguments: JSON.stringify(args) } } });
        expect(event).toEqual(restored);
        expect(restored?.referenceNodeIds).toEqual(["product"]);
        expect(restored?.quality).toBe("high");
    });
    it("does not enable image settings for other tools or invalid arguments", () => {
        expect(agentImageApproval({ toolName: "canvas_apply_ops", arguments: args })).toBeNull();
        expect(agentImageApproval({ toolName: "generate_media", arguments: { ...args, mode: "video" } })).toBeNull();
        expect(agentImageApproval({ toolName: "generate_media", arguments: "{" })).toBeNull();
    });
    it("does not treat another tab's different approval settings as a successful retry", () => {
        expect(agentApprovalMatchesSettings(args, args)).toBe(true);
        expect(agentApprovalMatchesSettings(args, { ...args, quality: "low" })).toBe(false);
        expect(agentApprovalMatchesSettings({ ...args, imageResolution: "2k" }, { ...args, imageResolution: "4k" })).toBe(false);
        expect(agentApprovalMatchesSettings(args, { logicalModelId: "other", size: args.size, quality: args.quality })).toBe(false);
    });
    it("updates pixel size and resolution together and prices the selected tier", () => {
        const cost = {
            model: "gpt-image-2", capability: "image" as const, pricePolicy: "channel" as const, billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 80_000, priceConfigured: true,
            capabilityConfig: { ...defaultModelCapabilityConfig(), image: {
                ...defaultModelCapabilityConfig().image!,
                parameters: [{ name: "imageResolution", label: "分辨率", type: "string", values: ["1k", "2k", "4k"], default: "1k", pricing: true }],
            } },
            logicalPriceTiers: [["1k", 80_000], ["2k", 160_000], ["4k", 300_000]].map(([resolution, microcredits]) => ({
                selector: { imageResolution: String(resolution) }, resolution: "*", videoSeconds: 0, billingMode: "fixed_request" as const,
                unitPriceMicrocredits: Number(microcredits), inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0,
            })),
        };
        const model = "platform::gpt-image-2";
        const config = normalizeConfigSnapshot({ config: { ...defaultConfig, imageModel: model, channels: [createModelChannel({ id: "platform", scope: "system", models: [cost.model], modelCosts: [cost] })] } }).config;
        const initial = { channelId: "platform", channelModelKey: cost.model, size: "1824x1024", imageResolution: "1k", quality: "" };
        for (const [resolution, size, price] of [["1k", "1824x1024", 0.08], ["2k", "2752x1536", 0.16], ["4k", "3840x2160", 0.3]] as const) {
            const selected = agentImageApprovalSizeSelection(initial, size, undefined, resolution);
            expect(selected).toMatchObject({ size, imageResolution: resolution });
            const requirements = agentImageApprovalRequirements(selected, 0);
            expect(requirements.options).toMatchObject({ size, imageResolution: resolution });
            expect(requestCreditCost({ channelMode: "remote", modelCosts: config.channels[0].modelCosts, model: cost.model, modelValue: model, capability: "image", config, requirements, count: 1 })).toBe(price);
        }
    });
    it("removes stale host controls from nested image parameters before approval", () => {
        const previous = { size: "1824x1024", imageResolution: "1k", quality: "", imageParameters: '{"size":"1024x1024","imageResolution":"1k","count":1,"outputFormat":"png"}' };
        const next = agentImageApprovalSizeSelection(previous, "2752x1536", undefined, "2k");
        expect(next).toMatchObject({ size: "2752x1536", imageResolution: "2k" });
        expect(JSON.parse(next.imageParameters!)).toEqual({ outputFormat: "png" });
        expect(agentImageApprovalExtraParameters('{"size":"1024x1024","imageResolution":"1k","count":1}')).toBeUndefined();
    });
    it("does not send prompt or canvas references when image resolution changes", () => {
        const initial = agentImageApproval({ toolName: "generate_media", arguments: { ...args, imageResolution: "1k" } })!;
        const selected = agentImageApprovalSizeSelection(initial, "2752x1536", undefined, "2k");
        expect(selected).toMatchObject({ size: "2752x1536", imageResolution: "2k" });
        expect(JSON.stringify(selected)).not.toContain('"prompt"');
        expect(JSON.stringify(selected)).not.toContain('"referenceNodeIds"');
        expect(JSON.stringify(agentEditableMediaSettings(initial))).not.toContain('"prompt"');
    });
    it("switches between logical and channel models without retaining the previous selector", () => {
        const cost = { model: "gpt-image-2", capability: "image" as const, billingMode: "fixed_request" as const, unitPriceMicrocredits: 1, priceConfigured: true };
        const config = {
            ...defaultConfig,
            channels: [
                createModelChannel({ id: "platform", scope: "system", models: [cost.model], modelCosts: [cost] }),
                createModelChannel({ id: "managed", scope: "system", models: [cost.model], modelCosts: [{ ...cost, logicalModelId: "logical-image" }] }),
                createModelChannel({ id: "personal", scope: "custom", models: [cost.model], modelCosts: [cost] }),
            ],
        };
        const logical = agentApprovalModelSelection(config, encodeChannelModel("managed", cost.model));
        expect(logical).toEqual({ logicalModelId: "logical-image" });
        expect(agentApprovalModel(config, { ...logical, size: args.size, quality: args.quality })).toBe(encodeChannelModel("managed", cost.model));
        const channel = agentApprovalModelSelection(config, encodeChannelModel("platform", cost.model));
        expect(channel).toEqual({ channelId: "platform", channelModelKey: cost.model });
        expect(agentApprovalModel(config, { ...channel, size: args.size, quality: args.quality })).toBe(encodeChannelModel("platform", cost.model));
        expect(() => agentApprovalModelSelection(config, encodeChannelModel("personal", cost.model))).toThrow("平台模型");
        expect(agentApprovalModel(config, { logicalModelId: "removed", size: args.size, quality: args.quality })).toBe("");
    });
});

describe("video generation approval settings", () => {
    it("reads video duration and audio options", () => {
        const approval = agentVideoApproval({
            toolName: "generate_media",
            arguments: { mode: "video", prompt: "镜头运动", size: "9:16", quality: "720p", durationSeconds: 8, videoGenerateAudio: true, channelId: "platform", channelModelKey: "seedance-test", referenceNodeIds: ["image"] },
        });
        expect(approval?.durationSeconds).toBe(8);
        expect(approval?.videoGenerateAudio).toBe(true);
        expect(approval?.referenceNodeIds).toEqual(["image"]);
    });
    it("keeps video options but excludes prompt and references from approval settings", () => {
        const initial = agentVideoApproval({ toolName: "generate_media", arguments: { mode: "video", prompt: "镜头运动", size: "9:16", quality: "720p", durationSeconds: 8, videoGenerateAudio: true, channelId: "platform", channelModelKey: "seedance-test", referenceNodeIds: ["image"] } })!;
        const selected = agentEditableMediaSettings(initial);
        expect(selected).toMatchObject({ size: "9:16", durationSeconds: 8, videoGenerateAudio: true });
        expect(JSON.stringify(selected)).not.toContain('"prompt"');
        expect(JSON.stringify(selected)).not.toContain('"referenceNodeIds"');
    });
});

describe("approval media settings sent back to the backend", () => {
    const mediaKeys = ["channelId", "channelModelKey", "durationSeconds", "imageParameters", "imageResolution", "logicalModelId", "quality", "size", "videoArkPrivateAssetUpload", "videoGenerateAudio", "videoWatermark"];

    it("drops prompt and reference nodes that the decision API rejects", () => {
        const approval = agentVideoApproval({
            toolName: "generate_media",
            arguments: {
                mode: "video",
                prompt: "镜头运动",
                size: "9:16",
                quality: "720p",
                durationSeconds: 8,
                channelId: "platform",
                channelModelKey: "seedance-test",
                referenceNodeIds: ["image"],
                referenceTransientIds: ["tmp-image"],
                sourceNodeId: "shot-1",
            },
        });
        expect(approval).not.toBeNull();
        const settings = agentMediaSettings(approval!);
        expect(Object.keys(settings).sort()).toEqual(mediaKeys);
        expect(JSON.stringify(settings)).not.toContain("prompt");
        expect(settings.durationSeconds).toBe(8);
        expect(settings.channelModelKey).toBe("seedance-test");
    });

    it("keeps image settings without leaking prompt or reference nodes", () => {
        const approval = agentImageApproval({ toolName: "generate_media", arguments: { mode: "image", prompt: "产品图", size: "1024x1024", quality: "high", channelId: "platform", channelModelKey: "gpt-image-2", referenceNodeIds: ["product"] } });
        expect(approval).not.toBeNull();
        const settings = agentMediaSettings(approval!);
        expect(Object.keys(settings).sort()).toEqual(mediaKeys);
        expect(settings.size).toBe("1024x1024");
        expect(settings.quality).toBe("high");
        expect(settings.channelModelKey).toBe("gpt-image-2");
    });
});

describe("approval target already generating on the canvas", () => {
    const detail = { toolName: "generate_media", arguments: JSON.stringify({ mode: "image", prompt: "p", size: "1:1", nodeId: "draft-1" }) };
    const node = (metadata: Record<string, unknown>) => ({ id: "draft-1", type: "image", title: "开场分镜", position: { x: 0, y: 0 }, width: 200, height: 200, metadata }) as unknown as CanvasNodeData;

    it("reads the target node from SSE events and restored snapshots", () => {
        expect(agentMediaApprovalTargetNodeId(detail)).toBe("draft-1");
        expect(agentMediaApprovalTargetNodeId({ call: { function: { name: "generate_media", arguments: detail.arguments } } })).toBe("draft-1");
        expect(agentMediaApprovalTargetNodeId({ toolName: "canvas_apply_ops", arguments: detail.arguments })).toBe("");
        expect(agentMediaApprovalTargetNodeId({ toolName: "generate_media", arguments: "{" })).toBe("");
    });

    it("blocks approval only while the same node is generating", () => {
        expect(agentApprovalTargetGenerating(detail, [node({ status: "idle" })])).toBeUndefined();
        expect(agentApprovalTargetGenerating(detail, [node({ status: "loading" })])?.id).toBe("draft-1");
        expect(agentApprovalTargetGenerating(detail, [node({ taskId: "t1", taskStatus: "running" })])?.id).toBe("draft-1");
        expect(agentApprovalTargetGenerating(detail, [node({ status: "idle" })], "draft-1")?.id).toBe("draft-1");
        expect(agentApprovalTargetGenerating(detail, [{ ...node({ status: "loading" }), id: "other" }])).toBeUndefined();
        expect(agentApprovalTargetGenerating(detail, undefined)).toBeUndefined();
    });

    it("uses the same decision value as the backend", () => {
        expect(AGENT_APPROVAL_SUPERSEDED_BY_NODE).toBe("superseded_by_node");
    });
});

describe("batch generation approval settings", () => {
    it("shows model settings for image batches in live events and restored approvals", () => {
        const args = { mode: "image", channelId: "platform", channelModelKey: "image-model", size: "1:1", quality: "high", items: [{ nodeId: "batch-node", prompt: "第一行" }] };
        const live = agentImageApproval({ toolName: "generate_media_batch", arguments: args });
        const restored = agentImageApproval({ call: { function: { name: "generate_media_batch", arguments: JSON.stringify(args) } } });
        expect(live).not.toBeNull();
        expect(live).toEqual(restored);
        expect(live?.channelModelKey).toBe("image-model");
        expect(agentMediaSettings(live!)).not.toHaveProperty("items");
        expect(agentApprovalMatchesSettings(args, agentMediaSettings(live!))).toBe(true);
        expect(agentApprovalMatchesSettings(args, { ...agentMediaSettings(live!), channelModelKey: "other" })).toBe(false);
    });
    it("reads batch video defaults without requiring a shared prompt", () => {
        const result = agentVideoApproval({ toolName: "generate_media_batch", arguments: { mode: "video", logicalModelId: "video-model", durationSeconds: 8, items: [{ nodeId: "a" }, { nodeId: "b" }] } });
        expect(result?.logicalModelId).toBe("video-model");
        expect(result?.durationSeconds).toBe(8);
        expect(result?.size).toBe("");
    });
    it("does not offer media settings for empty or non-image/video batches", () => {
        expect(agentImageApproval({ toolName: "generate_media_batch", arguments: { mode: "image", items: [] } })).toBeNull();
        expect(agentVideoApproval({ toolName: "generate_media_batch", arguments: { mode: "audio", items: [{ nodeId: "a" }] } })).toBeNull();
    });
});
