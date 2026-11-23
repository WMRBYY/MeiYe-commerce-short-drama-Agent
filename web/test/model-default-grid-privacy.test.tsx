import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelDefaultGrid, modelDefaultChannelName } from "../src/pages/settings/model-default-grid";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import { useUserStore } from "../src/stores/use-user-store";

test("model settings hide system channel names for users and keep the system price", () => {
    const channel = createModelChannel({
        id: "system-video",
        name: "Lec API",
        scope: "system",
        models: ["video-test"],
        modelCosts: [{ model: "video-test", displayName: "Video Test", capability: "video", billingMode: "per_second", unitPriceMicrocredits: 300_000 }],
    });
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], videoModel: "system-video::video-test" } }).config;
    const render = () => renderToStaticMarkup(<ModelDefaultGrid config={config} onChange={() => {}} />);

    useUserStore.getState().setUser({ id: "user", username: "user", displayName: "用户", role: "user", status: "active" });
    const userMarkup = render();
    expect(userMarkup).not.toContain("Lec API");
    expect(userMarkup).toContain("线路 1");
    expect(userMarkup).toContain("系统");
    expect(userMarkup).toContain("0.3");

    expect(modelDefaultChannelName(channel, false)).toBeNull();
    expect(modelDefaultChannelName(channel, true)).toBe("Lec API");
    useUserStore.getState().setUser(null);
});
