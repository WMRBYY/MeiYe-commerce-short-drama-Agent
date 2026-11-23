import { App, Tooltip } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, AtSign, Bot, Check, ChevronDown, Clapperboard, ImageIcon, LoaderCircle, Music2, Plus, Sparkles, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";

import { ModelLogo } from "@/components/model-logo";
import { useAuthEntry } from "@/hooks/use-auth-entry";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { creationAudioAsset, creationImageAsset, creationVideoAsset } from "@/pages/create/creation-assets";
import { addSkill, type Skill } from "@/services/api/skills";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { modelDisplayName, modelIcon, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { createDramaCanvas, type DramaGenerationSpec } from "./drama-launch";
import { DramaSkillPicker } from "./drama-skill-picker";
import "./drama-composer.css";

export type DramaMode = "agent" | "image" | "video";

const GENRES = ["都市逆袭", "甜宠恋爱", "古装宫斗", "悬疑推理", "玄幻修仙", "家庭伦理", "科幻末世", "萌宝"];
const STYLES = ["真人写实", "国风动漫", "3D 动画", "日系动漫", "电影质感"];
const DRAMA_RATIOS = ["9:16", "16:9"];
const LENGTHS = [60, 90, 120, 180];
const PREF_KEY = "meiye.drama.composer.v1";

const MODES: Array<{ mode: DramaMode; label: string; description: string; icon: ReactNode }> = [
    { mode: "agent", label: "Agent 模式", description: "画布助手思考、拆解剧本并在画布上创作", icon: <Bot className="size-4" /> },
    { mode: "image", label: "图片生成", description: "用你的图片模型直接在画布里出图", icon: <ImageIcon className="size-4" /> },
    { mode: "video", label: "视频生成", description: "用你的视频模型直接在画布里出片", icon: <Video className="size-4" /> },
];

type Upload = { id: string; kind: "image" | "video" | "audio"; label: string; name: string; previewUrl: string; assetId?: string; status: "uploading" | "done" | "error" };
type Prefs = { mode?: DramaMode; genre?: string; style?: string; ratio?: string; length?: number; imageModel?: string; videoModel?: string; specs?: Record<string, { ratio?: string; resolution?: string; seconds?: number }> };

function readPrefs(): Prefs {
    try {
        const raw = window.localStorage.getItem(PREF_KEY);
        return raw ? (JSON.parse(raw) as Prefs) : {};
    } catch {
        return {};
    }
}
function writePrefs(value: Prefs) {
    try {
        window.localStorage.setItem(PREF_KEY, JSON.stringify(value));
    } catch {
        /* 浏览器禁用存储时只是不记住偏好 */
    }
}

/** 底部工具条的轻量弹层：点外面 / Esc 关闭，向上或向下弹出。 */
function Pop({
    trigger,
    children,
    width,
    align = "start",
    placement = "bottom",
    open,
    onOpenChange,
}: {
    trigger: (open: boolean, toggle: () => void) => ReactNode;
    children: (close: () => void) => ReactNode;
    width?: number;
    align?: "start" | "center" | "end";
    placement?: "top" | "bottom";
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [inner, setInner] = useState(false);
    const isOpen = open ?? inner;
    const setOpen = (next: boolean) => (onOpenChange ? onOpenChange(next) : setInner(next));
    const root = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    useEffect(() => {
        if (!isOpen) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: globalThis.KeyboardEvent) => event.key === "Escape" && setOpen(false);
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    });
    const offset = placement === "top" ? 8 : -8;
    return (
        <div ref={root} className="dr-pop" data-align={align} data-placement={placement}>
            {trigger(isOpen, () => setOpen(!isOpen))}
            <AnimatePresence>
                {isOpen ? (
                    <motion.div
                        className="dr-pop-panel"
                        style={width ? { width } : undefined}
                        initial={reduced ? false : { opacity: 0, y: offset, scale: 0.97, filter: "blur(2px)" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: offset / 2, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {children(() => setOpen(false))}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function Seg<T extends string | number>({ items, value, onChange, format }: { items: T[]; value: T | undefined; onChange: (value: T) => void; format?: (value: T) => ReactNode }) {
    return (
        <div className="dr-seg">
            {items.map((item) => (
                <button key={String(item)} type="button" data-active={item === value || undefined} onClick={() => onChange(item)}>
                    {format ? format(item) : item}
                </button>
            ))}
        </div>
    );
}

function ratioIcon(ratio: string) {
    const [w, h] = ratio.split(":").map(Number);
    if (!w || !h) return null;
    const scale = 14 / Math.max(w, h);
    return <i className="dr-ratio-box" style={{ width: Math.max(6, w * scale), height: Math.max(6, h * scale) }} />;
}

function uploadKind(file: File): Upload["kind"] | undefined {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return undefined;
}
const KIND_LABEL: Record<Upload["kind"], string> = { image: "图", video: "视频", audio: "音频" };

export function DramaComposer({ seed }: { seed?: { text: string; id: number } }) {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const reduced = useReducedMotion();
    const { openAuth } = useAuthEntry();
    const config = useEffectiveConfig();
    const userId = useUserStore((state) => state.user?.id);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const addAsset = useAssetStore((state) => state.addAsset);
    const prefs = useMemo(readPrefs, []);
    const [mode, setMode] = useState<DramaMode>(prefs.mode || "agent");
    const [text, setText] = useState("");
    const [genre, setGenre] = useState(prefs.genre || GENRES[0]);
    const [style, setStyle] = useState(prefs.style || STYLES[0]);
    const [dramaRatio, setDramaRatio] = useState(prefs.ratio || DRAMA_RATIOS[0]);
    const [length, setLength] = useState(prefs.length || 90);
    const [imageModel, setImageModel] = useState(prefs.imageModel || "");
    const [videoModel, setVideoModel] = useState(prefs.videoModel || "");
    const [specs, setSpecs] = useState<NonNullable<Prefs["specs"]>>(prefs.specs || {});
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [skill, setSkill] = useState<Skill | null>(null);
    const [dragging, setDragging] = useState(false);
    const [launching, setLaunching] = useState(false);
    const [skillOpen, setSkillOpen] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const textarea = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!seed?.text) return;
        setText(seed.text);
        textarea.current?.focus();
    }, [seed]);

    const imageModels = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, "image"))), [config]);
    const videoModels = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, "video"))), [config]);
    const models = mode === "video" ? videoModels : imageModels;
    const storedModel = mode === "video" ? videoModel : imageModel;
    const model = models.includes(storedModel) ? storedModel : models[0] || "";
    const setModel = (value: string) => (mode === "video" ? setVideoModel(value) : setImageModel(value));

    // 参数档位完全来自后台给该模型配置的能力，不写死。
    const capability = useMemo(() => (model ? modelCapabilityConfigFor(config, model) : undefined), [config, model]);
    const spec = useMemo(() => {
        const saved = specs[model] || {};
        if (mode === "video") {
            const profile = capability?.video;
            const ratios = profile?.ratios?.length ? profile.ratios : [];
            const resolutions = profile?.resolutions?.length ? profile.resolutions : [];
            const durations = profile && profile.durationSupported !== false ? videoDurationOptions(profile) : [];
            return {
                ratios,
                resolutions,
                durations,
                ratio: saved.ratio && ratios.includes(saved.ratio) ? saved.ratio : profile?.defaultRatio || ratios[0] || "",
                resolution: saved.resolution && resolutions.includes(saved.resolution) ? saved.resolution : profile?.defaultResolution || resolutions[0] || "",
                seconds: saved.seconds && durations.includes(saved.seconds) ? saved.seconds : profile?.duration?.default || durations[0],
            };
        }
        const profile = capability?.image;
        const ratios = profile && profile.size.parameter !== "none" ? profile.size.values.filter((value) => value.includes(":")) : [];
        const resolutions = profile?.resolution?.supported ? profile.resolution.values : [];
        const fallbackRatio = profile?.size.defaultRatio || (profile?.size.default?.includes(":") ? profile.size.default : "") || ratios[0] || "";
        return {
            ratios,
            resolutions,
            durations: [] as number[],
            ratio: saved.ratio && ratios.includes(saved.ratio) ? saved.ratio : fallbackRatio,
            resolution: saved.resolution && resolutions.includes(saved.resolution) ? saved.resolution : profile?.resolution?.default || resolutions[0] || "",
            seconds: undefined as number | undefined,
        };
    }, [capability, mode, model, specs]);
    const updateSpec = (patch: { ratio?: string; resolution?: string; seconds?: number }) => setSpecs((current) => ({ ...current, [model]: { ...current[model], ...patch } }));

    useEffect(() => {
        writePrefs({ mode, genre, style, ratio: dramaRatio, length, imageModel, videoModel, specs });
    }, [mode, genre, style, dramaRatio, length, imageModel, videoModel, specs]);

    const requireLogin = () => {
        if (userId) return true;
        openAuth({ preferDialog: true });
        return false;
    };

    const addFiles = async (files: File[]) => {
        if (!requireLogin()) return;
        const accepted = files.filter((file) => uploadKind(file));
        if (!accepted.length) {
            message.warning("只支持图片、视频、音频素材");
            return;
        }
        const counters = { image: 0, video: 0, audio: 0 };
        for (const item of uploads) counters[item.kind] += 1;
        const pending: Array<{ upload: Upload; file: File }> = accepted.map((file) => {
            const kind = uploadKind(file)!;
            counters[kind] += 1;
            return {
                file,
                upload: { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, label: `${KIND_LABEL[kind]}${counters[kind]}`, name: file.name, previewUrl: kind === "audio" ? "" : URL.createObjectURL(file), status: "uploading" },
            };
        });
        setUploads((current) => [...current, ...pending.map((item) => item.upload)]);
        await Promise.all(
            pending.map(async ({ file, upload }) => {
                try {
                    let assetId: string;
                    if (upload.kind === "image") {
                        const uploaded = await uploadImage(file);
                        assetId = addAsset(creationImageAsset({ title: file.name, uploaded, metadata: { source: "drama-home", fileName: file.name } }));
                    } else {
                        const uploaded = await uploadMediaFile(file, "drama-upload");
                        const asset =
                            upload.kind === "video"
                                ? creationVideoAsset({ title: file.name, uploaded, metadata: { source: "drama-home", fileName: file.name } })
                                : creationAudioAsset({ title: file.name, uploaded, metadata: { source: "drama-home", fileName: file.name } });
                        assetId = addAsset(asset);
                    }
                    setUploads((current) => current.map((item) => (item.id === upload.id ? { ...item, assetId, status: "done" } : item)));
                } catch (error) {
                    setUploads((current) => current.map((item) => (item.id === upload.id ? { ...item, status: "error" } : item)));
                    message.error(`${file.name} 上传失败：${error instanceof Error ? error.message : "请重试"}`);
                }
            }),
        );
    };
    const removeUpload = (id: string) =>
        setUploads((current) => {
            const target = current.find((item) => item.id === id);
            if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
            return current.filter((item) => item.id !== id);
        });
    const insertMention = (label: string) => {
        const el = textarea.current;
        const token = `@${label} `;
        if (!el) {
            setText((value) => `${value}${token}`);
            return;
        }
        const start = el.selectionStart ?? text.length;
        const end = el.selectionEnd ?? text.length;
        const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
        setText(next);
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(start + token.length, start + token.length);
        });
    };

    const pickSkill = (value: Skill) => {
        setSkill(value);
        if (mode !== "agent") {
            setMode("agent");
            message.info("技能由画布助手执行，已切到 Agent 模式");
        }
        textarea.current?.focus();
    };

    const submit = async () => {
        if (launching) return;
        const prompt = text.trim();
        if (!prompt) {
            message.warning(mode === "agent" ? "先写一句故事想法" : "先写下画面描述");
            textarea.current?.focus();
            return;
        }
        if (!requireLogin()) return;
        if (!canvasHydrated) {
            message.warning("画布还在恢复，请稍候再试");
            return;
        }
        if (uploads.some((item) => item.status === "uploading")) {
            message.warning("素材还在上传，请稍候");
            return;
        }
        if (mode !== "agent" && !model) {
            message.warning(mode === "video" ? "后台还没有开放视频模型" : "后台还没有开放图片模型");
            return;
        }
        const ready = uploads.filter((item): item is Upload & { assetId: string } => item.status === "done" && Boolean(item.assetId));
        setLaunching(true);
        const startedAt = Date.now();
        try {
            let skillToken = "";
            if (mode === "agent" && skill) {
                if (!skill.isAdded) await addSkill(skill.skillId);
                skillToken = `@[skill:${skill.skillId}] `;
            }
            // 输入框里的 @图1 对 Agent 换成素材引用，对生成节点去掉 @（素材已连成参考）。
            const byLabelLength = [...ready].sort((left, right) => right.label.length - left.label.length);
            const resolveMentions = (value: string, agent: boolean) => byLabelLength.reduce((acc, item) => acc.split(`@${item.label}`).join(agent ? `@[asset:${item.assetId}]` : item.label), value);
            const agentPrompt = [
                `${skillToken}【短剧创作】题材：${genre}｜画风：${style}｜画幅：${dramaRatio}｜单集时长：约 ${length} 秒`,
                resolveMentions(prompt, true),
                ready.length ? `参考素材：${ready.map((item) => `${item.label} @[asset:${item.assetId}]`).join("、")}（已放到画布上）` : "",
            ]
                .filter(Boolean)
                .join("\n\n");
            const generationSpec: DramaGenerationSpec | undefined = mode === "agent" ? undefined : { model, ratio: spec.ratio, resolution: spec.resolution, seconds: spec.seconds };
            const result = await createDramaCanvas({ title: prompt.slice(0, 24) || "短剧画布", kind: mode, prompt: resolveMentions(prompt, false), agentPrompt, spec: generationSpec, assetIds: ready.map((item) => item.assetId) });
            if (result.syncError) message.warning("画布已创建，云端同步稍后完成");
            // 让进入动效完整播放一遍再切页。
            const wait = Math.max(0, (reduced ? 0 : 900) - (Date.now() - startedAt));
            window.setTimeout(() => navigate(result.path, { state: result.state }), wait);
        } catch (error) {
            setLaunching(false);
            message.error(error instanceof Error ? error.message : "进入画布失败，请重试");
        }
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
        }
    };
    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData.files || []);
        if (!files.length) return;
        event.preventDefault();
        void addFiles(files);
    };
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files || []);
        if (files.length) void addFiles(files);
    };

    const currentMode = MODES.find((item) => item.mode === mode)!;
    const paramLabel =
        mode === "agent" ? (
            <>
                {genre}
                <i className="dr-dot" />
                {style}
                <i className="dr-dot" />
                {dramaRatio}
                <i className="dr-dot" />
                {length}s
            </>
        ) : model ? (
            <>
                <ModelLogo icon={modelIcon(config, model)} size={14} />
                <span className="dr-chip-model">{modelDisplayName(config, model)}</span>
                {spec.ratio ? (
                    <>
                        <i className="dr-dot" />
                        {spec.ratio}
                    </>
                ) : null}
                {spec.resolution ? (
                    <>
                        <i className="dr-dot" />
                        {spec.resolution}
                    </>
                ) : null}
                {spec.seconds ? (
                    <>
                        <i className="dr-dot" />
                        {spec.seconds}s
                    </>
                ) : null}
            </>
        ) : (
            "暂无可用模型"
        );

    return (
        <>
            <div className="dr-composer" data-drag={dragging || undefined} data-launching={launching || undefined} onDragOver={(event) => (event.preventDefault(), setDragging(true))} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                <AnimatePresence initial={false}>
                    {uploads.length || skill ? (
                        <motion.div className="dr-attach" initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                            {skill ? (
                                <span className="dr-skill-tag">
                                    <Sparkles className="size-3.5" />
                                    {skill.skillName}
                                    <button type="button" aria-label="移除技能" onClick={() => setSkill(null)}>
                                        <X className="size-3" />
                                    </button>
                                </span>
                            ) : null}
                            {uploads.map((item) => (
                                <motion.span key={item.id} layout className="dr-thumb" data-status={item.status} title={`${item.label} · ${item.name}`} initial={reduced ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
                                    {item.kind === "image" ? <img src={item.previewUrl} alt="" /> : item.kind === "video" ? <video src={item.previewUrl} muted playsInline preload="metadata" /> : <Music2 className="size-5" />}
                                    <em>{item.label}</em>
                                    {item.status === "uploading" ? (
                                        <span className="dr-thumb-mask">
                                            <LoaderCircle className="size-4 animate-spin" />
                                        </span>
                                    ) : null}
                                    <button type="button" className="dr-thumb-x" aria-label="移除素材" onClick={() => removeUpload(item.id)}>
                                        <X className="size-3" />
                                    </button>
                                </motion.span>
                            ))}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
                <textarea
                    ref={textarea}
                    className="dr-textarea"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    rows={3}
                    maxLength={4000}
                    placeholder={mode === "agent" ? "描述你的短剧想法，用 @ 引用上传的图片 / 视频 / 音频，用技能套用导演玩法…" : mode === "video" ? "描述这个镜头的画面与运动，用 @ 引用参考素材…" : "描述要生成的画面，用 @ 引用参考素材…"}
                />
                <div className="dr-bar">
                    <div className="dr-bar-left">
                        <Tooltip title="上传图片 / 视频 / 音频">
                            <button type="button" className="dr-icon-btn" aria-label="上传素材" onClick={() => requireLogin() && fileInput.current?.click()}>
                                <Plus className="size-4.5" />
                            </button>
                        </Tooltip>
                        <input
                            ref={fileInput}
                            type="file"
                            hidden
                            multiple
                            accept="image/*,video/*,audio/*"
                            onChange={(event) => {
                                const files = Array.from(event.target.files || []);
                                event.target.value = "";
                                if (files.length) void addFiles(files);
                            }}
                        />
                        <Pop
                            width={260}
                            trigger={(open, toggle) => (
                                <Tooltip title="引用素材">
                                    <button type="button" className="dr-icon-btn" data-open={open || undefined} aria-label="引用素材" onClick={toggle}>
                                        <AtSign className="size-4" />
                                    </button>
                                </Tooltip>
                            )}
                        >
                            {(close) => (
                                <div className="dr-mention">
                                    <div className="dr-pop-title">引用素材</div>
                                    {uploads.filter((item) => item.status === "done").length ? (
                                        <div className="dr-mention-grid">
                                            {uploads
                                                .filter((item) => item.status === "done")
                                                .map((item) => (
                                                    <button key={item.id} type="button" onClick={() => (insertMention(item.label), close())}>
                                                        <span className="dr-mention-thumb">
                                                            {item.kind === "image" ? <img src={item.previewUrl} alt="" /> : item.kind === "video" ? <video src={item.previewUrl} muted preload="metadata" /> : <Music2 className="size-4" />}
                                                        </span>
                                                        <span>@{item.label}</span>
                                                    </button>
                                                ))}
                                        </div>
                                    ) : (
                                        <p className="dr-pop-empty">还没有素材，先上传图片、视频或音频</p>
                                    )}
                                    <button type="button" className="dr-mention-add" onClick={() => (close(), requireLogin() && fileInput.current?.click())}>
                                        <Plus className="size-3.5" /> 上传素材
                                    </button>
                                </div>
                            )}
                        </Pop>
                        <Pop
                            width={300}
                            trigger={(open, toggle) => (
                                <button type="button" className="dr-chip" data-tone="accent" data-open={open || undefined} onClick={toggle}>
                                    {currentMode.icon}
                                    <span>{currentMode.label}</span>
                                    <ChevronDown className="dr-caret size-3.5" />
                                </button>
                            )}
                        >
                            {(close) => (
                                <div className="dr-mode-list">
                                    {MODES.map((item) => (
                                        <button key={item.mode} type="button" data-active={item.mode === mode || undefined} onClick={() => (setMode(item.mode), close())}>
                                            <span className="dr-mode-icon">{item.icon}</span>
                                            <span className="dr-mode-copy">
                                                <strong>{item.label}</strong>
                                                <small>{item.description}</small>
                                            </span>
                                            {item.mode === mode ? <Check className="size-4" /> : null}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Pop>
                        <button type="button" className="dr-chip" data-open={skillOpen || undefined} onClick={() => setSkillOpen(true)}>
                            <Sparkles className="size-4" />
                            <span>技能</span>
                        </button>
                    </div>
                    <div className="dr-bar-center">
                        <Pop
                            align="center"
                            width={mode === "agent" ? 420 : 680}
                            trigger={(open, toggle) => (
                                <button type="button" className="dr-param-chip" data-open={open || undefined} onClick={toggle}>
                                    <Clapperboard className="size-3.5" />
                                    <span className="dr-param-label">{paramLabel}</span>
                                    <ChevronDown className="dr-caret size-3.5" />
                                </button>
                            )}
                        >
                            {() =>
                                mode === "agent" ? (
                                    <div className="dr-params dr-params-agent">
                                        <div className="dr-pop-title">题材</div>
                                        <Seg items={GENRES} value={genre} onChange={setGenre} />
                                        <div className="dr-pop-title">画风</div>
                                        <Seg items={STYLES} value={style} onChange={setStyle} />
                                        <div className="dr-pop-title">画幅</div>
                                        <Seg
                                            items={DRAMA_RATIOS}
                                            value={dramaRatio}
                                            onChange={setDramaRatio}
                                            format={(item) => (
                                                <>
                                                    {ratioIcon(item)}
                                                    {item}
                                                </>
                                            )}
                                        />
                                        <div className="dr-pop-title">单集时长</div>
                                        <Seg items={LENGTHS} value={length} onChange={setLength} format={(item) => `${item}s`} />
                                    </div>
                                ) : (
                                    <div className="dr-params">
                                        <div className="dr-model-col">
                                            <div className="dr-pop-title">模型</div>
                                            {models.length ? (
                                                <div className="dr-model-list">
                                                    {models.map((item) => (
                                                        <button key={item} type="button" data-active={item === model || undefined} onClick={() => setModel(item)}>
                                                            <ModelLogo icon={modelIcon(config, item)} size={18} />
                                                            <span className="truncate">{modelDisplayName(config, item)}</span>
                                                            {item === model ? <Check className="size-4" /> : null}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="dr-pop-empty">后台还没有开放{mode === "video" ? "视频" : "图片"}模型</p>
                                            )}
                                        </div>
                                        <div className="dr-spec-col">
                                            {spec.ratios.length ? (
                                                <>
                                                    <div className="dr-pop-title">画面比例</div>
                                                    <Seg
                                                        items={spec.ratios}
                                                        value={spec.ratio}
                                                        onChange={(ratio) => updateSpec({ ratio })}
                                                        format={(item) => (
                                                            <>
                                                                {ratioIcon(item)}
                                                                {item}
                                                            </>
                                                        )}
                                                    />
                                                </>
                                            ) : null}
                                            {spec.resolutions.length ? (
                                                <>
                                                    <div className="dr-pop-title">{mode === "video" ? "视频分辨率" : "图片分辨率"}</div>
                                                    <Seg items={spec.resolutions} value={spec.resolution} onChange={(resolution) => updateSpec({ resolution })} />
                                                </>
                                            ) : null}
                                            {spec.durations.length ? (
                                                <>
                                                    <div className="dr-pop-title">视频时长</div>
                                                    <Seg items={spec.durations} value={spec.seconds} onChange={(seconds) => updateSpec({ seconds })} format={(item) => `${item}s`} />
                                                </>
                                            ) : null}
                                            {!spec.ratios.length && !spec.resolutions.length && !spec.durations.length ? <p className="dr-pop-empty">该模型没有可调参数，按后台默认配置生成</p> : null}
                                        </div>
                                    </div>
                                )
                            }
                        </Pop>
                    </div>
                    <div className="dr-bar-right">
                        <Tooltip title="短剧模式全程在画布中创作，画布始终开启">
                            <span className="dr-canvas-lock" aria-label="画布已开启">
                                <span className="dr-switch" data-on>
                                    <i />
                                </span>
                                画布
                            </span>
                        </Tooltip>
                        <motion.button type="button" className="dr-send" data-ready={text.trim() ? true : undefined} aria-label="进入画布开始创作" disabled={launching} onClick={() => void submit()} whileTap={{ scale: 0.88 }}>
                            {launching ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.4} />}
                        </motion.button>
                    </div>
                </div>
            </div>
            <DramaSkillPicker open={skillOpen} onClose={() => setSkillOpen(false)} onPick={pickSkill} selectedId={skill?.skillId} />
            {launching ? createPortal(<LaunchOverlay mode={mode} reduced={Boolean(reduced)} />, document.body) : null}
        </>
    );
}

/** 发送后的进入动效：点阵画布从中心展开、节点连线依次亮起，然后切到画布页。 */
function LaunchOverlay({ mode, reduced }: { mode: DramaMode; reduced: boolean }) {
    const label = mode === "agent" ? "画布助手正在接手你的故事" : mode === "video" ? "正在进入画布生成视频" : "正在进入画布生成图片";
    return (
        <motion.div className="dr-launch ms-scope" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.25 }}>
            <motion.div className="dr-launch-grid" initial={reduced ? false : { scale: 0.4, opacity: 0, rotateX: 40 }} animate={{ scale: 1, opacity: 1, rotateX: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
            <svg className="dr-launch-nodes" viewBox="0 0 400 200" aria-hidden>
                {["M80 60 C140 60 140 100 200 100", "M80 140 C140 140 140 100 200 100", "M260 100 C300 100 300 60 330 60", "M260 100 C300 100 300 140 330 140"].map((d, index) => (
                    <motion.path key={d} d={d} initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ delay: 0.15 + index * 0.1, duration: 0.5 }} />
                ))}
                {[
                    [30, 44, 50, 32],
                    [30, 124, 50, 32],
                    [200, 80, 60, 40],
                    [330, 44, 50, 32],
                    [330, 124, 50, 32],
                ].map(([x, y, w, h], index) => (
                    <motion.rect
                        key={index}
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        rx={9}
                        initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.1 + index * 0.08, type: "spring", stiffness: 320, damping: 22 }}
                        style={{ transformOrigin: `${x + w / 2}px ${y + h / 2}px` }}
                    />
                ))}
            </svg>
            <motion.div className="dr-launch-text" initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <span className="dr-launch-orb" />
                {label}
                <span className="dr-launch-dots">
                    <i />
                    <i />
                    <i />
                </span>
            </motion.div>
        </motion.div>
    );
}
