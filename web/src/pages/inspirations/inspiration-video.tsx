import { Expand, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CreationInspiration } from "@/lib/inspirations/catalog";

const LOAD_TIMEOUT_MS = 8000;

function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    const minutes = Math.floor(whole / 60);
    const hours = Math.floor(minutes / 60);
    const time = `${String(minutes % 60).padStart(hours ? 2 : 1, "0")}:${String(whole % 60).padStart(2, "0")}`;
    return hours ? `${hours}:${time}` : time;
}

export function InspirationVideo({ item, hovered = false, detail = false }: { item: CreationInspiration; hovered?: boolean; detail?: boolean }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const playRequest = useRef(0);
    const failureHandledFor = useRef(-1);
    const retryCount = useRef(0);
    const wantsPlayback = useRef(false);
    const manuallyPaused = useRef(false);
    const wasHovered = useRef(false);
    const [playing, setPlaying] = useState(false);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [stalled, setStalled] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [fullscreen, setFullscreen] = useState(false);
    const [reloadCount, setReloadCount] = useState(0);

    const clearWatchdog = useCallback(() => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const retryOrStop = useCallback((mediaError: boolean) => {
        clearWatchdog();
        if (!wantsPlayback.current || failureHandledFor.current === playRequest.current) return;
        failureHandledFor.current = playRequest.current;
        if (retryCount.current < 1) {
            retryCount.current += 1;
            setReloadCount((count) => count + 1);
            return;
        }
        playRequest.current += 1;
        videoRef.current?.pause();
        setPlaying(false);
        setLoading(false);
        setFailed(mediaError);
        setStalled(!mediaError);
    }, [clearWatchdog]);

    const scheduleWatchdog = useCallback((request: number, video: HTMLVideoElement) => {
        if (timerRef.current !== null) return;
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            if (request !== playRequest.current || !wantsPlayback.current) return;
            if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
            retryOrStop(false);
        }, LOAD_TIMEOUT_MS);
    }, [retryOrStop]);

    const startPlayback = useCallback((reload = false) => {
        const video = videoRef.current;
        if (!video) return;
        wantsPlayback.current = true;
        const request = ++playRequest.current;
        clearWatchdog();
        setFailed(false);
        setStalled(false);
        setLoading(true);
        if (reload) video.load();
        scheduleWatchdog(request, video);
        void video.play().then(() => {
            if (request !== playRequest.current) return;
            clearWatchdog();
            setPlaying(!video.paused);
            setLoading(false);
        }).catch((error: unknown) => {
            if (request !== playRequest.current) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            if (error instanceof DOMException && error.name === "NotAllowedError") {
                clearWatchdog();
                setLoading(false);
                setStalled(true);
                return;
            }
            retryOrStop(true);
        });
    }, [clearWatchdog, retryOrStop, scheduleWatchdog]);

    const pausePlayback = useCallback(() => {
        wantsPlayback.current = false;
        playRequest.current += 1;
        clearWatchdog();
        videoRef.current?.pause();
        setPlaying(false);
        setLoading(false);
    }, [clearWatchdog]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (hovered && !wasHovered.current) {
            manuallyPaused.current = false;
            retryCount.current = 0;
        }
        wasHovered.current = hovered;
        if (detail) return;
        if (!hovered && !fullscreen) {
            pausePlayback();
            return;
        }
        if (manuallyPaused.current || !hovered) return;
        startPlayback(Boolean(video.error));
        return () => {
            if (!document.fullscreenElement) pausePlayback();
        };
    }, [hovered, detail, fullscreen, item.videoUrl, pausePlayback, startPlayback]);

    useEffect(() => {
        if (reloadCount === 0 || !wantsPlayback.current) return;
        startPlayback(true);
    }, [reloadCount, startPlayback]);

    useEffect(() => {
        const frame = frameRef.current;
        const video = videoRef.current;
        const onFullscreenChange = () => setFullscreen(document.fullscreenElement === frame);
        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", onFullscreenChange);
            wantsPlayback.current = false;
            playRequest.current += 1;
            clearWatchdog();
            video?.pause();
        };
    }, [clearWatchdog]);

    const togglePlayback = () => {
        if (wantsPlayback.current && (playing || loading)) {
            manuallyPaused.current = true;
            pausePlayback();
            return;
        }
        manuallyPaused.current = false;
        retryCount.current = 0;
        startPlayback(Boolean(videoRef.current?.error) || failed || stalled);
    };

    const retryPlayback = () => {
        manuallyPaused.current = false;
        retryCount.current = 0;
        startPlayback(true);
    };

    const updateTimeline = () => {
        const video = videoRef.current;
        if (!video) return;
        setCurrentTime(video.currentTime);
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };

    const seekTo = (seconds: number) => {
        const video = videoRef.current;
        if (!video || !duration) return;
        video.currentTime = seconds;
        setCurrentTime(seconds);
    };

    return (
        <div ref={frameRef} className={`inspiration-video ${detail ? "is-detail" : "is-card"}`}>
            <video
                ref={videoRef}
                src={item.videoUrl}
                poster={item.image}
                preload={detail ? "metadata" : "none"}
                playsInline
                muted={!detail}
                loop={!detail}
                onPlaying={() => {
                    if (!wantsPlayback.current) { videoRef.current?.pause(); return; }
                    clearWatchdog();
                    setPlaying(true);
                    setLoading(false);
                    setStalled(false);
                }}
                onPause={() => setPlaying(false)}
                onWaiting={() => { if (wantsPlayback.current && videoRef.current) { setLoading(true); scheduleWatchdog(playRequest.current, videoRef.current); } }}
                onStalled={() => { if (wantsPlayback.current && videoRef.current) { setLoading(true); scheduleWatchdog(playRequest.current, videoRef.current); } }}
                onTimeUpdate={updateTimeline}
                onLoadedMetadata={updateTimeline}
                onDurationChange={updateTimeline}
                onSeeked={updateTimeline}
                onError={() => { if (wantsPlayback.current) retryOrStop(true); else setFailed(true); }}
                aria-label={item.title}
            />
            {failed ? <img className="inspiration-video-fallback" src={item.image} alt="" referrerPolicy="no-referrer" /> : null}
            <div className="inspiration-video-controls" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <input
                    className="inspiration-video-progress"
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.1}
                    value={Math.min(currentTime, duration || 1)}
                    disabled={!duration}
                    aria-label={`${item.title} 播放进度`}
                    aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
                    style={{ "--video-progress": `${duration ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
                    onChange={(event) => seekTo(Number(event.currentTarget.value))}
                />
                <div className="inspiration-video-control-row">
                    <button type="button" className="inspiration-video-button" aria-label={playing || loading ? "暂停视频" : "播放视频"} onClick={togglePlayback}>
                        {playing || loading ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </button>
                    <span className="inspiration-video-time" role="status">{failed ? "视频加载失败" : stalled ? "加载较慢，请重试" : loading ? "正在加载…" : `${formatTime(currentTime)} / ${formatTime(duration)}`}</span>
                    {failed || stalled ? (
                        <button type="button" className="inspiration-video-button" aria-label="重试播放视频" onClick={retryPlayback}>
                            <RotateCcw className="size-4" />
                        </button>
                    ) : null}
                    <button type="button" className="inspiration-video-button" aria-label="放大视频" onClick={() => void frameRef.current?.requestFullscreen?.()}>
                        <Expand className="size-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
