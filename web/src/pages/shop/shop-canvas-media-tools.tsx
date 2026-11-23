import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { useRef, useState } from "react";
import { App, Tooltip } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { resourceStorageKey, resolveResourceVariantUrl, uploadResourceFile } from "@/services/api/resources";
import { downloadBrowserMedia } from "@/services/browser-download";
import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import { ShopNodeToolbar } from "./shop-node-toolbar";

const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
export function ShopCanvasVideo({ resourceId, nodeSelectable = false }: { resourceId: string; nodeSelectable?: boolean }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false),
        [muted, setMuted] = useState(false),
        [duration, setDuration] = useState(0),
        [current, setCurrent] = useState(0),
        [error, setError] = useState(false);
    return (
        <div className="sp-node-video" data-canvas-no-zoom={!nodeSelectable || undefined} onPointerDown={nodeSelectable ? undefined : (event) => event.stopPropagation()}>
            <video
                ref={ref}
                src={resolveResourceVariantUrl(resourceStorageKey(resourceId), "playback")}
                playsInline
                preload="metadata"
                muted={muted}
                onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
                onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setError(true)}
            />
            {error ? <span role="status">视频暂时无法播放，请重试或下载查看</span> : null}
            <div className="sp-video-controls" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
                <button
                    aria-label={playing ? "暂停视频" : "播放视频"}
                    title={playing ? "暂停视频" : "播放视频"}
                    onClick={() => {
                        if (playing) ref.current?.pause();
                        else void ref.current?.play().catch(() => setError(true));
                    }}
                >
                    {playing ? <ShopCanvasGlyph name="pause" size={15} /> : <ShopCanvasGlyph name="play" size={15} />}
                </button>
                <small>{time(current)}</small>
                <input
                    aria-label="视频进度"
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.05}
                    value={current}
                    onChange={(e) => {
                        if (ref.current) ref.current.currentTime = Number(e.target.value);
                    }}
                />
                <small>{time(duration)}</small>
                <button aria-label={muted ? "开启声音" : "静音"} title={muted ? "开启声音" : "静音"} onClick={() => setMuted(!muted)}>
                    {muted ? <ShopCanvasGlyph name="mute" size={15} /> : <ShopCanvasGlyph name="volume" size={15} />}
                </button>
            </div>
        </div>
    );
}

export function ShopCanvasMediaTools({ layer, onAdd, onCreate }: { layer: CanvasLayer; onAdd: (nodes: CanvasLayer[]) => void; onCreate: (kind: string) => void }) {
    const { message } = App.useApp();
    const [preview, setPreview] = useState(false),
        [menu, setMenu] = useState<"grid" | "image" | "video" | null>(null),
        [busy, setBusy] = useState(false);
    const [rows, setRows] = useState(3),
        [columns, setColumns] = useState(3);
    const isVideo = layer.type === "video";
    const source = resolveResourceVariantUrl(resourceStorageKey(layer.resourceId!), isVideo ? "playback" : "original");
    const uploadCanvas = async (canvas: HTMLCanvasElement, index: number, cols = columns): Promise<CanvasLayer> => {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("无法导出图片"))), "image/png"));
        const resource = await uploadResourceFile(new File([blob], `画布切片-${index + 1}.png`, { type: "image/png" }), "image");
        return { id: crypto.randomUUID(), type: "image", resourceId: resource.id, x: layer.x + 340 + (index % cols) * 280, y: layer.y + Math.floor(index / cols) * 290, inputs: [layer.id] };
    };
    const split = async (r: number, c: number) => {
        if (busy) return;
        setBusy(true);
        try {
            const response = await fetch(source, { credentials: "include" });
            if (!response.ok) throw new Error("原图读取失败，请重试");
            const bitmap = await createImageBitmap(await response.blob());
            try {
                const nodes: CanvasLayer[] = [];
                for (let y = 0; y < r; y++)
                    for (let x = 0; x < c; x++) {
                        const left = Math.floor((x * bitmap.width) / c),
                            top = Math.floor((y * bitmap.height) / r);
                        const canvas = document.createElement("canvas");
                        canvas.width = Math.floor(((x + 1) * bitmap.width) / c) - left;
                        canvas.height = Math.floor(((y + 1) * bitmap.height) / r) - top;
                        if (!canvas.width || !canvas.height) throw new Error("图片尺寸小于切分数量");
                        canvas.getContext("2d")!.drawImage(bitmap, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
                        nodes.push(await uploadCanvas(canvas, nodes.length, c));
                    }
                onAdd(nodes);
                setMenu(null);
                message.success(`已切分为 ${nodes.length} 张图片并保存到素材库`);
            } finally {
                bitmap.close();
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "切分失败，请重试");
        } finally {
            setBusy(false);
        }
    };
    const extract = async (last: boolean) => {
        if (busy) return;
        setBusy(true);
        const video = document.createElement("video");
        video.crossOrigin = "use-credentials";
        video.preload = "auto";
        video.muted = true;
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("视频载入超时")), 30000);
                video.onloadeddata = () => {
                    clearTimeout(timer);
                    resolve();
                };
                video.onerror = () => {
                    clearTimeout(timer);
                    reject(new Error("视频格式不支持提取帧图"));
                };
                video.src = source;
            });
            if (last && Number.isFinite(video.duration))
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error("视频定位超时")), 15000);
                    video.onseeked = () => {
                        clearTimeout(timer);
                        resolve();
                    };
                    video.currentTime = Math.max(0, video.duration - 0.1);
                });
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d")!.drawImage(video, 0, 0);
            onAdd([await uploadCanvas(canvas, 0)]);
            message.success("帧图已加入画布");
            setMenu(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提取失败，请重试");
        } finally {
            video.removeAttribute("src");
            video.load();
            setBusy(false);
        }
    };
    const soon = (label: string) => (
        <button key={label} disabled title={`${label} · 敬请期待`}>
            {label}
            <small>敬请期待</small>
        </button>
    );
    return (
        <>
            <ShopNodeToolbar className="sp-media-tools" label={isVideo ? "视频操作" : "图片操作"}>
                {isVideo ? (
                    <>
                        <button onClick={() => setMenu(menu === "video" ? null : "video")}>
                            <ShopCanvasGlyph name="image" size={15} />
                            视频工具
                        </button>
                        {soon("剪辑")}
                    </>
                ) : (
                    <>
                        <button onClick={() => onCreate("repaint")}>编辑元素</button>
                        <button onClick={() => onCreate("model-views")}>多角度</button>
                        {soon("局部重绘")}
                        {soon("编辑文字")}
                        <button onClick={() => setMenu(menu === "image" ? null : "image")}>
                            <ShopCanvasGlyph name="cutout" size={15} />
                            图片工具
                        </button>
                        <button onClick={() => setMenu(menu === "grid" ? null : "grid")}>
                            <ShopCanvasGlyph name="grid" size={15} />
                            宫格切分
                        </button>
                    </>
                )}
                <Tooltip title="下载原文件">
                    <button aria-label="下载原文件" onClick={() => void downloadBrowserMedia({ storageKey: resourceStorageKey(layer.resourceId!), fileName: `画布素材.${isVideo ? "mp4" : "png"}` }).catch(() => message.error("下载失败，请重试"))}>
                        <ShopCanvasGlyph name="download" size={16} />
                    </button>
                </Tooltip>
                <Tooltip title="放大查看">
                    <button aria-label="放大查看" onClick={() => setPreview(true)}>
                        <ShopCanvasGlyph name="upscale" size={16} />
                    </button>
                </Tooltip>
                {menu ? (
                    <div className="sp-media-menu" role="menu" data-canvas-wheel-scroll>
                        {menu === "grid" ? (
                            <>
                                <strong>宫格切分</strong>
                                <p>切分原图并保存为独立图片节点</p>
                                <div className="sp-grid-presets">
                                    {[2, 3, 4, 5].map((n) => (
                                        <button key={n} disabled={busy} onClick={() => void split(n, n)}>
                                            {n} × {n}
                                        </button>
                                    ))}
                                </div>
                                <label>
                                    行<input type="number" min={1} max={8} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(8, Number(e.target.value))))} />
                                </label>
                                <label>
                                    列<input type="number" min={1} max={8} value={columns} onChange={(e) => setColumns(Math.max(1, Math.min(8, Number(e.target.value))))} />
                                </label>
                                <button disabled={busy} onClick={() => void split(rows, columns)}>
                                    {busy ? "正在切分并保存…" : "自定义切分"}
                                </button>
                            </>
                        ) : menu === "image" ? (
                            <>
                                {["橡皮工具", "扩图", "裁剪", "调整"].map(soon)}
                                <button onClick={() => onCreate("noise")}>加噪点</button>
                                <button onClick={() => onCreate("color")}>图片追色</button>
                            </>
                        ) : (
                            <>
                                <strong>黑白遮罩</strong>
                                {["196", "252", "336", "518"].map((n) => soon(`${n} · 黑白遮罩`))}
                                {soon("静音导出")}
                                {soon("视频分镜 · 每秒")}
                                {soon("视频分镜 · 每半秒")}
                                <button disabled={busy} onClick={() => void extract(false)}>
                                    提取首帧
                                </button>
                                <button disabled={busy} onClick={() => void extract(true)}>
                                    提取尾帧
                                </button>
                            </>
                        )}
                        <button onClick={() => setMenu(null)}>收起</button>
                    </div>
                ) : null}
            </ShopNodeToolbar>
            <AppModal open={preview} onCancel={() => setPreview(false)} title={isVideo ? "视频预览" : "图片预览"} width="min(1200px, 94vw)" footer={null} destroyOnHidden>
                <div className="sp-media-preview" data-canvas-no-zoom>
                    {isVideo ? <video src={source} controls playsInline /> : <img src={source} alt="画布图片原图" />}
                </div>
            </AppModal>
        </>
    );
}
