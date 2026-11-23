// Copyright (c) 2026 meiyeai and upstream contributors. Licensed under MIT.
import { App } from "antd";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUp, Clapperboard, ChevronDown, Heart, ImageIcon, LoaderCircle, Maximize2, Minimize2, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router";

import { useTryOn } from "@/pages/ecommerce/tryon/use-tryon";
import { CANVAS_TEMPLATE_CATEGORIES, canvasTemplateCategoryLabel, canvasTemplateMediaUrl, listPublicCanvasTemplates, type CanvasTemplate } from "@/services/api/canvas-templates";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import "@/pages/ecommerce/composer.css";
import "@/pages/ecommerce/output-gallery.css";
import "@/pages/ecommerce/shared-image-controls.css";

import { ShopComposer } from "./shop-composer";
import { SHOP_MARKET, setShopFunction, useShopFunction, useShopScope } from "./shop-context";
import { SHOP_IMAGE_FUNCTIONS } from "./shop-functions";
import "./shop-home.css";

type HomeMode = "image" | "video";
const MODE_KEY = "meiye.shop.home.mode";
const TOOLS = [
    { key: "chat", hint: "多图对话生成" },
    { key: "outfit", hint: "服装一键试穿" },
    { key: "background", hint: "替换图片场景" },
    { key: "upscale", hint: "提升分辨率" },
    { key: "cutout", hint: "导出透明 PNG" },
    { key: "repaint", hint: "读图后重新绘制" },
    { key: "inpaint", hint: "涂抹指定区域" },
    { key: "detail", hint: "生成商品详情页" },
];
const CASE_COVERS = ["drink", "fashion", "watch"];

function readMode(): HomeMode {
    try {
        return window.localStorage.getItem(MODE_KEY) === "video" ? "video" : "image";
    } catch {
        return "image";
    }
}

/** 案例卡片：封面，悬停播放视频；点开进作品页（可做同款）。 */
function CaseCard({ item, index, onOpen }: { item: CanvasTemplate; index: number; onOpen: () => void }) {
    const reduced = useReducedMotion();
    const video = useRef<HTMLVideoElement>(null);
    const cover = canvasTemplateMediaUrl(item.coverThumbUrl || item.coverUrl);
    return (
        <motion.button
            type="button"
            className="sh-case"
            onClick={onOpen}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "40px" }}
            transition={{ delay: (index % 10) * 0.03, duration: 0.35 }}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            onMouseEnter={() => void video.current?.play().catch(() => undefined)}
            onMouseLeave={() => {
                if (!video.current) return;
                video.current.pause();
                video.current.currentTime = 0;
            }}
        >
            <span className="sh-case-media">
                {cover ? <img src={cover} alt="" loading="lazy" /> : null}
                {item.videoUrl ? <video ref={video} src={canvasTemplateMediaUrl(item.videoUrl)} muted loop playsInline preload="none" /> : null}
                {item.videoUrl ? (
                    <i className="sh-case-play">
                        <Play className="size-3" />
                    </i>
                ) : null}
                <span className="sh-case-use">一键同款</span>
            </span>
            <span className="sh-case-meta">
                <strong className="truncate">{item.title}</strong>
                <small>
                    <Heart className="size-3" /> {item.likeCount}
                </small>
            </span>
        </motion.button>
    );
}

export default function ShopHome() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const reduced = useReducedMotion();
    const scope = useShopScope();
    const brand = useAppearanceStore((state) => state.appearance.brandName) || "Meiye";
    const features = useUserStore((state) => state.features);
    const { fn, mode: shopMode, chat, allowed, pick } = useShopFunction();
    const tryOn = useTryOn({ scope, fn, market: SHOP_MARKET });
    const [mode, setMode] = useState<HomeMode>(readMode);
    const [expanded, setExpanded] = useState(false);
    const [toolTab, setToolTab] = useState<"tools" | "video">("tools");
    const [casesOpen, setCasesOpen] = useState(false);
    const [caseTab, setCaseTab] = useState<"image" | "video" | "canvas">("canvas");
    const [caseFilter, setCaseFilter] = useState("all");
    const [templates, setTemplates] = useState<CanvasTemplate[] | null>(null);
    const [capsule, setCapsule] = useState(false);
    const page = useRef<HTMLDivElement>(null);
    const composer = useRef<HTMLDivElement>(null);
    const cases = useRef<HTMLDivElement>(null);
    const videoTextarea = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        try {
            window.localStorage.setItem(MODE_KEY, mode);
        } catch {
            /* 不记住也能用 */
        }
    }, [mode]);
    // 输入框滚出视野、且正在往下滑时才出现底部胶囊；往上滑就收起。
    useEffect(() => {
        const node = page.current;
        if (!node) return;
        let last = node.scrollTop;
        const onScroll = () => {
            const top = node.scrollTop;
            const box = composer.current?.getBoundingClientRect();
            const root = node.getBoundingClientRect();
            const hidden = box ? box.bottom < root.top + 8 : top > 360;
            if (!hidden || top < last - 2) setCapsule(false);
            else if (top > last + 2) setCapsule(true);
            last = top;
        };
        node.addEventListener("scroll", onScroll, { passive: true });
        return () => node.removeEventListener("scroll", onScroll);
    }, []);
    useEffect(() => {
        if (!expanded) return;
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest('[role="dialog"]'))) setExpanded(false);
        };
        document.addEventListener("keydown", escape);
        return () => document.removeEventListener("keydown", escape);
    }, [expanded]);
    useEffect(() => {
        if (!casesOpen || templates) return;
        const controller = new AbortController();
        listPublicCanvasTemplates({ pageSize: 100 }, controller.signal)
            .then((list) => setTemplates(list.items || []))
            .catch(() => !controller.signal.aborted && setTemplates([]));
        return () => controller.abort();
    }, [casesOpen, templates]);

    const focusComposer = () => {
        page.current?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        setCapsule(false);
        window.setTimeout(() => {
            const area = mode === "video" ? videoTextarea.current : composer.current?.querySelector<HTMLTextAreaElement>("textarea");
            area?.focus();
        }, 420);
    };
    const openCases = () => {
        setCasesOpen(true);
        window.setTimeout(() => cases.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), 60);
    };

    const runImageTool = (key: string) => {
        if (key === "detail") return navigate("/shop/detail");
        const item = SHOP_IMAGE_FUNCTIONS.find((entry) => entry.key === key);
        if (!item) return;
        if (item.board) {
            navigate("/shop/image");
            message.info(`点开任意一张生成图，在对照台下方的工具条里使用「${item.label}」`);
            return;
        }
        if (!item.fn || (item.fn !== "chat" && !allowed.includes(item.fn))) {
            message.info(`「${item.label}」即将上线`);
            return;
        }
        setShopFunction(item.fn);
        setMode("image");
        page.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    const videoCases = useMemo(() => (templates || []).filter((item) => !item.canvasId), [templates]);
    const canvasCases = useMemo(() => (templates || []).filter((item) => Boolean(item.canvasId)), [templates]);
    const caseFilters = useMemo(() => {
        if (caseTab === "canvas") return CANVAS_TEMPLATE_CATEGORIES.filter((category) => canvasCases.some((item) => item.category === category.key)).map((category) => ({ key: category.key, label: category.label }));
        if (caseTab === "video") {
            const modes = Array.from(new Set(videoCases.map((item) => "")));
            return modes.filter(Boolean).map((key) => ({ key, label: key }));
        }
        return [];
    }, [caseTab, canvasCases, videoCases]);
    const shownCases = (caseTab === "canvas" ? canvasCases : caseTab === "video" ? videoCases : []).filter((item) => caseFilter === "all" || (caseTab === "canvas" ? item.category === caseFilter : false));

    const composerNode = (
        <div ref={composer} className="sh-composer" data-expanded={expanded || undefined}>
            <button type="button" className="sh-expand" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "收起输入框" : "放大输入框"} title={expanded ? "收起" : "放大"}>
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={mode}
                    className="sh-composer-body"
                    initial={reduced ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                    transition={{ duration: 0.25 }}
                >
                    {mode === "image" ? (
                        <ShopComposer
                            state={tryOn}
                            allowed={allowed}
                            mode={shopMode}
                            onPickFunction={pick}
                            onSubmitted={() => {
                                message.success("已提交，正在前往生成记录");
                                navigate("/shop/image");
                            }}
                        />
                    ) : features.ecommerceVideoEnabled ? (
                        <button type="button" className="sp-primary" onClick={() => navigate("/shop/image?media=video")}>
                            打开视频创作
                        </button>
                    ) : (
                        <div className="sh-disabled">商品视频暂未开放</div>
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );

    return (
        <div ref={page} className="sp-page sh-home ms-scope">
            <div className="sh-dots" aria-hidden />
            <section className="sh-hero">
                <motion.h1 className="sh-title" initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <span>用 {brand}</span>
                    <LayoutGroup id="sh-mode">
                        <span className="sh-mode" role="tablist" aria-label="创作类型">
                            {(
                                [
                                    ["image", "生图"],
                                    ["video", "视频"],
                                ] as const
                            ).map(([value, label]) => (
                                <button key={value} type="button" role="tab" aria-selected={mode === value} data-active={mode === value || undefined} onClick={() => setMode(value)}>
                                    {mode === value ? <motion.i layoutId="sh-mode-pill" className="sh-mode-pill" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 36 }} /> : null}
                                    <span>{label}</span>
                                </button>
                            ))}
                        </span>
                    </LayoutGroup>
                    <span>把创意做成爆款</span>
                </motion.h1>
                {expanded ? <div className="sh-composer-slot" /> : composerNode}
            </section>

            <section className="sh-tools">
                <header>
                    {(
                        [
                            ["tools", "推荐工具"],
                            ["video", "做视频"],
                        ] as const
                    ).map(([value, label]) => (
                        <button key={value} type="button" data-active={toolTab === value || undefined} onClick={() => setToolTab(value)}>
                            {label}
                        </button>
                    ))}
                </header>
                <AnimatePresence mode="wait">
                    <motion.div key={toolTab} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
                        <div className="sh-tiles">
                            {toolTab === "video" ? (
                                features.ecommerceVideoEnabled ? (
                                    <button type="button" className="sh-tile" onClick={() => navigate("/shop/image?media=video")}>
                                        <span className="sh-tile-cover"><Clapperboard className="size-7" aria-hidden /></span>
                                        <span className="sh-tile-copy"><strong>视频创作</strong><small>用提示词和参考素材生成视频</small></span>
                                    </button>
                                ) : <span className="sh-disabled">商品视频暂未开放</span>
                            ) : TOOLS.map((tile, index) => (
                                <motion.button
                                    key={tile.key}
                                    type="button"
                                    className="sh-tile"
                                    onClick={() => runImageTool(tile.key)}
                                    initial={reduced ? false : { opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.04 + index * 0.03 }}
                                    whileTap={reduced ? undefined : { scale: 0.96, transition: { duration: 0.12 } }}
                                >
                                    <span className="sh-tile-cover">
                                        <ImageIcon className="size-7" aria-hidden />
                                    </span>
                                    <span className="sh-tile-copy">
                                        <strong>{tile.key === "detail" ? "详情图" : SHOP_IMAGE_FUNCTIONS.find((item) => item.key === tile.key)?.label}</strong>
                                        <small>{tile.hint}</small>
                                    </span>
                                </motion.button>
                            ))}
                        </div>
                    </motion.div>
                </AnimatePresence>
            </section>

            <section ref={cases} className="sh-cases">
                <button type="button" className="sh-case-pill" aria-expanded={casesOpen} onClick={() => (casesOpen ? setCasesOpen(false) : openCases())}>
                    <span className="sh-case-avatars" aria-hidden>
                        {CASE_COVERS.map((key) => (
                            <i key={key}>
                                <Clapperboard className="size-5" aria-hidden />
                            </i>
                        ))}
                    </span>
                    <span>
                        <strong>看看大家做的案例</strong>
                        <small>真实作品 · 获取创作灵感</small>
                    </span>
                    <ChevronDown className="sh-case-caret size-4" data-open={casesOpen || undefined} />
                </button>
                <AnimatePresence initial={false}>
                    {casesOpen ? (
                        <motion.div className="sh-case-body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                            <div className="sh-case-head">
                                <div className="sh-case-tabs">
                                    {(
                                        [
                                            ["image", "图片"],
                                            ["video", "视频"],
                                            ["canvas", "画布"],
                                        ] as const
                                    ).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            data-active={caseTab === value || undefined}
                                            onClick={() => {
                                                setCaseTab(value);
                                                setCaseFilter("all");
                                            }}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <button type="button" className="sh-case-center" onClick={() => navigate("/inspirations")}>
                                    案例中心 <ArrowRight className="size-3.5" />
                                </button>
                            </div>
                            {caseFilters.length ? (
                                <div className="sh-case-filters">
                                    {[{ key: "all", label: "全部" }, ...caseFilters].map((filter) => (
                                        <button key={filter.key} type="button" data-active={caseFilter === filter.key || undefined} onClick={() => setCaseFilter(filter.key)}>
                                            {filter.key === "all" || caseTab === "video" ? filter.label : canvasTemplateCategoryLabel(filter.key)}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            {caseTab === "image" ? (
                                <p className="sh-case-empty">图片案例即将上线</p>
                            ) : templates === null ? (
                                <p className="sh-case-empty">
                                    <LoaderCircle className="size-4 animate-spin" />
                                </p>
                            ) : shownCases.length ? (
                                <div className="sh-case-grid">
                                    {shownCases.map((item, index) => (
                                        <CaseCard key={item.id} item={item} index={index} onOpen={() => navigate(`/works/${encodeURIComponent(item.id)}?from=shop`)} />
                                    ))}
                                </div>
                            ) : (
                                <p className="sh-case-empty">{caseTab === "video" ? "还没有公开的电商视频作品，在视频作品上点「上传作品」就会出现在这里" : "还没有公开的画布模版"}</p>
                            )}
                            {shownCases.length ? <p className="sh-case-end">没有更多了</p> : null}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </section>

            <AnimatePresence>
                {capsule && !expanded ? (
                    <motion.button
                        type="button"
                        className="sh-capsule"
                        onClick={focusComposer}
                        initial={reduced ? false : { opacity: 0, y: 30, scale: 0.9, filter: "blur(8px)", x: "-50%" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", x: "-50%" }}
                        exit={{ opacity: 0, y: 24, scale: 0.94, filter: "blur(6px)", x: "-50%" }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    >
                        <span className="sh-capsule-spark" aria-hidden />
                        <span className="sh-capsule-text">{mode === "video" ? "描述想要的视频，上传商品图就能出片，输入 @ 引用素材" : chat ? "描述你要的画面，可上传参考图，输入 @ 引用图片" : "上传商品图，描述想要的效果"}</span>
                        <span className="sh-capsule-go">
                            <ArrowUp className="size-4" />
                        </span>
                    </motion.button>
                ) : null}
            </AnimatePresence>

            <AnimatePresence>
                {expanded ? (
                    <motion.div className="sh-expanded" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && setExpanded(false)}>
                        <motion.div className="sh-expanded-inner" initial={reduced ? false : { scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 320, damping: 30 }}>
                            {composerNode}
                        </motion.div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
