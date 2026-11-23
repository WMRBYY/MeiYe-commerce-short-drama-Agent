import { expect, test } from "bun:test";
import { agentApprovalMatchesSettings } from "../src/lib/canvas/agent-media-approval";

const args = {
    mode: "image",
    prompt: "保留产品外观",
    size: "2752x1536",
    quality: "high",
    imageResolution: "2k",
    imageParameters: '{"outputFormat":"png"}',
    channelId: "platform",
    channelModelKey: "gpt-image-2",
};

test("Agent approval retry requires the exact priced image resolution and parameters", () => {
    expect(agentApprovalMatchesSettings(args, args)).toBe(true);
    expect(agentApprovalMatchesSettings(args, { ...args, imageResolution: "4k" })).toBe(false);
    expect(agentApprovalMatchesSettings(args, { ...args, imageParameters: '{"outputFormat":"webp"}' })).toBe(false);
});
