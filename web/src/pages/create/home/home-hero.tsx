import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";

export type HomeSurface = "generate" | "canvas";

const SURFACES: { value: HomeSurface; label: string }[] = [
    { value: "generate", get label() { return translate("home.surface.generate"); } },
    { value: "canvas", get label() { return translate("nav.tools.canvas"); } },
];

/** 生成 / 画布 切换：选中块是带流光的渐变胶囊，通过共享 layoutId 在两个选项之间弹性滑动。 */
export function HomeSurfaceSwitch({ value, onChange }: { value: HomeSurface; onChange: (value: HomeSurface) => void }) {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    return <LayoutGroup id="home-surface-switch">
        <div className="home-surface-switch" role="tablist" aria-label={t("home.surface.label")}>
            {SURFACES.map((item) => {
                const active = item.value === value;
                return <button key={item.value} type="button" role="tab" aria-selected={active} className={active ? "is-active" : undefined} onClick={() => onChange(item.value)}>
                    {active ? <motion.span layoutId="home-surface-pill" className="home-surface-pill" transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34, mass: 0.8 }} aria-hidden /> : null}
                    <span className="home-surface-label">{item.label}</span>
                </button>;
            })}
        </div>
    </LayoutGroup>;
}

/** 首屏背景（参考即梦）：顶部一层很淡的中性光 + 点阵网格，向下渐隐；明暗主题各一套取值，不拦截交互。 */
export function HomeAmbientBackdrop() {
    return <div className="home-ambient" aria-hidden>
        <span className="home-ambient-glow" />
        <span className="home-ambient-grid" />
    </div>;
}
