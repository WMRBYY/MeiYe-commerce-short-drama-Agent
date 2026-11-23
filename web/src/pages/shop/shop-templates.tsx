import { Button, Input, Upload } from "antd";
import { ArrowUpRight, Box, Clapperboard, Coffee, Gift, ImagePlus, LayoutGrid, Mic, PackageOpen, Pause, Play, ScanLine, Search, Shirt, Sparkles, SquarePlay, Video, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceNoResultsState } from "@/components/layout/workspace-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { createClientUUID } from "@/lib/client-id";

import { useUserStore } from "@/stores/use-user-store";

import { matchesShopTemplateDuration, SHOP_TEMPLATE_FORMATS, SHOP_TEMPLATE_MIN_SECONDS, SHOP_VIDEO_TEMPLATES, type ShopTemplateDuration, type ShopTemplateFormat, type ShopVideoTemplate } from "./shop-template-catalog";
import { ShopTemplatePlayer } from "./shop-template-player";
import "./shop-templates.css";

const formatIcons = { talking: Mic, unboxing: PackageOpen, demo: SquarePlay, detail: ScanLine, display: Box, lifestyle: Coffee, lookbook: Shirt, story: Clapperboard, effects: Sparkles, campaign: Gift };
const formats = Object.keys(SHOP_TEMPLATE_FORMATS) as ShopTemplateFormat[];
const categories = [...new Set(SHOP_VIDEO_TEMPLATES.map((item) => item.category))];

function TemplateCard({ template, autoplay, suspended, onOpen }: { template: ShopVideoTemplate; autoplay: boolean; suspended: boolean; onOpen: (trigger: HTMLButtonElement) => void }) {
    const root = useRef<HTMLElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [visible, setVisible] = useState(false);
    const [failed, setFailed] = useState(false);
    const [blocked, setBlocked] = useState(false);
    useEffect(() => {
        const target = root.current;
        if (!target) return;
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.12 });
        observer.observe(target);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        let active = true;
        const sync = () => {
            if (visible && autoplay && !suspended && !document.hidden)
                void element
                    .play()
                    .then(() => {
                        if (active) setBlocked(false);
                    })
                    .catch((cause: DOMException) => {
                        if (active && cause.name !== "AbortError") setBlocked(true);
                    });
            else element.pause();
        };
        sync();
        document.addEventListener("visibilitychange", sync);
        return () => {
            active = false;
            element.pause();
            document.removeEventListener("visibilitychange", sync);
        };
    }, [visible, autoplay, suspended]);
    return (
        <article ref={root} className="spt-card">
            <button type="button" className="spt-card-open" aria-label={`预览${template.title}`} onClick={(event) => onOpen(event.currentTarget)}>
                <video ref={video} src={visible ? template.videoUrl : undefined} poster={template.posterUrl} muted loop playsInline preload="none" aria-hidden="true" onCanPlay={() => setFailed(false)} onError={() => setFailed(true)} />
                <span className="spt-card-duration">
                    <Video className="size-3" />
                    {template.durationSeconds ? `${template.durationSeconds} 秒` : "视频"}
                </span>
                {failed ? (
                    <span className="spt-card-status">预览暂不可用，点击查看</span>
                ) : blocked && autoplay ? (
                    <span className="spt-card-status">
                        <Play className="size-4" />
                        点击播放
                    </span>
                ) : null}
                <span className="spt-card-overlay" aria-hidden="true">
                    <span className="spt-card-name">{template.title}</span>
                    <span className="spt-card-action">
                        预览 <ArrowUpRight className="size-3.5" />
                    </span>
                </span>
            </button>
            <div className="spt-card-caption">
                <strong>{template.title}</strong>
                <span>
                    {SHOP_TEMPLATE_FORMATS[template.format]} · {template.category}
                </span>
            </div>
        </article>
    );
}

function TemplatePreviewDialog({ template, onClose }: { template: ShopVideoTemplate; onClose: () => void }) {
    return (
        <AppModal open title={template.title} footer={null} onCancel={onClose}>
            <ShopTemplatePlayer src={template.videoUrl} poster={template.posterUrl} title={template.title} />
        </AppModal>
    );
}

export default function ShopTemplates() {
    const reduced = useReducedMotion();
    const [autoplay, setAutoplay] = useState(true);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const [format, setFormat] = useState<ShopTemplateFormat | "">("");
    const [duration, setDuration] = useState<ShopTemplateDuration>("long");
    const [selected, setSelected] = useState<ShopVideoTemplate | null>(null);
    const opener = useRef<HTMLButtonElement | null>(null);
    const closeDialog = () => {
        setSelected(null);
        requestAnimationFrame(() => {
            if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
        });
    };
    const resetFilters = () => {
        setQuery("");
        setCategory("");
        setFormat("");
        setDuration("long");
    };
    const search = query.trim().toLocaleLowerCase();
    const filtered = SHOP_VIDEO_TEMPLATES.filter(
        (item) =>
            matchesShopTemplateDuration(item.durationSeconds, duration) &&
            (!format || item.format === format) &&
            (!category || item.category === category) &&
            (!search || [item.title, item.description, item.category, SHOP_TEMPLATE_FORMATS[item.format], ...item.tags].join(" ").toLocaleLowerCase().includes(search)),
    );
    return (
        <WorkspacePage className="spt-page ms-scope">
            <PageHeader
                title="视频模板"
                description="浏览并预览此部署提供的视频模板。"
                meta={
                    <span className="spt-count" aria-live="polite" aria-atomic="true">
                        {filtered.length} / {SHOP_VIDEO_TEMPLATES.length} 个模板
                    </span>
                }
            />
            <CollectionToolbar
                label="搜索视频模板"
                active={Boolean(query || category || format || duration !== "long")}
                onReset={resetFilters}
                trailing={
                    <Button
                        className="spt-preview-toggle"
                        shape="round"
                        icon={autoplay && !reduced ? <Pause className="size-4" /> : <Play className="size-4" />}
                        onClick={() => setAutoplay(!autoplay)}
                        disabled={Boolean(reduced)}
                        aria-pressed={autoplay && !reduced}
                    >
                        {reduced ? "已减少动态效果" : autoplay ? "暂停预览" : "自动播放"}
                    </Button>
                }
            >
                <Input className="spt-search" prefix={<Search className="size-4" />} value={query} onChange={(event) => setQuery(event.target.value)} allowClear aria-label="搜索模板" placeholder="搜索模板、创意或商品" />
            </CollectionToolbar>
            <div className="spt-filters">
                <span className="spt-filter-label" aria-hidden="true">
                    时长
                </span>
                <SegmentedControl
                    className="spt-duration-filter"
                    ariaLabel="模板时长"
                    value={duration}
                    options={[
                        { value: "long", label: `${SHOP_TEMPLATE_MIN_SECONDS} 秒及以上` },
                        { value: "short", label: `少于 ${SHOP_TEMPLATE_MIN_SECONDS} 秒` },
                        { value: "all", label: "全部时长" },
                    ]}
                    onChange={setDuration}
                />
                <span className="spt-filter-label" aria-hidden="true">
                    形式
                </span>
                <div className="spt-filter-options" role="group" aria-label="视频形式">
                    <Button className="spt-filter-chip" type="text" shape="round" size="small" icon={<LayoutGrid />} aria-pressed={!format} onClick={() => setFormat("")}>
                        全部形式
                    </Button>
                    {formats.map((item) => {
                        const Icon = formatIcons[item];
                        return (
                            <Button className="spt-filter-chip" key={item} type="text" shape="round" size="small" icon={<Icon />} aria-pressed={format === item} onClick={() => setFormat(item)}>
                                {SHOP_TEMPLATE_FORMATS[item]}
                            </Button>
                        );
                    })}
                </div>
                <span className="spt-filter-label" aria-hidden="true">
                    品类
                </span>
                <div className="spt-filter-options" role="group" aria-label="模板分类">
                    <Button className="spt-filter-chip" type="text" shape="round" size="small" aria-pressed={!category} onClick={() => setCategory("")}>
                        全部品类
                    </Button>
                    {categories.map((item) => (
                        <Button className="spt-filter-chip" key={item} type="text" shape="round" size="small" aria-pressed={category === item} onClick={() => setCategory(item)}>
                            {item}
                        </Button>
                    ))}
                </div>
            </div>
            {filtered.length ? (
                <div className="spt-grid">
                    {filtered.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            autoplay={autoplay && !reduced}
                            suspended={Boolean(selected)}
                            onOpen={(trigger) => {
                                opener.current = trigger;
                                setSelected(template);
                            }}
                        />
                    ))}
                </div>
            ) : (
                <WorkspaceNoResultsState query={query} onClear={resetFilters} />
            )}
            <p className="spt-library-note">
                素材来自{" "}
                <a href="https://github.com/refvid/awesome-reference-to-video-prompts" target="_blank" rel="noreferrer">
                    RefVid
                </a>{" "}
                和{" "}
                <a href="https://commons.wikimedia.org/" target="_blank" rel="noreferrer">
                    Wikimedia Commons
                </a>
                ，授权与原片见模板详情。
            </p>
            {selected ? <TemplatePreviewDialog key={selected.id} template={selected} onClose={closeDialog} /> : null}
        </WorkspacePage>
    );
}
