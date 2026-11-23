import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUserStore } from "@/stores/use-user-store";

type Feature = { key: string; title: string; subtitle: string; image: string; video?: string; to: string; badge?: "New" | "Hot"; tone?: "teal" | "violet" | "blue" };
type Slide = { key: string; eyebrow: string; title: string; subtitle: string; image: string; to: string };

const SLIDE_INTERVAL = 5200;

/** 首页第二屏：左侧主推轮播 + 右侧两行功能卡，可横向翻页，悬停卡片会播放预览视频。 */
export function HomeFeatureShowcase({ brandName, onOpen }: { brandName: string; onOpen: (to: string) => void }) {
    const { t } = useTranslation();
    const features = useUserStore((state) => state.features);
    const reducedMotion = useReducedMotion();
    const slides = useMemo<Slide[]>(() => [
        ...(features.shortDramaEnabled ? [{ key: "drama", eyebrow: brandName, title: t("nav.sidebar.projects"), subtitle: t("home.showcase.slides.drama"), image: "/short-drama-styles/period-live-action.jpg", to: "/projects" }] : []),
        { key: "ecommerce", eyebrow: brandName, title: t("nav.sidebar.ecommerce"), subtitle: t("home.showcase.slides.ecommerce"), image: "/login-showcase/ecommerce.webp", to: "/ecommerce?mode=quick" },
        { key: "canvas", eyebrow: brandName, title: t("auth.panel.features.canvas.title"), subtitle: t("home.showcase.slides.canvas"), image: "/login-showcase/canvas.webp", to: "/canvas" },
    ], [brandName, features.shortDramaEnabled, t]);
    const cards = useMemo<Feature[]>(() => [
        ...(features.shortDramaEnabled ? [{ key: "drama", title: t("nav.sidebar.projects"), subtitle: t("home.showcase.cards.drama"), image: "/short-drama-styles/cyberpunk-neon.jpg", to: "/projects", badge: "New" as const, tone: "teal" as const }] : []),
        { key: "canvas", title: t("nav.sidebar.canvas"), subtitle: t("home.showcase.cards.canvas"), image: "/login-showcase/canvas.webp", video: "/login-showcase/canvas.mp4", to: "/canvas", tone: "teal" },
        { key: "ecommerce", title: t("nav.sidebar.ecommerce"), subtitle: t("home.showcase.cards.ecommerce"), image: "/login-showcase/ecommerce.webp", video: "/login-showcase/ecommerce.mp4", to: "/ecommerce?mode=quick", badge: "Hot" },
        { key: "toolbox", title: t("home.showcase.cards.toolboxTitle"), subtitle: t("home.showcase.cards.toolbox"), image: "/toolbox/image-remove-background.webp", to: "/canvas" },
        ...(features.imageWorkbenchEnabled || features.videoWorkbenchEnabled ? [{ key: "studio", title: t("home.showcase.cards.studioTitle"), subtitle: t("home.showcase.cards.studio"), image: "/login-showcase/video.webp", video: "/login-showcase/video.mp4", to: features.imageWorkbenchEnabled ? "/toolbox/image" : "/toolbox/video" }] : []),
        { key: "skills", title: t("nav.tools.skills"), subtitle: t("home.showcase.cards.skills"), image: "/login-showcase/inspiration.webp", video: "/login-showcase/inspiration.mp4", to: "/skills" },
        { key: "expand", title: t("home.showcase.cards.expandTitle"), subtitle: t("home.showcase.cards.expand"), image: "/toolbox/image-expand.webp", to: "/canvas" },
        { key: "assets", title: t("home.showcase.cards.assetsTitle"), subtitle: t("home.showcase.cards.assets"), image: "/login-showcase/product.webp", video: "/login-showcase/product.mp4", to: "/assets" },
        ...(features.taskCenterEnabled ? [{ key: "tasks", title: t("nav.sidebar.history"), subtitle: t("home.showcase.cards.tasks"), image: "/welcome/workbench-create.webp", to: "/tasks" }] : []),
    ], [features.imageWorkbenchEnabled, features.shortDramaEnabled, features.taskCenterEnabled, features.videoWorkbenchEnabled, t]);

    const [slide, setSlide] = useState(0);
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        if (paused || reducedMotion || slides.length < 2) return;
        const timer = window.setInterval(() => setSlide((current) => (current + 1) % slides.length), SLIDE_INTERVAL);
        return () => window.clearInterval(timer);
    }, [paused, reducedMotion, slides.length]);
    const active = slides[slide % slides.length];

    const track = useRef<HTMLDivElement>(null);
    const [scroll, setScroll] = useState({ left: false, right: false });
    const updateScroll = useCallback(() => {
        const element = track.current;
        if (!element) return;
        setScroll({ left: element.scrollLeft > 4, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
    }, []);
    useEffect(() => {
        updateScroll();
        window.addEventListener("resize", updateScroll);
        return () => window.removeEventListener("resize", updateScroll);
    }, [updateScroll, cards.length]);
    const page = (direction: -1 | 1) => track.current?.scrollBy({ left: direction * (track.current.clientWidth * 0.8), behavior: reducedMotion ? "auto" : "smooth" });
    const open = onOpen;

    return <section className="home-feature-showcase" aria-label={t("home.showcase.label")}>
        <div className="home-banner" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <AnimatePresence initial={false} mode="popLayout">
                <motion.button
                    key={active.key}
                    type="button"
                    className="home-banner-slide"
                    onClick={() => open(active.to)}
                    initial={reducedMotion ? false : { opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                >
                    <img src={active.image} alt="" className="home-banner-image" />
                    <span className="home-banner-shade" aria-hidden />
                    <span className="home-banner-copy">
                        <small>{active.eyebrow}</small>
                        <strong>{active.title}</strong>
                        <span>{active.subtitle}</span>
                    </span>
                </motion.button>
            </AnimatePresence>
            {slides.length > 1 ? <div className="home-banner-dots" role="tablist" aria-label={t("home.showcase.switchSlide")}>
                {slides.map((item, index) => <button key={item.key} type="button" role="tab" aria-selected={index === slide} aria-label={item.title} className={index === slide ? "is-active" : undefined} onClick={() => setSlide(index)}>{index === slide && !paused && !reducedMotion ? <motion.i key={`${item.key}-${slide}`} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: SLIDE_INTERVAL / 1000, ease: "linear" }} /> : null}</button>)}
            </div> : null}
        </div>
        <div className="home-feature-rail">
            {scroll.left ? <button type="button" className="home-rail-arrow is-left" aria-label={t("home.showcase.previousPage")} onClick={() => page(-1)}><ChevronLeft /></button> : null}
            <div ref={track} className="home-feature-track" onScroll={updateScroll}>
                {cards.map((card, index) => <FeatureCard key={card.key} card={card} index={index} onOpen={open} />)}
            </div>
            {scroll.right ? <button type="button" className="home-rail-arrow is-right" aria-label={t("home.showcase.nextPage")} onClick={() => page(1)}><ChevronRight /></button> : null}
        </div>
    </section>;
}

function FeatureCard({ card, index, onOpen }: { card: Feature; index: number; onOpen: (to: string) => void }) {
    const video = useRef<HTMLVideoElement>(null);
    const reducedMotion = useReducedMotion();
    const play = () => { if (video.current && !reducedMotion) void video.current.play().catch(() => undefined); };
    const stop = () => { if (video.current) { video.current.pause(); video.current.currentTime = 0; } };
    return <motion.button
        type="button"
        className={`home-feature-card${card.tone ? ` is-${card.tone}` : ""}`}
        onClick={() => onOpen(card.to)}
        onMouseEnter={play}
        onMouseLeave={stop}
        onFocus={play}
        onBlur={stop}
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ delay: reducedMotion ? 0 : Math.min(index, 8) * 0.04, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
        {card.badge ? <em className={`home-skill-badge home-feature-badge is-${card.badge.toLowerCase()}`}>{card.badge}</em> : null}
        <span className="home-feature-thumb">
            <img src={card.image} alt="" loading="lazy" />
            {card.video ? <video ref={video} src={card.video} muted loop playsInline preload="none" /> : null}
        </span>
        <span className="home-feature-copy">
            <strong>{card.title}</strong>
            <small>{card.subtitle}</small>
        </span>
    </motion.button>;
}
