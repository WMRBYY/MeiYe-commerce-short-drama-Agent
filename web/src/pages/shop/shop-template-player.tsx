import { Button } from "antd";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The modal player keeps transport controls outside the picture, including on mobile. */
export function ShopTemplatePlayer({ src, poster, title }: { src: string; poster?: string; title: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(true);
    const [duration, setDuration] = useState(0);
    const [time, setTime] = useState(0);
    const [error, setError] = useState("");
    useEffect(() => {
        const video = ref.current;
        return () => video?.pause();
    }, []);
    const toggle = () => {
        const video = ref.current;
        if (!video) return;
        if (video.paused) void video.play().catch(() => setError("视频暂时无法播放，请稍后重试"));
        else video.pause();
    };
    return (
        <div className="spt-player">
            <div className="spt-player-picture">
                <video
                    ref={ref}
                    src={src}
                    poster={poster}
                    muted={muted}
                    loop
                    playsInline
                    preload="metadata"
                    aria-label={title}
                    onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                    onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                    onCanPlay={() => setError("")}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onError={() => setError("视频暂时无法播放，请稍后重试")}
                    onClick={toggle}
                />
                {!playing && !error ? <Button className="spt-player-start" shape="circle" size="large" aria-label="播放模板视频" icon={<Play />} onClick={toggle} /> : null}
            </div>
            <div className="spt-transport">
                <Button type="text" aria-label={playing ? "暂停视频" : "播放视频"} icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={toggle} disabled={Boolean(error)} />
                <input
                    type="range"
                    aria-label="视频进度"
                    min={0}
                    max={duration || 1}
                    step={0.05}
                    value={Math.min(time, duration || 1)}
                    disabled={!duration}
                    onChange={(event) => {
                        if (ref.current) ref.current.currentTime = Number(event.target.value);
                        setTime(Number(event.target.value));
                    }}
                />
                <time>
                    {clock(time)} / {clock(duration)}
                </time>
                <Button type="text" aria-label={muted ? "开启声音" : "静音"} icon={muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} onClick={() => setMuted(!muted)} />
            </div>
            {error ? (
                <div className="spt-player-error">
                    <p className="spt-error" role="alert">
                        {error}
                    </p>
                    <Button
                        onClick={() => {
                            setError("");
                            ref.current?.load();
                        }}
                    >
                        重新载入视频
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
