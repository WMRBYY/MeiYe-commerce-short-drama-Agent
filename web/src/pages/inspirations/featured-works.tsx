import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, Search, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { catalogIdOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import "./featured-works.css";

// The catalog has playable media but no public work-like count or canvas/skill relation.
// Keep this selection editorial and only show entries with a real video URL.
const featuredTitles = [
    "复古餐厅时间冻结与倒放",
    "首尔夏夜 Vlog",
    "双人 K-pop MV 逐镜分镜",
    "mini DV 咖啡 ASMR vlog",
    "雨天清晨赶往大学的咖啡日常",
    "黑衣女子静立于同步人群中央",
    "夏日厨房里的日式猪排盖饭",
    "实验室寄生体感染突袭",
    "护肤品自拍口播 UGC 广告",
    "蓝夹克双辫女剑士破框而出",
    "千禧年代韩国女孩生日聚会",
    "奶奶与狸猫麻雀逛早市",
];

const categoryGroups = [
    { id: "all", label: "全部", codes: [] },
    { id: "film", label: "影视短片", codes: ["cinematic-narrative-short", "dialogue-performance-beats", "horror-suspense", "pov-continuous-take", "time-freeze-rewind", "retro-found-footage"] },
    { id: "vlog", label: "生活 Vlog", codes: ["handheld-ugc-vlog", "fashion-lookbook", "ugc-creator-review", "pet-animal"] },
    { id: "ads", label: "商业广告", codes: ["product-commercial-shotlist", "car-vehicle"] },
    { id: "anime", label: "动漫游戏", codes: ["anime-style-lock", "3d-cartoon", "game-ui-livestream", "stop-motion-cadence"] },
    { id: "music", label: "音乐舞蹈", codes: ["music-beat-sync-mv", "combat-choreography", "sports-extreme"] },
    { id: "travel", label: "旅行美食", codes: ["travel-city-walk", "food-asmr"] },
    { id: "craft", label: "创作技巧", codes: ["storyboard-grid-to-video", "timeline-shot-script", "process-transformation-montage", "character-reference-lock"] },
    { id: "other", label: "其他创意", codes: [] },
] as const;

const codeToGroup = new Map<string, string>(categoryGroups.flatMap((group) => group.codes.map((code) => [code, group.id] as const)));

function groupOf(item: CreationInspiration) {
    return codeToGroup.get(item.category ?? "") ?? "other";
}

function timeLabel(value: number) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function WorkCard({ item, prominent, recommended, previewing, duration, onPreview, onStopPreview, onDuration, onOpen }: {
    item: CreationInspiration;
    prominent: boolean;
    recommended: boolean;
    previewing: boolean;
    duration?: number;
    onPreview: () => void;
    onStopPreview: () => void;
    onDuration: (seconds: number) => void;
    onOpen: () => void;
}) {
    const [ready, setReady] = useState(false);
    const [previewSlow, setPreviewSlow] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if (!previewing) {
            setReady(false);
            setPreviewSlow(false);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        let active = true;
        const timer = window.setTimeout(() => { if (active && (video.paused || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)) setPreviewSlow(true); }, 8000);
        video.load();
        void video.play().catch((error: unknown) => {
            if (active && !(error instanceof DOMException && error.name === "AbortError")) setPreviewSlow(true);
        });
        return () => {
            active = false;
            window.clearTimeout(timer);
            video.pause();
        };
    }, [previewing, item.videoUrl]);
    return (
        <article className={`featured-work-card${prominent ? " is-prominent" : ""}`}>
            <button type="button" className="featured-work-open" onPointerEnter={(event) => { if (event.pointerType === "mouse" || event.pointerType === "pen") onPreview(); }} onPointerMove={(event) => { if (!previewing && (event.pointerType === "mouse" || event.pointerType === "pen")) onPreview(); }} onPointerLeave={onStopPreview} onFocus={onPreview} onBlur={onStopPreview} onClick={onOpen} aria-label={`查看作品：${item.title}`}>
                <span className="featured-work-cover">
                    <img src={item.image} alt="" loading={prominent ? "eager" : "lazy"} decoding="async" />
                    {previewing ? <video ref={videoRef} src={item.videoUrl} poster={item.image} className={ready ? "is-ready" : ""} autoPlay muted loop playsInline preload="auto" onLoadedMetadata={(event) => onDuration(event.currentTarget.duration)} onPlaying={() => { setReady(true); setPreviewSlow(false); }} onError={() => setPreviewSlow(true)} aria-hidden="true" /> : null}
                    {recommended ? <span className="featured-work-recommend">推荐</span> : null}
                    {duration ? <span className="featured-work-duration">{timeLabel(duration)}</span> : null}
                    {previewing ? <span className="featured-work-hover-label">{previewSlow ? "视频加载较慢，点击查看" : ready ? "查看作品" : "正在加载视频…"}</span> : null}
                </span>
                <span className="featured-work-title">{item.title}</span>
                <span className="featured-work-author">{item.credit || "精选创作者"}</span>
            </button>
        </article>
    );
}

function WorkViewer({ works, startIndex, onClose }: { works: CreationInspiration[]; startIndex: number; onClose: () => void }) {
    const [index, setIndex] = useState(startIndex);
    const [player, setPlayer] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackIssue, setPlaybackIssue] = useState<"" | "slow" | "failed">("");
    const videoRef = useRef<HTMLVideoElement>(null);
    const startupTimerRef = useRef<number | null>(null);
    const item = works[index];
    const stripSize = Math.min(11, works.length);
    const stripIndices = Array.from({ length: stripSize }, (_, offset) => ((index - Math.floor(stripSize / 2) + offset) % works.length + works.length) % works.length);
    const togglePlayback = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play().catch(() => setPlaybackIssue("failed"));
        else video.pause();
    }, []);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
            if (event.key === "ArrowLeft") setIndex((value) => (value - 1 + works.length) % works.length);
            if (event.key === "ArrowRight") setIndex((value) => (value + 1) % works.length);
            if ((event.code === "Space" || event.key === " ") && !event.repeat) {
                const target = event.target;
                if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, button, [role='button']"))) return;
                event.preventDefault();
                togglePlayback();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [onClose, togglePlayback, works.length]);

    useEffect(() => {
        setPlayer(false);
        setPlaying(false);
        setMuted(true);
        setCurrentTime(0);
        setDuration(0);
    }, [index]);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        let active = true;
        setPlaybackIssue("");
        startupTimerRef.current = window.setTimeout(() => {
            if (active && (video.paused || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)) setPlaybackIssue("slow");
        }, 8000);
        video.load();
        void video.play().catch((error: unknown) => {
            if (active && !(error instanceof DOMException && error.name === "AbortError")) setPlaybackIssue("failed");
        });
        return () => {
            active = false;
            if (startupTimerRef.current !== null) window.clearTimeout(startupTimerRef.current);
            startupTimerRef.current = null;
        };
    }, [item.videoUrl]);
    const select = (next: number) => setIndex((next + works.length) % works.length);
    const retryPlayback = () => {
        const video = videoRef.current;
        if (!video) return;
        setPlaybackIssue("");
        video.load();
        void video.play().catch(() => setPlaybackIssue("failed"));
    };
    const enterPlayer = () => {
        setPlayer(true);
        setMuted(false);
        const video = videoRef.current;
        if (video) {
            video.loop = false;
            video.muted = false;
            video.currentTime = 0;
            void video.play().catch(() => {
                setMuted(true);
                video.muted = true;
                void video.play().catch(() => setPlaybackIssue("failed"));
            });
        }
    };
    const returnToOverview = () => {
        setPlayer(false);
        setMuted(true);
        const video = videoRef.current;
        if (video) {
            video.muted = true;
            video.loop = true;
            video.currentTime = 0;
            void video.play().catch(() => setPlaybackIssue("failed"));
        }
    };
    return createPortal(
        <div className={`featured-viewer${player ? " is-player" : ""}`} role="dialog" aria-modal="true" aria-label={`${item.title}作品预览`}>
            <div className="featured-viewer-media">
                <video
                    key={catalogIdOf(item)}
                    ref={videoRef}
                    src={item.videoUrl}
                    poster={item.image}
                    autoPlay
                    muted={muted}
                    loop={!player}
                    playsInline
                    preload="auto"
                    onPlaying={() => { if (startupTimerRef.current !== null) window.clearTimeout(startupTimerRef.current); startupTimerRef.current = null; setPlaying(true); setPlaybackIssue(""); }}
                    onPause={() => setPlaying(false)}
                    onError={() => setPlaybackIssue("failed")}
                    onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    aria-label={item.title}
                />
            </div>
            <button type="button" className="featured-viewer-video-hit" tabIndex={-1} aria-hidden="true" onClick={player ? togglePlayback : enterPlayer} />
            {playbackIssue ? <div className="featured-viewer-playback-status" role="alert">
                <span>{playbackIssue === "slow" ? "视频加载较慢，请重试" : "视频加载失败，请重试"}</span>
                <button type="button" onClick={retryPlayback}>重新播放</button>
            </div> : null}
            {!player ? (
                <>
                    <div className="featured-viewer-shade" />
                    <div className="featured-viewer-info">
                        <button type="button" className="featured-viewer-close" onClick={onClose}>
                            <X size={16} /> 关闭 <kbd>ESC</kbd>
                        </button>
                        <span className="featured-viewer-kicker">精选作品</span>
                        <h2>{item.title}</h2>
                        <dl>
                            <div>
                                <dt>作者</dt>
                                <dd>{item.credit || "精选创作者"}</dd>
                            </div>
                            <div>
                                <dt>类型</dt>
                                <dd>视频作品</dd>
                            </div>
                        </dl>
                        {item.description ? <p>{item.description}</p> : null}
                        <div className="featured-viewer-future-actions">
                            <button type="button" disabled title="画布关联将在后续开放">
                                查看画布
                            </button>
                            <button type="button" disabled title="技能关联将在后续开放">
                                查看技能
                            </button>
                        </div>
                    </div>
                    <button type="button" className="featured-viewer-main-play" onClick={enterPlayer} aria-label="播放完整视频">
                        <Play fill="currentColor" size={34} />
                    </button>
                    <div className="featured-viewer-strip-wrap">
                        <button type="button" className="featured-viewer-strip-arrow" onClick={() => select(index - 1)} aria-label="上一个作品">
                            <ChevronLeft />
                        </button>
                        <div className="featured-viewer-strip">
                            {stripIndices.map((workIndex) => {
                                const work = works[workIndex];
                                return (
                                <button key={catalogIdOf(work)} type="button" aria-label={`查看${work.title}`} aria-current={workIndex === index} onClick={() => select(workIndex)}>
                                    <img src={work.image} alt="" loading="lazy" />
                                </button>
                                );
                            })}
                        </div>
                        <button type="button" className="featured-viewer-strip-arrow" onClick={() => select(index + 1)} aria-label="下一个作品">
                            <ChevronRight />
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <button type="button" className="featured-player-back" onClick={returnToOverview} aria-label="返回作品详情">
                        <ArrowLeft size={20} />
                    </button>
                    <button type="button" className="featured-player-center" onClick={togglePlayback} aria-label={playing ? "暂停视频" : "播放视频"}>
                        {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
                    </button>
                    <div className="featured-player-controls">
                        <button type="button" onClick={togglePlayback} aria-label={playing ? "暂停视频" : "播放视频"}>
                            {playing ? <Pause size={17} /> : <Play size={17} />}
                        </button>
                        <span>
                            {timeLabel(currentTime)} / {timeLabel(duration)}
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={duration || 1}
                            step="0.1"
                            value={Math.min(currentTime, duration || 1)}
                            disabled={!duration}
                            onChange={(event) => {
                                if (videoRef.current) videoRef.current.currentTime = Number(event.target.value);
                            }}
                            aria-label="视频播放进度"
                        />
                        <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "开启声音" : "静音"}>
                            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                    </div>
                </>
            )}
        </div>,
        document.body,
    );
}

export function FeaturedWorks({ entries }: { entries: CreationInspiration[] }) {
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [activePreview, setActivePreview] = useState<string | null>(null);
    const [durations, setDurations] = useState<Record<string, number>>({});
    const [category, setCategory] = useState("all");
    const [search, setSearch] = useState("");
    const query = useDebouncedValue(search.trim().toLocaleLowerCase(), 220);
    const [visibleCount, setVisibleCount] = useState(24);
    const sentinelRef = useRef<HTMLDivElement>(null);

    const indexed = useMemo(() => {
        const preferred = new Map(featuredTitles.map((title, index) => [title, index]));
        const ordered = entries.filter((item) => item.mode === "video" && item.videoUrl).sort((left, right) => {
            const leftRank = preferred.get(left.title);
            const rightRank = preferred.get(right.title);
            return leftRank === undefined ? (rightRank === undefined ? 0 : 1) : (rightRank === undefined ? -1 : leftRank - rightRank);
        });
        return ordered.map((item) => ({
            item,
            group: groupOf(item),
            titleText: item.title.toLocaleLowerCase(),
            metadataText: [item.credit, item.category, ...(item.tags ?? [])].filter(Boolean).join(" ").toLocaleLowerCase(),
            descriptionText: item.description.toLocaleLowerCase(),
            promptText: item.prompt.toLocaleLowerCase(),
        }));
    }, [entries]);
    const works = useMemo(() => {
        const parts = query.split(/\s+/).filter(Boolean);
        const matching = indexed.filter(({ group, titleText, metadataText, descriptionText, promptText }) =>
            (category === "all" || group === category) && parts.every((part) =>
                titleText.includes(part) || metadataText.includes(part) || descriptionText.includes(part) || promptText.includes(part)));
        if (query) matching.sort((left, right) => {
            const rank = (entry: typeof left) => entry.titleText.includes(query) ? 0 : entry.metadataText.includes(query) ? 1 : entry.descriptionText.includes(query) ? 2 : 3;
            return rank(left) - rank(right);
        });
        return matching.map(({ item }) => item);
    }, [indexed, category, query]);
    const shown = works.slice(0, visibleCount);

    useEffect(() => { setVisibleCount(24); setActivePreview(null); }, [category, query]);
    useEffect(() => {
        if (visibleCount >= works.length || typeof IntersectionObserver === "undefined") return;
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting) setVisibleCount((count) => Math.min(count + 24, works.length));
        }, { rootMargin: "700px" });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [visibleCount, works.length]);
    useEffect(() => {
        const scrollHost = document.querySelector(".creation-home-scroll") ?? window;
        const stop = () => setActivePreview(null);
        scrollHost.addEventListener("scroll", stop, { passive: true });
        return () => scrollHost.removeEventListener("scroll", stop);
    }, []);

    return (
        <section className="featured-works" aria-labelledby="featured-works-title">
            <div className="featured-works-heading">
                <h2 id="featured-works-title">创作精选</h2>
                <div className="featured-works-controls">
                    <div className="featured-works-categories" role="tablist" aria-label="视频作品分类">
                        {categoryGroups.map((group) => <button key={group.id} type="button" role="tab" aria-selected={category === group.id} onClick={() => setCategory(group.id)}>{group.label}</button>)}
                    </div>
                    <label className="featured-works-search">
                        <span className="sr-only">搜索视频作品</span>
                        <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="搜索作品、作者或提示词" />
                        <Search size={17} aria-hidden="true" />
                    </label>
                </div>
            </div>
            <p className="featured-works-count">共 {works.length.toLocaleString("zh-CN")} 个视频作品</p>
            <div className="featured-works-grid">
                {shown.map((item, index) => {
                    const id = catalogIdOf(item);
                    return <WorkCard key={id} item={item} prominent={index === 0} recommended={featuredTitles.includes(item.title)} previewing={activePreview === id && openIndex === null} duration={durations[id]} onPreview={() => setActivePreview(id)} onStopPreview={() => setActivePreview((current) => current === id ? null : current)} onDuration={(seconds) => setDurations((current) => current[id] === seconds ? current : { ...current, [id]: seconds })} onOpen={() => { setActivePreview(null); setOpenIndex(index); }} />;
                })}
            </div>
            {!works.length ? <div className="featured-works-empty">没有找到相关视频，试试其他分类或关键词。</div> : null}
            {visibleCount < works.length ? <div ref={sentinelRef} className="featured-works-sentinel" role="status">继续下滑，加载更多视频…</div> : null}
            {openIndex !== null ? <WorkViewer works={works} startIndex={openIndex} onClose={() => setOpenIndex(null)} /> : null}
        </section>
    );
}
