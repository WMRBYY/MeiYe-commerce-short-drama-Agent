import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, CornerDownLeft, LoaderCircle, Search, Sparkles, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";

import { listSkills, type Skill, type SkillCategory, type SkillScope } from "@/services/api/skills";

type Category = { key: string; label: string; scope: SkillScope; tag?: string };
const BASE: Category[] = [
    { key: "all", label: "全部", scope: "public" },
    { key: "mine", label: "我的", scope: "mine" },
    { key: "favorites", label: "收藏", scope: "favorites" },
];

function coverOf(skill: Skill) {
    const media = skill.showcaseMedia?.[0];
    return { image: skill.displayCoverUrl || (media?.type === "image" ? media.showcaseUrl : ""), video: media?.type === "video" ? media.showcaseUrl : "" };
}

/** 技能选择：左侧分类、中间列表、右侧封面与介绍；回车或点击选中，作为画布助手的技能。 */
export function DramaSkillPicker({ open, onClose, onPick, selectedId }: { open: boolean; onClose: () => void; onPick: (skill: Skill) => void; selectedId?: string }) {
    const navigate = useNavigate();
    const reduced = useReducedMotion();
    const [category, setCategory] = useState<Category>(BASE[0]);
    const [tags, setTags] = useState<SkillCategory[]>([]);
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [active, setActive] = useState(0);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => setQuery(search.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [search]);
    useEffect(() => {
        if (!open) return;
        requestAnimationFrame(() => input.current?.focus());
        const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
        document.addEventListener("keydown", escape);
        return () => document.removeEventListener("keydown", escape);
    }, [open, onClose]);
    useEffect(() => {
        if (!open) return;
        let alive = true;
        setLoading(true);
        setError("");
        listSkills({ scope: category.scope, tag: category.tag, search: query || undefined, sort: "popular", page: 1, pageSize: 40 })
            .then((result) => {
                if (!alive) return;
                setSkills(result.skills || []);
                setActive(0);
                if (category.scope === "public" && !category.tag && result.categories?.length) setTags(result.categories.filter((item) => item.value && item.value !== "all"));
            })
            .catch((cause) => alive && (setSkills([]), setError(cause instanceof Error ? cause.message : "技能读取失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [open, category, query]);

    const categories = useMemo<Category[]>(() => [...BASE, ...tags.map((tag) => ({ key: `tag:${tag.value}`, label: tag.label, scope: "public" as const, tag: tag.value }))], [tags]);
    const current = skills[active];
    const cover = current ? coverOf(current) : undefined;
    const choose = (skill: Skill | undefined) => {
        if (!skill) return;
        onPick(skill);
        onClose();
    };

    if (typeof document === "undefined") return null;
    return createPortal(
        <AnimatePresence>
            {open ? (
                <motion.div className="dr-skill-backdrop ms-scope" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
                    <motion.div
                        className="dr-skill-modal"
                        role="dialog"
                        aria-label="选择技能"
                        initial={reduced ? false : { opacity: 0, y: 16, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <header className="dr-skill-head">
                            <Search className="size-4" />
                            <input
                                ref={input}
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "ArrowDown") (event.preventDefault(), setActive((value) => Math.min(skills.length - 1, value + 1)));
                                    if (event.key === "ArrowUp") (event.preventDefault(), setActive((value) => Math.max(0, value - 1)));
                                    if (event.key === "Enter" && !event.nativeEvent.isComposing) (event.preventDefault(), choose(current));
                                }}
                                placeholder="搜索技能"
                            />
                            <button type="button" className="dr-skill-all" onClick={() => (onClose(), navigate("/skills"))}>
                                全部 <ArrowRight className="size-3.5" />
                            </button>
                        </header>
                        <div className="dr-skill-body">
                            <nav className="dr-skill-cats">
                                {categories.map((item) => (
                                    <button key={item.key} type="button" data-active={item.key === category.key || undefined} onClick={() => setCategory(item)}>
                                        {item.key === category.key ? <Check className="size-3.5" /> : <i />}
                                        <span className="truncate">{item.label}</span>
                                    </button>
                                ))}
                            </nav>
                            <div className="dr-skill-list">
                                {loading ? (
                                    <div className="dr-skill-state">
                                        <LoaderCircle className="size-4 animate-spin" /> 加载中…
                                    </div>
                                ) : error ? (
                                    <div className="dr-skill-state">{error}</div>
                                ) : skills.length ? (
                                    skills.map((skill, index) => (
                                        <button key={skill.skillId} type="button" data-active={index === active || undefined} data-selected={skill.skillId === selectedId || undefined} onPointerEnter={() => setActive(index)} onClick={() => choose(skill)}>
                                            <span className="dr-skill-name">
                                                <strong className="truncate">{skill.skillName}</strong>
                                                {index === active ? <CornerDownLeft className="size-3.5" /> : null}
                                            </span>
                                            <small className="truncate">{skill.displayTagline || skill.description || "暂无介绍"}</small>
                                        </button>
                                    ))
                                ) : (
                                    <div className="dr-skill-state">{category.scope === "mine" ? "还没有添加技能" : category.scope === "favorites" ? "还没有收藏技能" : "没有找到相关技能"}</div>
                                )}
                            </div>
                            <aside className="dr-skill-preview">
                                <AnimatePresence mode="wait">
                                    {current ? (
                                        <motion.div key={current.skillId} className="dr-skill-card" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                                            <div className="dr-skill-cover">
                                                {cover?.video ? (
                                                    <video src={cover.video} muted autoPlay loop playsInline />
                                                ) : cover?.image ? (
                                                    <img src={cover.image} alt="" />
                                                ) : (
                                                    <span className="dr-skill-cover-fallback">
                                                        <Sparkles className="size-8" />
                                                        <b>{current.skillName.slice(0, 6)}</b>
                                                    </span>
                                                )}
                                                {current.isLike ? <Star className="dr-skill-star size-4" /> : null}
                                            </div>
                                            <p>{current.description || current.displayTagline || "暂无介绍"}</p>
                                            <footer>
                                                <span className="dr-skill-tags">
                                                    {current.tag ? <em>{categories.find((item) => item.tag === current.tag)?.label || current.tag}</em> : null}
                                                    {current.isAdded ? <em>已添加</em> : null}
                                                </span>
                                                <button type="button" onClick={() => choose(current)}>
                                                    使用 <ArrowRight className="size-3.5" />
                                                </button>
                                            </footer>
                                        </motion.div>
                                    ) : null}
                                </AnimatePresence>
                            </aside>
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>,
        document.body,
    );
}
