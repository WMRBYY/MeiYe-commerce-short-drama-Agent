import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { useState } from "react";
import { Tooltip } from "antd";
import { SHOP_CANVAS_TOOLS, type ShopCanvasTool } from "./shop-canvas-catalog";

export function commerceNextActions(kind?: string, type?: string) {
    const video = type === "video" || ["video-replace", "product-video", "video-upscale", "video-subtitle"].includes(kind || "");
    return video
        ? { primary: ["product-video", "text", "video-replace", "video-upscale", "video-subtitle"], more: [] }
        : { primary: ["chat", "text", "outfit", "pose", "upscale", "repaint", "model-views", "product-video"], more: ["scene", "face-swap", "inpaint", "background", "smart-head", "cutout", "video-replace", "smart-face", "print", "noise", "color"] };
}

export function ShopCanvasNextActions({ kind, type, onAdd }: { kind?: string; type?: string; onAdd: (tool: ShopCanvasTool) => void }) {
    const [more, setMore] = useState(false);
    const actions = commerceNextActions(kind, type);
    const rows = (ids: string[]) =>
        ids.map((id) => {
            const tool = SHOP_CANVAS_TOOLS.find((item) => item.id === id)!;
            return (
                <Tooltip key={id} title={tool.description} placement="right">
                    <button disabled={tool.comingSoon} onClick={() => onAdd(tool)}>
                        <span className="sp-action-glyph">
                            <ShopCanvasGlyph name={tool.id} size={17} />
                        </span>
                        <strong>{tool.label}</strong>
                        {tool.comingSoon ? <small>敬请期待</small> : <ShopCanvasGlyph name="chevron" size={12} className="sp-action-arrow" />}
                    </button>
                </Tooltip>
            );
        });
    return (
        <div className="sp-next-actions" data-more={more || undefined}>
            <div className="sp-next-actions-column" data-canvas-wheel-scroll>
                {rows(actions.primary)}
                {actions.more.length ? (
                    <button className="sp-next-actions-more" aria-expanded={more} onClick={() => setMore(!more)}>
                        <strong>{more ? "收起更多" : "更多功能"}</strong>
                        <small>{actions.more.length}</small>
                        <ShopCanvasGlyph name="more" size={17} />
                    </button>
                ) : null}
            </div>
            {more && actions.more.length ? (
                <div className="sp-next-actions-column sp-next-actions-extra" data-canvas-wheel-scroll>
                    <h3>更多功能</h3>
                    {rows(actions.more)}
                </div>
            ) : null}
        </div>
    );
}
