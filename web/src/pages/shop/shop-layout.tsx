import { motion } from "motion/react";
import { Check, LayoutGrid } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { ShopDropdown } from "./shop-dropdown";

/**
 * 作品网格的布局：每行几列（自适应 / 3 / 4 / 5 / 6 / 9，单选）与大图 / 小图（单选），两组可以同时选。
 * 大图按原图比例完整显示，小图裁成方块更紧凑。按页面记在本机。
 */
export type GridCols = "auto" | 3 | 4 | 5 | 6 | 9;
export type GridSize = "large" | "small";
export type GridLayout = { cols: GridCols; size: GridSize };

const COLS: Array<[GridCols, string]> = [
    ["auto", "自适应平铺"],
    [3, "每行 3 列"],
    [4, "每行 4 列"],
    [5, "每行 5 列"],
    [6, "每行 6 列"],
    [9, "每行 9 列"],
];
const SIZES: Array<[GridSize, string, string]> = [
    ["large", "大图", "按原图比例完整显示"],
    ["small", "小图", "方块缩略，一屏看更多"],
];

function read(key: string): GridLayout {
    try {
        const saved = JSON.parse(window.localStorage.getItem(`shop-grid:${key}`) || "null") as GridLayout | null;
        if (saved && COLS.some(([value]) => value === saved.cols) && SIZES.some(([value]) => value === saved.size)) return saved;
    } catch {
        // 读不到时用默认。
    }
    return { cols: "auto", size: "small" };
}

export function useGridLayout(key: string) {
    const [layout, setLayout] = useState<GridLayout>(() => read(key));
    const update = (patch: Partial<GridLayout>) =>
        setLayout((current) => {
            const next = { ...current, ...patch };
            try {
                window.localStorage.setItem(`shop-grid:${key}`, JSON.stringify(next));
            } catch {
                // 存储不可用时只在本次有效。
            }
            return next;
        });
    return [layout, update] as const;
}

/** 网格容器的样式变量：--grid-cols 与 --grid-card 由 CSS 的 .sp-grid-layout 使用。 */
export function gridStyle(layout: GridLayout): CSSProperties {
    return { "--grid-card": layout.size === "large" ? "232px" : "156px", "--grid-cols": layout.cols === "auto" ? "" : String(layout.cols) } as CSSProperties;
}

export function gridLabel(layout: GridLayout) {
    return `${layout.cols === "auto" ? "自动" : `${layout.cols} 列`} · ${layout.size === "large" ? "大图" : "小图"}`;
}

export function GridLayoutMenu({ layout, onChange }: { layout: GridLayout; onChange: (patch: Partial<GridLayout>) => void }) {
    return (
        <ShopDropdown align="end" width={220} icon={<LayoutGrid className="size-3.5" />} label={<>布局 <em className="si-dim">{gridLabel(layout)}</em></>}>
            {() => (
                <div className="sp-grid-menu">
                    <div className="sp-list-title">每行几列</div>
                    {COLS.map(([value, text], index) => {
                        const active = layout.cols === value;
                        return (
                            <motion.button key={String(value)} type="button" className="sp-grid-option" data-active={active || undefined} onClick={() => onChange({ cols: value })} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.02 }}>
                                {active ? <motion.i layoutId="sp-grid-cols-pill" className="sp-grid-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
                                <span>{text}</span>
                                {active ? <Check className="size-3.5" strokeWidth={2.6} /> : null}
                            </motion.button>
                        );
                    })}
                    <div className="sp-list-title">图片大小</div>
                    <div className="sp-grid-sizes">
                        {SIZES.map(([value, text, hint]) => {
                            const active = layout.size === value;
                            return (
                                <button key={value} type="button" className="sp-grid-size" data-active={active || undefined} onClick={() => onChange({ size: value })} title={hint}>
                                    {active ? <motion.i layoutId="sp-grid-size-pill" className="sp-grid-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
                                    <span className="sp-grid-size-icon" data-size={value}>
                                        <i />
                                        <i />
                                        <i />
                                        <i />
                                    </span>
                                    <span>{text}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </ShopDropdown>
    );
}
