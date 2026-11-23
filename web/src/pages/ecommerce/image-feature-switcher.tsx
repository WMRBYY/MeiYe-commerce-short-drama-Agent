import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import "./shared-image-controls.css";
import "./image-feature-switcher.css";

export type ImageFeature = "create" | "tryon";

const IMAGE_FEATURES: Array<{ id: ImageFeature; title: string; description: string }> = [
    { id: "create", title: "商品出图", description: "白底图、主图、套图与详情页一键成套。" },
    { id: "tryon", title: "批量换装", description: "真人模特换装、换脸换头与印花提取。" },
];

/* 与商品视频功能图标同一画法：24×24 双色线稿，主线条用 currentColor，强调面用 --glyph-accent。 */
function Glyph({ children }: { children: ReactNode }) {
    return (
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

const ACCENT = "var(--glyph-accent, currentColor)";

function ImageFeatureGlyph({ id }: { id: ImageFeature }) {
    if (id === "tryon") {
        return (
            <Glyph>
                <path d="M8.5 4 L5 6 L3 10 L6 11.5 L6.5 20 H17.5 L18 11.5 L21 10 L19 6 L15.5 4 Q12 7 8.5 4 Z" fill={ACCENT} fillOpacity={0.22} stroke={ACCENT} />
                <path d="M9.4 13 H14.6 L13 11.4" />
                <path d="M14.6 16.4 H9.4 L11 18" />
            </Glyph>
        );
    }
    return (
        <Glyph>
            <rect x={3} y={5} width={14} height={14} rx={2.4} />
            <path d="M3.4 16.2 L8 11.6 L11.4 14.8 L13.4 12.8 L16.6 16" fill={ACCENT} fillOpacity={0.22} stroke={ACCENT} />
            <circle cx={12.6} cy={8.8} r={1.4} fill={ACCENT} stroke="none" />
            <path d="M20 8.5 V18.6 Q20 21 17.6 21 H7.5" />
            <path d="M19.8 2.6 V5.4 M18.4 4 H21.2" stroke={ACCENT} />
        </Glyph>
    );
}

/**
 * 商品图片的「当前图片功能」：与商品视频「当前视频功能」同一套结构与样式（.ecv-feature，样式在 ecommerce-video.css 与 video-chrome.css），
 * 在「商品出图」与「批量换装」之间切换。外层 .ecv-shell 让商品出图面板也用上视频面板的动效层。
 */
export function ImageFeatureSwitcher({
    value,
    tryOnAvailable,
    tryOnVisible = true,
    onChange,
}: {
    value: ImageFeature;
    tryOnAvailable: boolean;
    /** 后台关闭批量换装后，普通用户不显示该选项；只剩一个功能时卡片不再可切换。 */
    tryOnVisible?: boolean;
    onChange: (value: ImageFeature) => void;
}) {
    const features = tryOnVisible ? IMAGE_FEATURES : IMAGE_FEATURES.filter((item) => item.id !== "tryon");
    const switchable = features.length > 1;
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    }, [open]);
    const current = features.find((item) => item.id === value) || features[0];
    return (
        <div className="ecv-shell ecs-image-feature">
            <div className="ecv-feature" ref={root} data-open={open}>
                <button type="button" className="ecv-feature-card" aria-expanded={open} aria-haspopup="listbox" disabled={!switchable} onClick={() => setOpen((state) => !state)}>
                    <span key={current.id} className={`ecv-glyph-tile is-${current.id} ecv-swap-in`}>
                        <ImageFeatureGlyph id={current.id} />
                    </span>
                    <span key={`copy-${current.id}`} className="ecv-feature-copy ecv-swap-in">
                        <small>当前图片功能</small>
                        <strong>{current.title}</strong>
                        <span>{current.description}</span>
                    </span>
                    {switchable ? (
                        <span className="ecv-feature-switch">
                            切换 <ChevronDown size={13} className={open ? "is-open" : undefined} />
                        </span>
                    ) : null}
                </button>
                <div className="ecv-feature-menu" role="listbox" aria-label="图片功能" aria-hidden={!open} inert={!open}>
                    {features.map((item, index) => {
                        const selected = item.id === value;
                        // 批量换装需要电商创作与图片生成都已开通；未开通时保留选项并说明原因。
                        const disabled = item.id === "tryon" && !tryOnAvailable;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                disabled={disabled}
                                className={selected ? "is-selected" : undefined}
                                style={{ "--i": index } as CSSProperties}
                                onClick={() => {
                                    setOpen(false);
                                    if (!selected) onChange(item.id);
                                }}
                            >
                                <span className={`ecv-glyph-tile is-${item.id}`}>
                                    <ImageFeatureGlyph id={item.id} />
                                </span>
                                <span className="ecv-feature-copy">
                                    <strong>{item.title}</strong>
                                    <span>{disabled ? "需要开通电商创作与图片生成" : item.description}</span>
                                </span>
                                <span className="ecv-feature-check" aria-hidden="true">
                                    {selected ? <Check size={14} /> : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
