import { expect, test } from "bun:test";
import { modeFromPath } from "../src/stores/use-workspace-mode-store";
import { useShopAgentStore } from "../src/pages/shop/shop-agent-store";

test("all ecommerce routes choose ecommerce assistant; creative and drama remain separate", () => {
    for (const path of ["/shop", "/shop/image", "/shop/detail", "/shop/canvas", "/shop/canvas/project-1", "/shop/video", "/shop/script"]) expect(modeFromPath(path)).toBe("ecommerce");
    expect(modeFromPath("/drama")).toBe("drama");
    expect(modeFromPath("/")).toBe("create");
    expect(modeFromPath("/canvas/project-1")).toBeNull();
});

test("closing ecommerce assistant preserves its prepared prompt", () => {
    useShopAgentStore.getState().prepare("为这款产品策划主图");
    expect(useShopAgentStore.getState().open).toBe(true);
    useShopAgentStore.getState().setOpen(false);
    expect(useShopAgentStore.getState().prompt).toBe("为这款产品策划主图");
    useShopAgentStore.setState({ open: false, prompt: "" });
});
