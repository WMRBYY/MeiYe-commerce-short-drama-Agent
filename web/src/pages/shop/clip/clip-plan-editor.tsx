import { Button, Input, InputNumber, Select } from "antd";
import { Plus, Redo2, Scissors, Trash2, Undo2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import type { ClipMode, ClipPlan } from "@/services/api/video-edit";
import { clipClock } from "./clip-model";
import { canSplitClipSubtitle, insertClipSubtitle, splitClipSubtitle } from "./clip-captions";
import type { ClipMedia } from "./use-video-edit";

export function ClipPlanEditor({
    plan,
    mode,
    materials,
    disabled,
    onChange,
    onSeek,
    canUndoCaptions,
    canRedoCaptions,
    onUndoCaptions,
    onRedoCaptions,
    onCaptionEditEnd,
}: {
    plan: ClipPlan;
    mode: ClipMode;
    materials: ClipMedia[];
    disabled: boolean;
    onChange: (patch: Partial<ClipPlan>, editKey?: string) => void;
    onSeek: (seconds: number) => void;
    canUndoCaptions: boolean;
    canRedoCaptions: boolean;
    onUndoCaptions: () => void;
    onRedoCaptions: () => void;
    onCaptionEditEnd: () => void;
}) {
    const inputs = useRef(new Map<number, TextAreaRef>());
    const cursors = useRef(new Map<number, { text: string; offset: number }>());
    const focusCaption = useRef<number | null>(null);
    const insertion = insertClipSubtitle(plan.transcript, plan.durationMs);
    const addReason = plan.transcript.length >= 1000 ? "字幕最多 1000 句。" : "没有空余时间，请先拆分字幕或调整时间。";
    useLayoutEffect(() => {
        if (focusCaption.current === null) return;
        inputs.current.get(focusCaption.current)?.focus({ cursor: "start" });
        focusCaption.current = null;
    }, [plan.transcript]);
    const addCaption = () => {
        if (!insertion || disabled) return;
        cursors.current.clear();
        focusCaption.current = insertion.index;
        onChange({ transcript: insertion.transcript });
    };
    const splitCaption = (index: number) => {
        const cursor = cursors.current.get(index);
        const transcript = splitClipSubtitle(plan.transcript, index, cursor?.text === plan.transcript[index].text ? cursor.offset : undefined);
        if (!transcript || disabled) return;
        cursors.current.clear();
        focusCaption.current = index + 1;
        onChange({ transcript });
    };
    return (
        <div className="scl-plan">
            {mode !== "behind" && (
                <section aria-label="校对字幕">
                    <header className="scl-section-head">
                        <h3>校对字幕</h3>
                        <span>
                            {plan.transcript.length} 句 · {clipClock(plan.durationMs)}
                        </span>
                    </header>
                    <div className="scl-caption-toolbar">
                        <AntTooltip title={!insertion ? addReason : undefined}>
                            <span>
                                <Button size="small" icon={<Plus size={14} />} disabled={disabled || !insertion} onClick={addCaption}>
                                    添加字幕
                                </Button>
                            </span>
                        </AntTooltip>
                        <AntTooltip title={!canUndoCaptions ? "还没有可撤销的字幕修改。" : undefined}>
                            <span>
                                <Button type="text" size="small" icon={<Undo2 size={14} />} disabled={disabled || !canUndoCaptions} onClick={onUndoCaptions}>
                                    撤销字幕
                                </Button>
                            </span>
                        </AntTooltip>
                        <AntTooltip title={!canRedoCaptions ? "还没有可重做的字幕修改。" : undefined}>
                            <span>
                                <Button type="text" size="small" icon={<Redo2 size={14} />} disabled={disabled || !canRedoCaptions} onClick={onRedoCaptions}>
                                    重做字幕
                                </Button>
                            </span>
                        </AntTooltip>
                    </div>
                    <p className="scl-muted">在文字光标处拆分，时间按字数估算，请校对。</p>
                    <div className="scl-transcript">
                        {plan.transcript.map((line, index) => (
                            <div className="scl-caption" key={index}>
                                <div className="scl-caption-time">
                                    <Button type="text" size="small" onClick={() => onSeek(line.startMs / 1000)} aria-label={`播放第 ${index + 1} 句`}>
                                        {String(index + 1).padStart(2, "0")}
                                    </Button>
                                    <InputNumber
                                        aria-label={`第 ${index + 1} 句开始秒数`}
                                        min={0}
                                        step={0.1}
                                        precision={2}
                                        disabled={disabled}
                                        value={line.startMs / 1000}
                                        onBlur={onCaptionEditEnd}
                                        onChange={(value) => onChange({ transcript: plan.transcript.map((item, i) => (i === index ? { ...item, startMs: Math.round((value || 0) * 1000) } : item)) }, `start:${index}`)}
                                    />
                                    <span>—</span>
                                    <InputNumber
                                        aria-label={`第 ${index + 1} 句结束秒数`}
                                        min={0}
                                        step={0.1}
                                        precision={2}
                                        disabled={disabled}
                                        value={line.endMs / 1000}
                                        onBlur={onCaptionEditEnd}
                                        onChange={(value) => onChange({ transcript: plan.transcript.map((item, i) => (i === index ? { ...item, endMs: Math.round((value || 0) * 1000) } : item)) }, `end:${index}`)}
                                    />
                                    <small>秒</small>
                                </div>
                                <Input.TextArea
                                    ref={(element) => {
                                        if (element) inputs.current.set(index, element);
                                        else inputs.current.delete(index);
                                    }}
                                    aria-label={`第 ${index + 1} 句字幕`}
                                    autoSize={{ minRows: 2, maxRows: 4 }}
                                    status={Array.from(line.text).length > 80 ? "error" : undefined}
                                    variant="filled"
                                    disabled={disabled}
                                    value={line.text}
                                    onBlur={onCaptionEditEnd}
                                    onSelect={(event) => {
                                        const input = event.currentTarget;
                                        cursors.current.set(index, { text: input.value, offset: input.selectionStart });
                                    }}
                                    onChange={(event) => onChange({ transcript: plan.transcript.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)) }, `text:${index}`)}
                                />
                                <div className="scl-caption-actions">
                                    <AntTooltip title={!canSplitClipSubtitle(plan.transcript, index) ? "至少 2 个字、0.2 秒才能拆分。" : "在光标处拆分；未放置光标时按句中位置拆分。"}>
                                        <span>
                                            <Button type="text" icon={<Scissors size={14} />} disabled={disabled || !canSplitClipSubtitle(plan.transcript, index)} aria-label={`拆分第 ${index + 1} 句字幕`} onClick={() => splitCaption(index)} />
                                        </span>
                                    </AntTooltip>
                                    <Button
                                        type="text"
                                        icon={<Trash2 size={14} />}
                                        disabled={disabled}
                                        aria-label={`移除第 ${index + 1} 句字幕`}
                                        onClick={() => {
                                            cursors.current.clear();
                                            onChange({ transcript: plan.transcript.filter((_, i) => i !== index) });
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
            {mode === "mix" && (
                <section aria-label="混剪画面安排">
                    <header className="scl-section-head">
                        <h3>画面安排</h3>
                        <Button
                            size="small"
                            icon={<Plus size={14} />}
                            disabled={disabled || !materials.length}
                            onClick={() => {
                                const startMs = plan.placements.at(-1)?.endMs || 0;
                                onChange({ placements: [...plan.placements, { resourceId: materials[0].resourceId, startMs, endMs: Math.min(startMs + 3000, plan.durationMs), sourceStartMs: 0 }] });
                            }}
                        >
                            加一段
                        </Button>
                    </header>
                    {plan.placements.map((clip, index) => (
                        <div className="scl-placement" key={index}>
                            <div className="scl-placement-top">
                                <Select
                                    aria-label={`第 ${index + 1} 段画面素材`}
                                    disabled={disabled}
                                    value={clip.resourceId}
                                    options={materials.map((item) => ({ value: item.resourceId, label: item.name }))}
                                    onChange={(resourceId) => onChange({ placements: plan.placements.map((item, i) => (i === index ? { ...item, resourceId } : item)) })}
                                />
                                <Button type="text" icon={<Trash2 size={14} />} disabled={disabled} aria-label={`移除第 ${index + 1} 段画面`} onClick={() => onChange({ placements: plan.placements.filter((_, i) => i !== index) })} />
                            </div>
                            <div className="scl-placement-times">
                                {(
                                    [
                                        ["startMs", "成片起点"],
                                        ["endMs", "成片终点"],
                                        ["sourceStartMs", "素材起点"],
                                    ] as const
                                ).map(([key, label]) => (
                                    <label key={key}>
                                        <span>{label}（秒）</span>
                                        <InputNumber
                                            aria-label={`第 ${index + 1} 段${label}秒数`}
                                            min={0}
                                            step={0.1}
                                            precision={2}
                                            disabled={disabled}
                                            value={clip[key] / 1000}
                                            onChange={(value) => onChange({ placements: plan.placements.map((item, i) => (i === index ? { ...item, [key]: Math.round((value || 0) * 1000) } : item)) })}
                                        />
                                    </label>
                                ))}
                            </div>
                            {clip.reason && <p className="scl-muted">{clip.reason}</p>}
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
}
