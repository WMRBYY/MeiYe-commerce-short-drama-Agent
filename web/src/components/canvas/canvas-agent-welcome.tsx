import { useSkillLibraryAccess } from "@/lib/skill-access";
import { ArrowUpRight, Clapperboard, ImagePlus, Layers3, Orbit, ShoppingBag, Sparkles, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { agentCopy, type CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { yoruBody } from "@/assets/yoru";

/** 已安装技能少于这个数时，欢迎页主动提示按行业安装推荐技能。 */
const RECOMMEND_SKILLS_BELOW = 3;

type AgentWelcomeProps = {
    appearance: CanvasAppearance;
    /** null 表示当前不在画布中。 */
    nodeCount: number | null;
    /** null 表示技能库还没读到。 */
    installedSkillCount?: number | null;
    onChooseSkill?: () => void;
    onOpenSkillRecommendations?: () => void;
    onDraftPrompt: (prompt: string) => void;
    ecommerceMode?: boolean;
};

export function AgentWelcome({ appearance, nodeCount, installedSkillCount = null, onChooseSkill, onOpenSkillRecommendations, onDraftPrompt, ecommerceMode = false }: AgentWelcomeProps) {
    const { t } = useTranslation();
    const canUseSkills = useSkillLibraryAccess();
    const suggestRecommendations = canUseSkills && Boolean(onOpenSkillRecommendations) && installedSkillCount !== null && installedSkillCount < RECOMMEND_SKILLS_BELOW;
    if (ecommerceMode) {
        return (
            <section className="agent-welcome" aria-label="电商画布助手">
                <div className="agent-welcome-intro">
                    <span className="agent-welcome-orb" aria-hidden="true">
                        <img src={yoruBody} alt="" loading="lazy" />
                    </span>
                    <h2>电商画布助手</h2>
                    <p>围绕商品素材搭建主视觉、详情页和商品视频。你可以先整理素材，再让助手执行下一步。</p>
                </div>
                <div className="agent-welcome-actions">
                    <button type="button" onClick={() => onDraftPrompt("请根据当前画布中的商品素材，整理一套商品主视觉方案。先分析素材和卖点，再给出构图与执行步骤。")}>
                        <ShoppingBag aria-hidden="true" />
                        <span>
                            <strong>规划商品主视觉</strong>
                            <small>分析商品图、卖点和画面结构</small>
                        </span>
                        <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => onDraftPrompt("请根据当前商品素材规划一条电商商品视频。先确认视频目标、画幅和节奏，再给出镜头与生成步骤。")}>
                        <Video aria-hidden="true" />
                        <span>
                            <strong>规划商品视频</strong>
                            <small>梳理镜头、节奏和素材使用方式</small>
                        </span>
                        <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => onDraftPrompt("请检查当前电商画布中的商品素材，指出缺失、重复或需要调整的内容，并给出下一步建议。先不要直接生成。")}>
                        <ImagePlus aria-hidden="true" />
                        <span>
                            <strong>检查商品素材</strong>
                            <small>确认图片、文字和节点是否适合继续创作</small>
                        </span>
                        <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                    </button>
                </div>
                <p className="agent-welcome-footnote">电商画布助手只处理当前商品工作区，模型和素材配置以电商模式为准。</p>
            </section>
        );
    }
    return (
        <section className="agent-welcome" aria-label={t("canvasA.welcome.label")}>
            <div className="agent-welcome-intro">
                <span className="agent-welcome-orb" aria-hidden="true">
                    <img src={yoruBody} alt="" loading="lazy" />
                </span>
                <h2>{agentCopy(appearance.welcomeTitle, appearance.agentName)}</h2>
                <p>{agentCopy(appearance.welcomeDescription, appearance.agentName)}</p>
            </div>
            <div className="agent-welcome-actions">
                {suggestRecommendations ? (
                    <button type="button" onClick={onOpenSkillRecommendations}>
                        <Sparkles aria-hidden="true" />
                        <span>
                            <strong>{t("canvasA.welcome.recommendTitle")}</strong>
                            <small>{installedSkillCount ? t("canvasA.welcome.recommendInstalled", { count: installedSkillCount }) : t("canvasA.welcome.recommendHint")}</small>
                        </span>
                        <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                    </button>
                ) : null}
                {canUseSkills && (
                    <button type="button" onClick={onChooseSkill}>
                        <Orbit aria-hidden="true" />
                        <span>
                            <strong>{t("canvasA.welcome.chooseSkillTitle")}</strong>
                            <small>{t("canvasA.welcome.chooseSkillHint")}</small>
                        </span>
                        <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                    </button>
                )}
                <button type="button" onClick={() => onDraftPrompt("我想创作一段短片，请先和我一起梳理故事方向。先询问我的想法，不要直接生成。")}>
                    <Clapperboard aria-hidden="true" />
                    <span>
                        <strong>{t("canvasA.welcome.storyTitle")}</strong>
                        <small>{t("canvasA.welcome.storyHint")}</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
                <button type="button" disabled={!nodeCount} onClick={() => onDraftPrompt("请先阅读当前画布，梳理素材与节点之间的关系，给出接下来的创作建议。先不要修改节点或提交生成任务。")}>
                    <Layers3 aria-hidden="true" />
                    <span>
                        <strong>{t("canvasA.welcome.reviewTitle")}</strong>
                        <small>{nodeCount === null ? t("canvasA.welcome.reviewNoCanvas") : nodeCount > 0 ? t("canvasA.welcome.reviewNodes", { count: nodeCount }) : t("canvasA.welcome.reviewEmpty")}</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
            </div>
            <p className="agent-welcome-footnote">{t("canvasA.welcome.footnote")}</p>
        </section>
    );
}
