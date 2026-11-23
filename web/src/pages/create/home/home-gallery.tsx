import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Heart, Search, X, Upload } from "lucide-react";
import { Button } from "antd";
import { PublishVideoDialog } from "@/components/canvas-template/publish-video-dialog";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { translate } from "@/i18n";
import { canvasTemplateMediaUrl, formatTemplateDuration, listPublicCanvasTemplates, type CanvasTemplate } from "@/services/api/canvas-templates";
import type { CreationMode } from "../creation-types";
import "./home-jimeng.css";

/**
 * 首页作品区条目。数据来自 public/home-gallery.json 的 items 数组，上新只需追加条目，不用改代码：
 * { id, title, category, cover, video?, author?, avatar?, prompt?, mode? }
 * category 取值见 HOME_GALLERY_CATEGORIES（featured 以外的 key）；带 prompt 的作品会显示“做同款”。
 */
export type HomeGalleryItem = {
    id: string;
    title: string;
    category: string;
    cover: string;
    video?: string;
    author?: string;
    avatar?: string;
    prompt?: string;
    mode?: CreationMode;
    /** 用户投稿并审核通过的画布模版：点击进入作品播放页。 */
    templateId?: string;
    likeCount?: number;
    durationMs?: number;
};

export const HOME_GALLERY_CATEGORIES = [
    {
        key: "featured",
        get label() {
            return translate("home.gallery.categories.featured");
        },
    },
    {
        key: "drama",
        get label() {
            return translate("home.gallery.categories.drama");
        },
    },
    {
        key: "film",
        get label() {
            return translate("home.gallery.categories.film");
        },
    },
    {
        key: "anime",
        get label() {
            return translate("home.gallery.categories.anime");
        },
    },
    {
        key: "ads",
        get label() {
            return translate("home.gallery.categories.ads");
        },
    },
    {
        key: "graphic",
        get label() {
            return translate("home.gallery.categories.graphic");
        },
    },
    {
        key: "ecommerce",
        get label() {
            return translate("home.gallery.categories.ecommerce");
        },
    },
] as const;

type CategoryKey = (typeof HOME_GALLERY_CATEGORIES)[number]["key"];
const CATEGORY_KEYS = new Set<string>(HOME_GALLERY_CATEGORIES.map((item) => item.key));
const MODES = new Set<string>(["image", "video", "text"]);

function text(value: unknown, max = 400) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** 只接受同源相对路径或 https 地址，避免配置错误把任意协议注入到 img/video。 */
function mediaUrl(value: unknown) {
    const url = text(value, 2000);
    return url.startsWith("/") || url.startsWith("https://") ? url : "";
}

function parseItems(data: unknown): HomeGalleryItem[] {
    const raw = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : [];
    return raw.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const category = text(item.category, 40);
        const cover = mediaUrl(item.cover);
        const title = text(item.title, 80);
        if (!cover || !title || !CATEGORY_KEYS.has(category) || category === "featured") return [];
        const mode = text(item.mode, 10);
        return [
            {
                id: text(item.id, 80) || `gallery-${index}`,
                title,
                category,
                cover,
                video: mediaUrl(item.video) || undefined,
                author: text(item.author, 40) || undefined,
                avatar: mediaUrl(item.avatar) || undefined,
                prompt: text(item.prompt, 4000) || undefined,
                mode: MODES.has(mode) ? (mode as CreationMode) : undefined,
            },
        ];
    });
}

function templateItem(template: CanvasTemplate): HomeGalleryItem {
    return {
        id: `template-${template.id}`,
        templateId: template.id,
        title: template.title,
        category: template.category,
        cover: canvasTemplateMediaUrl(template.coverThumbUrl || template.coverUrl),
        video: canvasTemplateMediaUrl(template.videoUrl),
        author: template.author.displayName,
        avatar: template.author.avatarUrl ? canvasTemplateMediaUrl(template.author.avatarUrl) : undefined,
        prompt: [template.description, ...template.tags].filter(Boolean).join(" "),
        likeCount: template.likeCount,
        durationMs: template.videoDurationMs,
    };
}

export function HomeGallery({ onUse }: { onUse: (item: HomeGalleryItem) => void }) {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    const navigate = useNavigate();
    const [items, setItems] = useState<HomeGalleryItem[]>([]);
    const [templates, setTemplates] = useState<HomeGalleryItem[]>([]);
    const [category, setCategory] = useState<CategoryKey>("featured");
    const [query, setQuery] = useState("");
    const [publishing, setPublishing] = useState(false);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch("/home-gallery.json", { cache: "no-cache" })
            .then((response) => (response.ok ? response.json() : null))
            .then((data: unknown) => {
                if (!cancelled) setItems(parseItems(data));
            })
            .catch(() => {
                if (!cancelled) setItems([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // 审核通过的用户模版排在运营配置的作品前面；接口失败时只展示静态作品。
    useEffect(() => {
        const controller = new AbortController();
        listPublicCanvasTemplates({ pageSize: 100 }, controller.signal)
            .then((list) => setTemplates(list.items.map(templateItem).filter((item) => item.cover && item.title && CATEGORY_KEYS.has(item.category) && item.category !== "featured")))
            .catch(() => {
                if (!controller.signal.aborted) setTemplates([]);
            });
        return () => controller.abort();
    }, [revision]);

    const openTemplate = (item: HomeGalleryItem) => {
        if (item.templateId) navigate(`/works/${encodeURIComponent(item.templateId)}?from=${category}`);
    };

    const allItems = useMemo(() => [...templates, ...items], [items, templates]);
    const keyword = query.trim().toLowerCase();
    const matched = useMemo(() => allItems.filter((item) => !keyword || `${item.title} ${item.author || ""} ${item.prompt || ""}`.toLowerCase().includes(keyword)), [allItems, keyword]);
    // 精选按分类分段展示（与即梦一致），其他分类只展示本分类。
    const sections = useMemo(() => {
        const list = category === "featured" ? HOME_GALLERY_CATEGORIES.filter((item) => item.key !== "featured") : HOME_GALLERY_CATEGORIES.filter((item) => item.key === category);
        return list.map((item) => ({ ...item, items: matched.filter((entry) => entry.category === item.key) })).filter((section) => section.items.length);
    }, [category, matched]);
    const label = HOME_GALLERY_CATEGORIES.find((item) => item.key === category)?.label || t("home.gallery.categories.featured");

    return (
        <section className="home-gallery" aria-label={t("home.gallery.label")}>
            {publishing ? (
                <PublishVideoDialog
                    source={{}}
                    onClose={() => setPublishing(false)}
                    onPublished={() => {
                        setCategory("ecommerce");
                        setRevision((r) => r + 1);
                    }}
                />
            ) : null}
            <header className="home-gallery-head">
                <LayoutGroup id="home-gallery-tabs">
                    <div className="home-gallery-tabs" role="tablist" aria-label={t("home.gallery.label")}>
                        {HOME_GALLERY_CATEGORIES.map((item) => {
                            const active = item.key === category;
                            return (
                                <button key={item.key} type="button" role="tab" aria-selected={active} className={`home-gallery-tab${active ? " is-active" : ""}`} onClick={() => setCategory(item.key)}>
                                    {active ? <motion.span layoutId="home-gallery-tab-pill" className="home-gallery-tab-pill" transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 36 }} aria-hidden /> : null}
                                    <span>{item.label}</span>
                                    {item.key === "featured" ? <FeaturedMark /> : null}
                                </button>
                            );
                        })}
                    </div>
                </LayoutGroup>
                <Button icon={<Upload size={14} />} onClick={() => setPublishing(true)}>
                    上传作品
                </Button>
                <label className="home-gallery-search">
                    <Search aria-hidden />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("home.gallery.search")} aria-label={t("home.gallery.search")} />
                    {query ? (
                        <button type="button" aria-label={t("home.gallery.clearSearch")} onClick={() => setQuery("")}>
                            <X />
                        </button>
                    ) : null}
                </label>
            </header>
            <motion.div key={category} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                {sections.length ? (
                    sections.map((section) => (
                        <div key={section.key} className="home-gallery-section">
                            <h3 className="home-gallery-section-title">{section.label}</h3>
                            <div className="home-gallery-grid">
                                {section.items.map((item) => (
                                    <GalleryCard key={item.id} item={item} onUse={onUse} onOpen={openTemplate} />
                                ))}
                            </div>
                        </div>
                    ))
                ) : (
                    <GalleryEmpty label={label} searching={Boolean(keyword)} featured={category === "featured"} />
                )}
            </motion.div>
        </section>
    );
}

function FeaturedMark() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" className="home-gallery-featured-mark">
            <path d="M12 3.05c.95 5.1 3.85 8 8.95 8.95-5.1.95-8 3.85-8.95 8.95-.95-5.1-3.85-8-8.95-8.95 5.1-.95 8-3.85 8.95-8.95Z" />
        </svg>
    );
}

function GalleryCard({ item, onUse, onOpen }: { item: HomeGalleryItem; onUse: (item: HomeGalleryItem) => void; onOpen: (item: HomeGalleryItem) => void }) {
    const { t } = useTranslation();
    const video = useRef<HTMLVideoElement>(null);
    const play = () => {
        void video.current?.play().catch(() => undefined);
    };
    const stop = () => {
        if (video.current) {
            video.current.pause();
            video.current.currentTime = 0;
        }
    };
    const isTemplate = Boolean(item.templateId);
    return (
        <article
            className={`home-gallery-card${isTemplate ? " is-template" : ""}`}
            onMouseEnter={play}
            onMouseLeave={stop}
            onClick={isTemplate ? () => onOpen(item) : undefined}
            onKeyDown={
                isTemplate
                    ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onOpen(item);
                          }
                      }
                    : undefined
            }
            role={isTemplate ? "link" : undefined}
            tabIndex={isTemplate ? 0 : undefined}
            aria-label={isTemplate ? item.title : undefined}
        >
            <div className="home-gallery-cover">
                <img src={item.cover} alt="" loading="lazy" />
                {item.video ? <video ref={video} src={item.video} muted loop playsInline preload="none" /> : null}
                {isTemplate && item.durationMs ? <span className="home-gallery-duration">{formatTemplateDuration(item.durationMs)}</span> : null}
                {!isTemplate && item.prompt ? (
                    <button type="button" className="home-gallery-use" onClick={() => onUse(item)} onFocus={play} onBlur={stop}>
                        {t("home.gallery.useTemplate")}
                    </button>
                ) : null}
            </div>
            <div className="home-gallery-meta">
                <strong title={item.title}>{item.title}</strong>
                <span className="home-gallery-meta-row">
                    {item.author ? (
                        <span className="home-gallery-author">
                            {item.avatar ? <img src={item.avatar} alt="" referrerPolicy="no-referrer" /> : <i aria-hidden>{item.author.slice(0, 1)}</i>}
                            {item.author}
                        </span>
                    ) : null}
                    {isTemplate ? (
                        <span className="home-gallery-likes">
                            <Heart aria-hidden />
                            {item.likeCount || 0}
                        </span>
                    ) : null}
                </span>
            </div>
        </article>
    );
}

function GalleryEmpty({ label, searching, featured }: { label: string; searching: boolean; featured: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="home-gallery-empty" role="status">
            <span className="home-gallery-empty-art" aria-hidden>
                <span className="is-back" />
                <span className="is-mid" />
                <span className="is-front">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                        <path d="M8.5 6.8v10.4L17 12Z" />
                    </svg>
                </span>
            </span>
            <strong>{searching ? t("home.gallery.noResults") : featured ? t("home.gallery.featuredSoon") : t("home.gallery.categorySoon", { label })}</strong>
            <p>{searching ? t("home.gallery.tryAnother") : t("home.gallery.comingSoon")}</p>
        </div>
    );
}
