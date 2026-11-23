import { Button, Checkbox, Input, InputNumber, Progress, Select, Slider } from "antd";
import { AlertCircle, ArrowUp, Captions, Check, ChevronDown, Film, Music2, Plus, Scissors, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CreditStar } from "@/components/ui/credit-star";
import { AppModal } from "@/components/ui/product/app-modal";
import { resourceFileUrl } from "@/services/api/resources";
import { ShopMediaLibrary } from "../shop-media-library";
import { clipClock, clipRunning, clipStatusLabel, clipTitleError, clipTrimError, validSubjectBox } from "./clip-model";
import { ClipTemplatePicker } from "./clip-template-picker";
import type { VideoEditState } from "./use-video-edit";

export type ClipComposerHandle = { openMedia: () => void; openTemplates: () => void; focusTitle: () => void };

export const ClipComposer = forwardRef<ClipComposerHandle, { state: VideoEditState; onSubmit: () => void }>(function ClipComposer({ state, onSubmit }, ref) {
    const reduced = useReducedMotion();
    const titleInput = useRef<HTMLInputElement>(null);
    const musicInput = useRef<HTMLInputElement>(null);
    const trimVideo = useRef<HTMLVideoElement>(null);
    const [library, setLibrary] = useState<"source" | "materials" | null>(null);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [referenceOpen, setReferenceOpen] = useState(false);
    const [referenceDraft, setReferenceDraft] = useState("");
    const [trimOpen, setTrimOpen] = useState(false);
    const [trimDraft, setTrimDraft] = useState<[number, number]>([0, 0]);
    const [titleError, setTitleError] = useState("");
    const current = state.selected;
    const ready = current?.status === "ready";
    const running = clipRunning(current);
    const completed = current?.status === "succeeded";
    const failed = current?.status === "failed" || current?.status === "cancelled";
    const editable = !state.blocked && (!current || ready);
    const canPick = editable && !current;
    const sourceName = state.mode === "behind" ? "人物视频" : state.mode === "subtitle" ? "原视频" : "口播视频";
    const selectedTemplate = state.capabilities?.templates.find((template) => template.id === state.templateId);
    const availableTemplates = state.capabilities?.templates.filter((template) => !template.modes?.length || template.modes.includes(state.mode)) || [];
    const needs = !state.source
        ? `先选择${sourceName}。`
        : state.mode === "mix" && !state.materials.length
          ? "添加至少一段空镜或商品视频。"
          : state.mode === "behind" && !state.behindText.trim()
            ? "填写人物身后的文字。"
            : state.mode === "behind" && !validSubjectBox(state.subjectBox)
              ? "先在首帧框选人物。"
              : state.trimError;
    const focusTitle = () => {
        titleInput.current?.focus();
        titleInput.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    };
    useImperativeHandle(ref, () => ({
        openMedia: () => {
            if (canPick) setLibrary("source");
        },
        openTemplates: () => {
            if (editable && state.mode !== "behind") setTemplatesOpen(true);
            else if (state.mode === "behind") setLibrary("source");
        },
        focusTitle,
    }));
    useEffect(() => {
        setTitleError("");
    }, [current?.id, state.mode]);
    const submit = () => {
        if (state.blocked) return;
        const missingTitle = clipTitleError(state.title);
        if (missingTitle && !failed) {
            setTitleError(missingTitle);
            focusTitle();
            return;
        }
        setTitleError("");
        const reason = state.availability || (ready ? state.planError : failed ? "" : needs);
        if (reason) {
            state.setError(reason);
            return;
        }
        onSubmit();
    };
    const startTrim = () => {
        setTrimDraft([state.trimStartMs, state.trimEndMs || state.source?.durationMs || 0]);
        setTrimOpen(true);
    };
    const trimError = clipTrimError(trimDraft[0], trimDraft[1], state.source?.durationMs || 0);
    const trimmed = state.trimStartMs > 0 || (state.trimEndMs > 0 && state.trimEndMs < (state.source?.durationMs || 0));
    const works = state.projects.filter((project) => project.status === "succeeded" && project.outputResourceId).map((project) => ({ resourceId: project.outputResourceId, name: project.title, durationMs: project.plan.durationMs }));
    return (
        <>
            <form
                className="scl-composer"
                onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                }}
            >
                <div className="scl-composer-summary">
                    <span>用</span>
                    <button type="button" disabled={!canPick} onClick={() => setLibrary("source")}>
                        <Plus size={12} /> {sourceName}
                    </button>
                    {state.mode === "mix" && (
                        <>
                            <span>搭配</span>
                            <button type="button" disabled={!canPick} onClick={() => setLibrary("materials")}>
                                <Plus size={12} /> 画面素材
                            </button>
                        </>
                    )}
                    {state.mode !== "behind" ? (
                        <>
                            <span>结合</span>
                            <button type="button" disabled={!editable} onClick={() => setTemplatesOpen(true)}>
                                <Sparkles size={12} /> {selectedTemplate?.name || "剪辑模板"}
                            </button>
                        </>
                    ) : (
                        <span>与人物背后的大字</span>
                    )}
                    <span>完成一条值得发布的短片</span>
                </div>
                <div className="scl-composer-media">
                    <div className="scl-source-wrap">
                        <motion.button
                            type="button"
                            className="scl-source-card"
                            disabled={!canPick}
                            whileHover={reduced || !canPick ? undefined : { y: -3, scale: 1.025 }}
                            whileTap={reduced || !canPick ? undefined : { scale: 0.98 }}
                            onClick={() => setLibrary("source")}
                            aria-label={state.source ? `更换${sourceName}` : `选择${sourceName}`}
                        >
                            {state.source ? (
                                <>
                                    <video src={resourceFileUrl(state.source.resourceId)} muted playsInline preload="metadata" />
                                    <span className="scl-source-overlay">
                                        <Film size={15} /> 更换
                                    </span>
                                    <span className="scl-source-duration">{clipClock(state.source.durationMs || 0)}</span>
                                </>
                            ) : (
                                <>
                                    <Film size={22} />
                                    <strong>{sourceName}</strong>
                                    <span>点击选择</span>
                                </>
                            )}
                        </motion.button>
                        {state.source && (
                            <div className="scl-source-details">
                                <strong title={state.source.name}>{state.source.name}</strong>
                                <span>{trimmed ? `${clipClock(state.trimStartMs)} — ${clipClock(state.trimEndMs || state.source.durationMs || 0)}` : "使用完整视频"}</span>
                                {canPick && (
                                    <button type="button" onClick={startTrim}>
                                        <Scissors size={12} /> 截取片段
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    {state.mode === "mix" && (
                        <div className="scl-material-list">
                            <button type="button" className="scl-add-material" disabled={!canPick} onClick={() => setLibrary("materials")}>
                                <Plus size={16} />
                                <span>{state.materials.length ? `画面素材 ${state.materials.length}/8` : "添加空镜 / 商品视频"}</span>
                            </button>
                            {state.materials.map((item, index) => (
                                <span className="scl-material-file" key={item.resourceId}>
                                    <Film size={13} />
                                    <span title={item.name}>{item.name}</span>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<X size={12} />}
                                        aria-label={`移除素材 ${index + 1}`}
                                        disabled={!canPick}
                                        onClick={() => state.setMaterials((items) => items.filter((entry) => entry.resourceId !== item.resourceId))}
                                    />
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="scl-title-field" data-invalid={Boolean(titleError) || undefined}>
                    <label htmlFor="clip-finished-title">
                        成片标题 <span>必填</span>
                    </label>
                    <input
                        id="clip-finished-title"
                        ref={titleInput}
                        aria-invalid={Boolean(titleError)}
                        aria-describedby={titleError ? "clip-title-error" : "clip-title-hint"}
                        autoComplete="off"
                        maxLength={100}
                        placeholder="为亮点命名，例如：把通勤穿成自己的风格"
                        disabled={!editable}
                        value={state.title}
                        onChange={(event) => {
                            state.setTitle(event.target.value);
                            if (titleError) setTitleError(clipTitleError(event.target.value));
                        }}
                    />
                    <span className="scl-title-count">{[...state.title].length}/100</span>
                </div>
                <span id="clip-title-hint" className="scl-sr-only">
                    标题会作为作品名称保存，最多 100 个字。
                </span>
                <AnimatePresence initial={false}>
                    {titleError && (
                        <motion.div className="scl-title-error" id="clip-title-error" role="alert" initial={reduced ? false : { opacity: 0, height: 0, y: -4 }} animate={{ opacity: 1, height: "auto", y: 0 }} exit={{ opacity: 0, height: 0 }}>
                            <AlertCircle size={15} />
                            <span>{titleError}</span>
                        </motion.div>
                    )}
                </AnimatePresence>
                {state.mode === "behind" && (
                    <div className="scl-behind-fields">
                        <label>
                            <span>人物身后的文字</span>
                            <Input variant="filled" maxLength={20} placeholder="例如：新品上市" disabled={!editable} value={state.behindText} onChange={(event) => state.setBehindText(event.target.value)} />
                        </label>
                        <label>
                            <span>文字位置</span>
                            <Select
                                aria-label="文字位置"
                                disabled={!editable}
                                value={state.behindPosition}
                                onChange={state.setBehindPosition}
                                options={[
                                    { value: "top", label: "靠上" },
                                    { value: "center", label: "居中" },
                                    { value: "bottom", label: "靠下" },
                                ]}
                            />
                        </label>
                    </div>
                )}
                {state.upload && (
                    <div className="scl-upload-progress" role="status">
                        <span>
                            {state.upload.name} · {state.upload.progress}%
                        </span>
                        <Button type="text" size="small" onClick={state.cancelUpload}>
                            取消
                        </Button>
                        <Progress percent={state.upload.progress} showInfo={false} />
                    </div>
                )}
                <div className="scl-composer-controls">
                    <div className="scl-composer-options">
                        {state.mode !== "behind" && (
                            <>
                                <button type="button" className="scl-option-btn" disabled={!editable || !availableTemplates.length} onClick={() => setTemplatesOpen(true)}>
                                    <Sparkles size={14} />
                                    <span>{selectedTemplate?.name || "选择模板"}</span>
                                    <ChevronDown size={12} />
                                </button>
                                <button
                                    type="button"
                                    className="scl-option-btn"
                                    data-filled={Boolean(state.referenceText) || undefined}
                                    disabled={!editable || Boolean(current)}
                                    onClick={() => {
                                        setReferenceDraft(state.referenceText);
                                        setReferenceOpen(true);
                                    }}
                                >
                                    <Captions size={14} />
                                    <span>字幕文案</span>
                                    {state.referenceText ? <Check size={12} /> : <small>选填</small>}
                                    <ChevronDown size={12} />
                                </button>
                            </>
                        )}
                        <button type="button" className="scl-option-btn" disabled={!canPick} onClick={() => musicInput.current?.click()}>
                            <Music2 size={14} />
                            <span>{state.music ? "更换音乐" : "背景音乐"}</span>
                        </button>
                    </div>
                    {completed ? (
                        <Button type="primary" onClick={state.startNew}>
                            剪下一条
                        </Button>
                    ) : (
                        <button className="scl-generate" type="submit" disabled={state.blocked} aria-busy={state.busy || running}>
                            {state.title.trim() && state.quote && (
                                <span className="scl-quote" title={state.quote.label}>
                                    <CreditStar /> {state.quote.credits}
                                </span>
                            )}
                            <span>{running ? clipStatusLabel(current!) : ready ? "生成成片" : failed ? "重试任务" : state.reviewBeforeRender ? "分析并校对" : "生成"}</span>
                            <ArrowUp size={16} />
                        </button>
                    )}
                </div>
                {state.music && (
                    <div className="scl-music">
                        <Music2 size={13} />
                        <span title={state.music.name}>{state.music.name}</span>
                        <label>
                            <span>音量 %</span>
                            <InputNumber aria-label="背景音乐音量百分比" size="small" min={0} max={50} value={Math.round(state.musicVolume * 100)} disabled={!editable} onChange={(value) => state.setMusicVolume((value ?? 15) / 100)} />
                        </label>
                        <Button type="text" aria-label="移除背景音乐" icon={<X size={13} />} disabled={!canPick} onClick={() => state.setMusic(null)} />
                    </div>
                )}
                <div className="scl-composer-foot">
                    {!current ? (
                        <>
                            <Checkbox checked={state.reviewBeforeRender} disabled={state.blocked} onChange={(event) => state.setReviewBeforeRender(event.target.checked)}>
                                先分析并校对
                            </Checkbox>
                            <span>{state.quoting ? "正在确认积分…" : state.quote && state.title.trim() ? (state.quote.chargeAt === "render" ? `${state.quote.label} · 分析不扣积分` : state.quote.label) : "单段最多 5 分钟 · 512 MB"}</span>
                        </>
                    ) : ready ? (
                        <>
                            <span>{state.quoting ? "正在确认积分…" : state.quote?.label || "确认内容后，所选风格会应用到成片"}</span>
                            <Button type="text" size="small" disabled={state.blocked || Boolean(state.planError)} loading={state.busy} onClick={() => void state.save()}>
                                保存校对
                            </Button>
                        </>
                    ) : (
                        <span>{completed ? "作品已保存，可在生成历史中再次查看" : current.status === "failed" ? "任务未完成，可查看原因后重试" : current.status === "cancelled" ? "任务已取消，可重新开始" : "任务在后台继续，离开页面不影响处理"}</span>
                    )}
                </div>
                {(state.error || current?.error || state.quoteError) && (
                    <p className="scl-error" role="alert">
                        {state.error || current?.error || state.quoteError}
                    </p>
                )}
                {state.quoteError && (
                    <Button type="text" size="small" onClick={state.refreshQuote}>
                        重新获取积分报价
                    </Button>
                )}
                {!completed && state.availability && (
                    <div className="scl-availability" role="status">
                        <span>{state.availability}</span>
                        <Button type="text" size="small" onClick={() => void state.refreshCapabilities()}>
                            重新获取
                        </Button>
                    </div>
                )}
                {ready && state.planError && (
                    <p className="scl-error" role="alert">
                        {state.planError}
                    </p>
                )}
                <input
                    ref={musicInput}
                    type="file"
                    accept="audio/*"
                    hidden
                    onChange={(event) => {
                        void state.uploadMusic(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </form>
            <ShopMediaLibrary
                kind="video"
                label={library === "materials" ? "画面素材" : sourceName}
                open={Boolean(library)}
                max={library === "materials" ? 8 : 1}
                current={library === "materials" ? state.materials : state.source ? [state.source] : []}
                works={works}
                onClose={() => setLibrary(null)}
                onPick={(items) => {
                    void state.pickMedia(items, library === "materials");
                    setLibrary(null);
                }}
                onUpload={async (files) => {
                    await state.uploadFiles(files, library === "materials");
                    setLibrary(null);
                }}
            />
            <ClipTemplatePicker
                open={templatesOpen}
                mode={state.mode}
                templates={state.capabilities?.templates || []}
                templateId={state.templateId}
                visual={state.visual}
                onClose={() => setTemplatesOpen(false)}
                onUse={(id, visual) => {
                    state.setTemplateId(id);
                    if (visual) state.setVisual(visual);
                }}
            />
            <AppModal open={referenceOpen} onCancel={() => setReferenceOpen(false)} footer={null} closable={false} flush width={620} centered className="scl-reference-modal ms-scope" aria-label="字幕参考文案">
                <motion.div className="scl-dialog" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                    <header className="scl-dialog-head">
                        <div>
                            <span className="scl-dialog-kicker">
                                <Captions size={14} /> 字幕参考
                            </span>
                            <h2>让每个词，都准确表达</h2>
                            <p>粘贴视频中的原话，帮助识别人名、品牌、方言和专有名词。</p>
                        </div>
                        <Button type="text" icon={<X size={18} />} aria-label="关闭字幕文案" onClick={() => setReferenceOpen(false)} />
                    </header>
                    <div className="scl-reference-body">
                        <Input.TextArea
                            autoFocus
                            variant="borderless"
                            aria-label="字幕参考文案"
                            value={referenceDraft}
                            onChange={(event) => setReferenceDraft(event.target.value)}
                            maxLength={5000}
                            autoSize={{ minRows: 7, maxRows: 13 }}
                            placeholder={"例如：\n这只保温杯用了 316L 不锈钢内胆。早上冲好的咖啡，下午还是刚好的温度。"}
                        />
                        <div>
                            <span>以原视频口播为准，参考文案仅用于校对识别结果。</span>
                            <span>{[...referenceDraft].length}/5000</span>
                        </div>
                    </div>
                    <footer className="scl-dialog-footer">
                        <Button type="text" onClick={() => setReferenceDraft("")}>
                            清空文案
                        </Button>
                        <Button
                            type="primary"
                            onClick={() => {
                                state.setReferenceText(referenceDraft.trim());
                                setReferenceOpen(false);
                            }}
                        >
                            保存参考文案
                        </Button>
                    </footer>
                </motion.div>
            </AppModal>
            <AppModal open={trimOpen} onCancel={() => setTrimOpen(false)} footer={null} closable={false} flush width={640} centered className="scl-trim-modal ms-scope" aria-label="截取视频片段">
                <div className="scl-dialog">
                    <header className="scl-dialog-head">
                        <div>
                            <span className="scl-dialog-kicker">
                                <Scissors size={14} /> 片段范围
                            </span>
                            <h2>从最值得留下的部分开始</h2>
                            <p>只分析和剪辑选中的片段，原素材完整保留。</p>
                        </div>
                        <Button type="text" icon={<X size={18} />} aria-label="关闭片段截取" onClick={() => setTrimOpen(false)} />
                    </header>
                    <div className="scl-trim-body">
                        {state.source && (
                            <video
                                ref={trimVideo}
                                src={resourceFileUrl(state.source.resourceId)}
                                controls
                                playsInline
                                preload="metadata"
                                onLoadedMetadata={(event) => {
                                    event.currentTarget.currentTime = trimDraft[0] / 1000;
                                }}
                                onTimeUpdate={(event) => {
                                    if (event.currentTarget.currentTime * 1000 > trimDraft[1]) event.currentTarget.pause();
                                }}
                            />
                        )}
                        <Slider
                            range
                            min={0}
                            max={state.source?.durationMs || 0}
                            step={100}
                            value={trimDraft}
                            tooltip={{ formatter: (value) => clipClock(value || 0) }}
                            onChange={(value) => {
                                const next = value as [number, number];
                                setTrimDraft(next);
                                if (trimVideo.current) trimVideo.current.currentTime = next[0] / 1000;
                            }}
                        />
                        <div className="scl-trim-times">
                            <label>
                                <span>开始 / 秒</span>
                                <InputNumber aria-label="片段开始秒数" min={0} max={(state.source?.durationMs || 0) / 1000} step={0.1} value={trimDraft[0] / 1000} onChange={(value) => setTrimDraft([Math.round((value || 0) * 1000), trimDraft[1]])} />
                            </label>
                            <label>
                                <span>结束 / 秒</span>
                                <InputNumber aria-label="片段结束秒数" min={0} max={(state.source?.durationMs || 0) / 1000} step={0.1} value={trimDraft[1] / 1000} onChange={(value) => setTrimDraft([trimDraft[0], Math.round((value || 0) * 1000)])} />
                            </label>
                            <span>保留 {Math.max(0, (trimDraft[1] - trimDraft[0]) / 1000).toFixed(1)} 秒</span>
                        </div>
                        {trimError && (
                            <p className="scl-error" role="alert">
                                {trimError}
                            </p>
                        )}
                    </div>
                    <footer className="scl-dialog-footer">
                        <Button type="text" onClick={() => setTrimDraft([0, state.source?.durationMs || 0])}>
                            恢复完整视频
                        </Button>
                        <Button
                            type="primary"
                            disabled={Boolean(trimError)}
                            onClick={() => {
                                state.setTrim(trimDraft[0], trimDraft[1] === state.source?.durationMs ? 0 : trimDraft[1]);
                                setTrimOpen(false);
                            }}
                        >
                            使用这个片段
                        </Button>
                    </footer>
                </div>
            </AppModal>
        </>
    );
});
