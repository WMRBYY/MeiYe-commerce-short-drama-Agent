import { Select } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import "./shop-canvas-fonts.css";
import { ShopNodeToolbar } from "./shop-node-toolbar";

export function ShopCanvasTextTools({ layer, onChange, onEdit }: { layer: CanvasLayer; onChange: (patch: Partial<CanvasLayer>) => void; onEdit: () => void }) {
    const download = () => {
        const url = URL.createObjectURL(new Blob([layer.text || ""], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "画布文案.txt";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
        <ShopNodeToolbar className="sp-text-tools" label="文案格式">
            <Tooltip title="编辑文案">
                <button aria-label="编辑文案" onClick={onEdit}>
                    <ShopCanvasGlyph name="edit" size={16} />
                </button>
            </Tooltip>
            <Select
                aria-label="字体"
                className="sp-text-font-select"
                variant="filled"
                size="small"
                popupMatchSelectWidth={180}
                classNames={{ popup: { root: "ms-scope sp-text-format-popup" } }}
                value={layer.fontFamily || "sans-serif"}
                onChange={(fontFamily) => onChange({ fontFamily })}
                options={[
                    { value: "Commerce Sans", label: "霞鹜文楷" },
                    { value: "Commerce Serif", label: "思源宋体" },
                    { value: "sans-serif", label: "系统黑体" },
                ]}
            />
            <Select
                aria-label="字重"
                className="sp-text-weight-select"
                variant="filled"
                size="small"
                popupMatchSelectWidth={140}
                classNames={{ popup: { root: "ms-scope sp-text-format-popup" } }}
                value={layer.fontWeight || 400}
                onChange={(fontWeight) => onChange({ fontWeight })}
                options={[
                    { value: 400, label: "常规" },
                    { value: 600, label: "中粗" },
                    { value: 700, label: "粗体" },
                ]}
            />
            <input aria-label="字号" title="字号" type="number" min={8} max={160} value={layer.fontSize || 24} onChange={(e) => onChange({ fontSize: Math.max(8, Math.min(160, Number(e.target.value))) })} />
            <Tooltip title="斜体">
                <button aria-label="斜体" aria-pressed={layer.italic || false} onClick={() => onChange({ italic: !layer.italic })}>
                    <ShopCanvasGlyph name="italic" size={16} />
                </button>
            </Tooltip>
            <input type="color" aria-label="文字颜色" title="文字颜色" value={layer.color?.startsWith("#") ? layer.color : "#333333"} onChange={(e) => onChange({ color: e.target.value })} />
            {(["left", "center", "right"] as const).map((align, index) => {
                const label = ["左对齐", "居中", "右对齐"][index];
                return (
                    <Tooltip key={align} title={label}>
                        <button aria-label={label} aria-pressed={(layer.textAlign || "left") === align} onClick={() => onChange({ textAlign: align })}>
                            <ShopCanvasGlyph name={`align-${align}`} size={16} />
                        </button>
                    </Tooltip>
                );
            })}
            <label title="字间距">
                字距
                <input aria-label="字间距" type="number" min={0} max={20} value={layer.letterSpacing || 0} onChange={(e) => onChange({ letterSpacing: Math.max(0, Math.min(20, Number(e.target.value))) })} />
            </label>
            <label title="行间距">
                行距
                <input aria-label="行间距" type="number" min={1} max={3} step={0.1} value={layer.lineHeight || 1.6} onChange={(e) => onChange({ lineHeight: Math.max(1, Math.min(3, Number(e.target.value))) })} />
            </label>
            <Tooltip title="下载文案">
                <button aria-label="下载文案" onClick={download}>
                    <ShopCanvasGlyph name="download" size={16} />
                </button>
            </Tooltip>
        </ShopNodeToolbar>
    );
}
