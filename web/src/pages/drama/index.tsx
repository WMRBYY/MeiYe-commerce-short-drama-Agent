import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import { ToolIcon, type ToolIconName } from "@/components/mode/mode-icons";
import { HomeGallery } from "@/pages/create/home/home-gallery";
import { listDramas, type DramaListItem } from "@/services/api/drama";
import { resourceVariantUrl } from "@/services/api/resources";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import "@/components/mode/mode-shell.css";
import "@/pages/shop/shop.css";
import { DramaComposer } from "./drama-composer";
import "./drama.css";

const HEADLINES = ["一句话，拍成一部短剧", "小说秒变分镜和成片", "角色、场景、镜头一次定好"];

type Tool = { key: string; label: string; icon: ToolIconName; to: string; badge?: string; enabled?: boolean };

function DramaHome() {
    const navigate = useNavigate();
    const reduced = useReducedMotion();
    const brand = useAppearanceStore((state) => state.appearance.brandName);
    const features = useUserStore((state) => state.features);
    const nickname = useUserStore((state) => state.user?.displayName?.trim() || state.user?.username?.trim() || "");
    const [seed, setSeed] = useState<{ text: string; id: number }>();
    const [headline, setHeadline] = useState(0);
    const [recent, setRecent] = useState<DramaListItem[]>([]);

    useEffect(() => {
        if (reduced) return;
        const timer = window.setInterval(() => setHeadline((value) => (value + 1) % HEADLINES.length), 4200);
        return () => window.clearInterval(timer);
    }, [reduced]);
    useEffect(() => {
        if (!features.shortDramaEnabled) return;
        const controller = new AbortController();
        listDramas({ page: 1, pageSize: 6 }, controller.signal)
            .then((page) => setRecent(page.items || []))
            .catch(() => undefined);
        return () => controller.abort();
    }, [features.shortDramaEnabled]);

    const toolList: Tool[] = [
        { key: "studio", label: "短剧工作室", icon: "film", to: "/projects", badge: "NEW", enabled: features.shortDramaEnabled },
        { key: "storyboard", label: "分镜画布", icon: "storyboard", to: "/canvas" },
        { key: "character", label: "角色资产", icon: "character", to: "/assets" },
        { key: "skills", label: "导演技能", icon: "chat", to: "/skills" },
        { key: "tasks", label: "创作历史", icon: "batch", to: "/tasks", enabled: features.taskCenterEnabled },
    ];
    const tools = toolList.filter((tool) => tool.enabled !== false);

    return (
        <div className="sp-page sp-home dr-home ms-scope">
            <section className="sp-hero">
                <motion.div className="sp-eyebrow" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                    <i />
                    {brand} 短剧{nickname ? ` · ${nickname}` : ""}
                </motion.div>
                <h1 className="sp-headline">
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.span key={headline} className="sp-headline-line" exit={reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.5, filter: "blur(6px)", transition: { duration: 0.22 } }}>
                            {[...HEADLINES[headline]].map((char, index) => (
                                <motion.span
                                    key={`${char}-${index}`}
                                    className="sp-headline-char"
                                    initial={reduced ? false : { opacity: 0, scale: 1.4, filter: "blur(10px)" }}
                                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                                    transition={{ delay: index * 0.035, duration: 0.5 }}
                                >
                                    {char}
                                </motion.span>
                            ))}
                        </motion.span>
                    </AnimatePresence>
                </h1>
                <p className="sp-sub">写下故事灵感，发送后直接进入短剧画布，由画布助手拆剧本、定角色、出分镜和成片。</p>

                <motion.div className="sp-hero-composer" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.45 }}>
                    <DramaComposer seed={seed} />
                </motion.div>

                <div className="sp-tools">
                    <div className="sp-tool-group">
                        <div className="sp-tool-group-title">短剧创作</div>
                        <div className="sp-tool-row">
                            {tools.map((tool, index) => (
                                <motion.button key={tool.key} type="button" className="sp-tool" onClick={() => navigate(tool.to)} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + index * 0.03 }}>
                                    {tool.badge ? <span className="sp-tool-badge">{tool.badge}</span> : null}
                                    <span className="sp-tool-icon">
                                        <ToolIcon name={tool.icon} className="size-5" />
                                    </span>
                                    <span className="sp-tool-label">{tool.label}</span>
                                </motion.button>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {recent.length ? (
                <section className="dr-recent">
                    <header>
                        <strong>继续创作</strong>
                        <Link to="/projects">
                            全部短剧 <ChevronRight className="size-3.5" />
                        </Link>
                    </header>
                    <LayoutGroup>
                        <div className="dr-recent-grid">
                            {recent.map((item, index) => {
                                const cover = item.coverResourceIds?.[0] || item.coverResourceId;
                                return (
                                    <motion.div key={item.project.id} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
                                        <Link to={`/projects/${encodeURIComponent(item.project.id)}`} className="dr-card">
                                            <span className="dr-card-cover">{cover ? <img src={resourceVariantUrl(cover, "thumbnail")} alt="" loading="lazy" /> : <i>{item.project.name.slice(0, 1)}</i>}</span>
                                            <span className="dr-card-text">
                                                <strong>{item.project.name}</strong>
                                                <small>
                                                    {item.doneCount}/{item.episodeCount} 集 · {item.aspectRatio}
                                                    {item.styleName ? ` · ${item.styleName}` : ""}
                                                </small>
                                            </span>
                                        </Link>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </LayoutGroup>
                </section>
            ) : null}

            <div className="sp-gallery">
                <HomeGallery onUse={(item) => item.prompt && setSeed({ text: item.prompt.slice(0, 4000), id: Date.now() })} />
            </div>
        </div>
    );
}

export default function DramaPage() {
    const { pathname } = useLocation();
    return <div className="ms-stage-body h-full min-h-0 overflow-hidden">{pathname === "/drama" ? <DramaHome /> : <Navigate to="/drama" replace />}</div>;
}
