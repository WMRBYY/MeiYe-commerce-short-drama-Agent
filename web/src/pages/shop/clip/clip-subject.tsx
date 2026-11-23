import { InputNumber } from "antd";
import { useRef, useState, type PointerEvent } from "react";
import { resourceFileUrl } from "@/services/api/resources";
import type { ClipMedia } from "./use-video-edit";

/** 框选首帧上的目标人物；不自动猜测目标，归一化框交给后端分割。 */
export function ClipSubject({ source, startMs = 0, box, onChange, disabled }: { source: ClipMedia; startMs?: number; box?: number[]; onChange: (box: number[]) => void; disabled: boolean }) {
    const area = useRef<HTMLDivElement>(null);
    const origin = useRef<{ x: number; y: number } | null>(null);
    const [drawing, setDrawing] = useState<number[]>();
    const [loadError, setLoadError] = useState(false);
    const [frameReady, setFrameReady] = useState(false);
    const point = (event: PointerEvent) => {
        const bounds = area.current!.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
    };
    const move = (event: PointerEvent) => {
        if (!origin.current) return;
        const next = point(event);
        const first = origin.current;
        setDrawing([Math.min(first.x, next.x), Math.min(first.y, next.y), Math.abs(next.x - first.x), Math.abs(next.y - first.y)]);
    };
    const value = drawing || box;
    return (
        <section className="scl-subject" aria-label="框选首帧人物">
            <div className="scl-subject-frame" ref={area} style={{ aspectRatio: `${source.width || 9} / ${source.height || 16}`, width: `min(100%, ${(320 * (source.width || 9)) / (source.height || 16)}px)` }}>
                <video
                    key={`${source.resourceId}:${startMs}`}
                    src={resourceFileUrl(source.resourceId)}
                    muted
                    playsInline
                    preload="auto"
                    onLoadStart={() => setFrameReady(false)}
                    onLoadedData={(event) => {
                        event.currentTarget.pause();
                        event.currentTarget.currentTime = startMs / 1000;
                        setLoadError(false);
                        setFrameReady(startMs === 0);
                    }}
                    onSeeked={() => setFrameReady(true)}
                    onError={() => setLoadError(true)}
                />
                {!loadError && frameReady && (
                    <div
                        className="scl-subject-draw"
                        data-disabled={disabled || undefined}
                        onPointerDown={(event) => {
                            if (disabled) return;
                            event.preventDefault();
                            origin.current = point(event);
                            setDrawing(undefined);
                            event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={move}
                        onPointerUp={(event) => {
                            if (!origin.current) return;
                            const last = point(event);
                            const first = origin.current;
                            const result = [Math.min(first.x, last.x), Math.min(first.y, last.y), Math.abs(last.x - first.x), Math.abs(last.y - first.y)];
                            if (result[2] > 0.01 && result[3] > 0.01) onChange(result);
                            origin.current = null;
                            setDrawing(undefined);
                            event.currentTarget.releasePointerCapture(event.pointerId);
                        }}
                        onPointerCancel={() => {
                            origin.current = null;
                            setDrawing(undefined);
                        }}
                    >
                        {value?.length === 4 && <span className="scl-subject-box" style={{ left: `${value[0] * 100}%`, top: `${value[1] * 100}%`, width: `${value[2] * 100}%`, height: `${value[3] * 100}%` }} />}
                    </div>
                )}
            </div>
            <p>{loadError ? "首帧读取失败，请重新上传可播放的视频。" : !frameReady ? "正在读取首帧…" : "拖动框住首帧中的人物，包含头发与身体。"}</p>
            <div className="scl-box-fields">
                {["左边距", "上边距", "宽度", "高度"].map((label, index) => (
                    <label key={label}>
                        <span>{label} %</span>
                        <InputNumber
                            aria-label={`人物框${label}百分比`}
                            min={0}
                            max={100}
                            precision={1}
                            disabled={disabled || loadError || !frameReady}
                            value={box ? Number((box[index] * 100).toFixed(1)) : null}
                            onChange={(value) => {
                                const next = [...(box || [0, 0, 0, 0])];
                                next[index] = (value || 0) / 100;
                                onChange(next);
                            }}
                        />
                    </label>
                ))}
            </div>
        </section>
    );
}
