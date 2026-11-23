import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, ChartNoAxesColumn, ChevronLeft, ChevronRight, Image, Orbit, PanelsTopLeft, Play, ShoppingBag, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";
import { SkillVisualCover, skillVisualTagline } from "@/components/skills/skill-visual-cover";
import { getSkill, listRecentSkillUsage, listSkills, type Skill } from "@/services/api/skills";
import { modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import "./creation-skill-discovery.css";
import { useLoginDialogStore } from "@/stores/use-login-dialog-store";

type Tab = "recent" | "weekly" | "drama" | "recommended";
const tabLabels: Record<Tab, string> = {
    get recent() { return translate("create.skillDiscovery.tabs.recent"); },
    get weekly() { return translate("create.skillDiscovery.tabs.weekly"); },
    get drama() { return translate("create.skillDiscovery.tabs.drama"); },
    get recommended() { return translate("create.skillDiscovery.tabs.recommended"); },
};
const isDramaSkill = (skill: Skill) => skill.tag === "drama" && /短剧|剧本|故事|角色|世界观|分镜|场景|视频制作|续写|演员|影视/.test(`${skill.skillName} ${skill.description}`);

export function CreationSkillDiscovery({
    userId,
    config,
    onCanvas,
    onAgent,
    onMode,
    onChooseModel,
}: {
    userId: string | null;
    config: AiConfig;
    onCanvas: () => void;
    onAgent: () => void;
    onMode: (mode: "image" | "video") => void;
    onChooseModel: (mode: "image" | "video", model: string) => void;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const showLogin = useLoginDialogStore((state) => state.show);
    const [tab, setTab] = useState<Tab>("weekly");
    const [popular, setPopular] = useState<Skill[]>([]);
    const [drama, setDrama] = useState<Skill[]>([]);
    const [recent, setRecent] = useState<Skill[]>([]);
    const [recentLoadedFor, setRecentLoadedFor] = useState("");
    const [recentLoading, setRecentLoading] = useState(false);
    const [recentError, setRecentError] = useState("");
    const [loading, setLoading] = useState(Boolean(userId));
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const rail = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!userId) {
            setPopular([]);
            setDrama([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError("");
        Promise.all([listSkills({ scope: "public", sort: "popular", pageSize: 24 }), listSkills({ scope: "public", sort: "popular", tag: "drama", pageSize: 20 })])
            .then(([popularResult, dramaResult]) => {
                if (cancelled) return;
                setPopular(popularResult.skills);
                setDrama(dramaResult.skills.filter(isDramaSkill));
            })
            .catch((cause) => {
                if (!cancelled) setError(cause instanceof Error ? cause.message : translate("create.skillDiscovery.recommendedLoadFailed"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [userId, revision]);
    useEffect(() => {
        if (tab !== "recent" || !userId || recentLoadedFor === userId) return;
        let cancelled = false;
        setRecentLoading(true);
        setRecentError("");
        listRecentSkillUsage()
            .then(async (usage) => {
                const entries = usage.skills
                    .filter((item) => item.readCalls > 0 && item.lastUsedAt)
                    .sort((a, b) => Date.parse(b.lastUsedAt || "") - Date.parse(a.lastUsedAt || ""))
                    .slice(0, 8);
                const details = await Promise.allSettled(entries.map((item) => getSkill(item.skillId)));
                if (!cancelled) {
                    setRecent(details.flatMap((result) => (result.status === "fulfilled" && result.value.skill.status === 1 ? [result.value.skill] : [])));
                    setRecentLoadedFor(userId);
                }
            })
            .catch((cause) => {
                if (!cancelled) setRecentError(cause instanceof Error ? cause.message : translate("create.skillDiscovery.recentLoadFailed"));
            })
            .finally(() => {
                if (!cancelled) setRecentLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [tab, userId, recentLoadedFor]);
    useEffect(() => {
        setRecent([]);
        setRecentLoadedFor("");
    }, [userId]);

    const videoModels = selectableModelsByCapability(config, "video");
    const imageModels = selectableModelsByCapability(config, "image");
    const audioModels = selectableModelsByCapability(config, "audio");
    const seedance = videoModels.find((model) => /seedance.*(?:2[.\-_]?5|v2[.\-_]?5)/i.test(modelOptionName(model)));
    const image25 = imageModels.find((model) => /(?:image|图片|seedream|即梦).*(?:2[.\-_]?5|v2[.\-_]?5)/i.test(modelOptionName(model)));
    const tools = [
        { key: "canvas", label: t("nav.tools.canvas"), icon: PanelsTopLeft, action: onCanvas, enabled: true },
        { key: "agent", label: t("create.skillDiscovery.tools.agent"), icon: Sparkles, action: onAgent, enabled: true },
        { key: "ecommerce", label: t("nav.sidebar.ecommerce"), description: t("create.skillDiscovery.tools.ecommerceDescription"), icon: ShoppingBag, action: () => navigate("/ecommerce?mode=quick"), enabled: true },
        { key: "image", label: t("nav.sidebar.toolboxImage"), icon: Image, action: () => onMode("image"), enabled: imageModels.length > 0 },
        { key: "video", label: t("nav.sidebar.toolboxVideo"), icon: Play, action: () => onMode("video"), enabled: videoModels.length > 0 },
        { key: "audio", label: t("create.skillDiscovery.tools.audio"), icon: AudioLines, action: onCanvas, enabled: audioModels.length > 0 },
        { key: "seedance", label: "Seedance 2.5", icon: ChartNoAxesColumn, action: () => seedance && onChooseModel("video", seedance), enabled: Boolean(seedance) },
        { key: "image25", label: t("create.skillDiscovery.tools.image25"), icon: Orbit, action: () => image25 && onChooseModel("image", image25), enabled: Boolean(image25) },
    ];
    const recommended = useMemo(() => {
        const weeklyIds = new Set(popular.slice(0, 8).map((skill) => skill.skillId));
        return popular.filter((skill) => !weeklyIds.has(skill.skillId) && skill.description.trim()).slice(0, 10);
    }, [popular]);
    const cards = tab === "drama" ? drama.slice(0, 10) : tab === "recommended" ? recommended : tab === "weekly" ? popular.slice(0, 10) : recent;
    const chooseTab = (next: Tab) => {
        setTab(next);
        rail.current?.scrollTo({ left: 0, behavior: "smooth" });
    };

    return (
        <section className={`creation-skill-discovery${userId ? "" : " is-guest"}`} aria-label={t("create.skillDiscovery.regionLabel")}>
            <div className="creation-tool-rail" aria-label={t("create.skillDiscovery.toolsLabel")}>
                {tools.map(({ key, label, description, icon: Icon, action, enabled }) => (
                    <button
                        key={key}
                        type="button"
                        className={`creation-tool-item is-${key}`}
                        onClick={() => (!userId ? showLogin(key === "ecommerce" ? "/ecommerce?mode=quick" : key === "canvas" || key === "audio" ? "/canvas" : "/") : action())}
                        disabled={Boolean(userId) && !enabled}
                        title={!userId ? t("create.skillDiscovery.loginToUse", { label }) : enabled ? description || label : t("create.skillDiscovery.toolUnavailableTitle", { label })}
                    >
                        <span className="creation-tool-icon">
                            <Icon size={21} strokeWidth={1.8} />
                        </span>
                        <span>{label}</span>
                        {userId && !enabled ? <small>{t("create.skillDiscovery.toolUnavailable")}</small> : null}
                    </button>
                ))}
            </div>
            <div className="creation-discovery-heading">
                <div className="creation-discovery-tabs" role="tablist" aria-label={t("create.skillDiscovery.tabsLabel")}>
                    {(Object.keys(tabLabels) as Tab[]).map((item) => (
                        <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => chooseTab(item)}>
                            {tabLabels[item]}
                        </button>
                    ))}
                </div>
                <div className="creation-discovery-controls">
                    <button type="button" aria-label={t("create.skillDiscovery.previous")} onClick={() => rail.current?.scrollBy({ left: -520, behavior: "smooth" })}>
                        <ChevronLeft size={17} />
                    </button>
                    <button type="button" aria-label={t("create.skillDiscovery.next")} onClick={() => rail.current?.scrollBy({ left: 520, behavior: "smooth" })}>
                        <ChevronRight size={17} />
                    </button>
                </div>
            </div>
            {tab === "weekly" && !loading && !error ? <p className="creation-discovery-note">{t("create.skillDiscovery.weeklyNote")}</p> : null}
            {(tab === "recent" ? recentLoading : loading) ? (
                <div className="creation-discovery-skeleton" role="status" aria-label={t("create.skillDiscovery.loading")}>
                    {[0, 1, 2, 3].map((item) => (
                        <span key={item} />
                    ))}
                </div>
            ) : (tab === "recent" ? recentError : error) ? (
                <div className="creation-discovery-state" role="alert">
                    {t("create.skillDiscovery.loadFailed")}
                    <button
                        type="button"
                        onClick={() => {
                            if (tab === "recent") setRecentLoadedFor("");
                            else setRevision((value) => value + 1);
                        }}
                    >
                        {t("common.retry")}
                    </button>
                </div>
            ) : tab === "recent" && !recent.length ? (
                <div className="creation-discovery-state">
                    {t("create.skillDiscovery.recentEmpty")}
                    <button type="button" onClick={() => chooseTab("recommended")}>
                        {t("create.skillDiscovery.viewRecommended")}
                    </button>
                </div>
            ) : !userId ? (
                <div className="creation-discovery-state">
                    {t("create.skillDiscovery.loginPrompt")}
                    <button type="button" onClick={() => showLogin()}>
                        {t("shell.login")}
                    </button>
                </div>
            ) : cards.length ? (
                <div ref={rail} className="creation-discovery-rail" role="tabpanel" aria-label={tabLabels[tab]}>
                    {cards.map((skill, index) => (
                        <button type="button" className="creation-discovery-card" key={skill.skillId} onClick={() => navigate(`/skills?skill=${encodeURIComponent(skill.skillId)}`)}>
                            <SkillVisualCover skill={skill} priority={index < 4} />
                            <strong>{skill.skillName}</strong>
                            <span>{skillVisualTagline(skill)}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className="creation-discovery-state">
                    {t("create.skillDiscovery.categoryEmpty")}
                    <button type="button" onClick={() => navigate("/skills")}>
                        {t("create.skillDiscovery.browseLibrary")}
                    </button>
                </div>
            )}
            <button type="button" className="creation-discovery-all" onClick={() => navigate(tab === "drama" ? "/skills?tag=drama" : "/skills")}>
                {t("create.skillDiscovery.viewAll")} <ChevronRight size={15} />
            </button>
        </section>
    );
}
