import { App, Popover, Tooltip } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, AtSign, Ban, Check, Expand, Keyboard, LoaderCircle, Minus, Plus, Shrink, Square, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { useUserStore } from "@/stores/use-user-store";

import { ToolIcon } from "@/components/mode/mode-icons";
import { ModelPicker } from "@/components/model-picker";
import { RollingCreditAmount } from "@/components/rolling-credit-text";
import { CreditStar } from "@/components/ui/credit-star";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { CanvasResourceMentionTextarea, type CanvasResourceMentionTextareaActions } from "@/components/canvas/canvas-resource-mention-textarea";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { resourceIdFromStorageKey, resourceVariantUrl } from "@/services/api/resources";
import { modelDisplayName } from "@/stores/use-config-store";
import { imageSizeLabel } from "@/pages/ecommerce/catalog";
import { TryOnComposerSections } from "@/pages/ecommerce/tryon/tryon-composer";
import { TryOnUploadTipCard } from "@/pages/ecommerce/tryon/tryon-demos";
import { TryOnReferenceLibrary } from "@/pages/ecommerce/tryon/reference-library";
import { WorkbenchAssetPicker } from "@/pages/workbench/workbench-asset-picker";
import { MAX_TRYON_COUNT, TRYON_FUNCTIONS, tryOnFunction, type TryOnFunction, type TryOnSlot } from "@/pages/ecommerce/tryon/tryon-kinds";
import { tryOnPromptReferences, usesAiModel } from "@/pages/ecommerce/tryon/tryon-plan";
import type { TryOnState } from "@/pages/ecommerce/tryon/use-tryon";
import "@/pages/ecommerce/shared-image-controls.css";

import "@/pages/ecommerce/tryon/tryon.css";

import type { ShopFn } from "./shop-context";
import { ShopDropdown } from "./shop-dropdown";
import { ShopPromptPopup } from "./shop-creation-dock";
import { addChatFiles, addChatResources, CHAT_MAX_REFS, editSize, removeChatRef, submitShopEdits, updateChatDraft, useChatDraft, useImageQuote } from "./shop-edits";
import { TRYON_ICON } from "./shop-functions";
import { ShopReversePrompt } from "./shop-reverse-prompt";
import { ShopReferencePreview } from "./shop-reference-preview";
import { ImageModelLibrary } from "./model-library/image-model-library";
import "./shop.css";

const SHORTCUTS: Array<[string, string]> = [
    ["Enter", "开始生成"],
    ["Shift + Enter", "换行"],
    ["Ctrl + V", "粘贴图片到参考图"],
    ["拖拽", "把图片拖进输入框上传"],
    ["Esc", "关闭弹出的面板"],
];
const CANVAS_TIP_CLASSES = { root: "sp-canvas-field-tip ms-scope", container: "sp-canvas-field-tip-inner" };

/**
 * 上传位：传好的图直接显示在卡片里（悬停出 ✕ 删除），还有空位时后面跟一张「+」卡片；
 * 空卡片悬停出「上传示范」，点击打开对应素材库。
 */
function SlotCard({ state, slot, index, onLibrary }: { state: TryOnState; slot: TryOnSlot; index: number; onLibrary: (slot: TryOnSlot, trigger: HTMLButtonElement) => void }) {
    const images = state.slotImages(slot.key);
    const [tip, setTip] = useState(false);
    const reduced = useReducedMotion();
    const full = images.length >= slot.max;
    const addCard = (
        <motion.button
            type="button"
            className="sp-slot"
            data-more={images.length ? true : undefined}
            onClick={(event) => {
                setTip(false);
                onLibrary(slot, event.currentTarget);
            }}
            initial={reduced ? false : { opacity: 0, y: 8, rotate: -4 }}
            animate={{ opacity: 1, y: 0, rotate: images.length ? 0 : index % 2 ? 3 : -3 }}
            whileHover={reduced ? undefined : { rotate: 0, y: -3, scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            aria-label={`选择${slot.label}`}
            aria-haspopup="dialog"
        >
            {images.length ? null : <span className="sp-slot-tag">{slot.min ? "必填" : "可选"}</span>}
            <Plus className="sp-slot-plus size-5" strokeWidth={1.6} />
            <span className="sp-slot-label">{images.length ? "继续添加" : slot.label}</span>
            {images.length ? (
                <span className="sp-slot-count">
                    {images.length}/{slot.max}
                </span>
            ) : null}
        </motion.button>
    );
    return (
        <div className="sp-slot-group">
            <div className="sp-slot-wrap">
                <AnimatePresence initial={false}>
                    {images.map((image, order) => (
                        <motion.span
                            key={image.id}
                            layout={!reduced}
                            className="sp-slot sp-slot-filled"
                            data-error={image.error ? true : undefined}
                            title={image.error || image.name}
                            initial={reduced ? false : { opacity: 0, scale: 0.8, y: 6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        >
                            <ShopReferencePreview src={image.previewUrl} name={image.name || slot.label} />
                            {!image.resourceId && !image.error ? (
                                <i className="sp-slot-loading">
                                    <LoaderCircle className="sp-spin size-4" />
                                </i>
                            ) : null}
                            <em>{image.error ? "上传失败" : images.length > 1 ? `${slot.label}${order + 1}` : slot.label}</em>
                            <button type="button" aria-label="移除" onClick={() => state.removeImage(image.id)}>
                                <X className="size-3" strokeWidth={2.6} />
                            </button>
                        </motion.span>
                    ))}
                </AnimatePresence>
                {full ? null : images.length ? (
                    addCard
                ) : (
                    <Popover
                        open={tip}
                        onOpenChange={setTip}
                        trigger={["hover"]}
                        mouseEnterDelay={0.3}
                        mouseLeaveDelay={0.15}
                        placement="bottomLeft"
                        arrow={false}
                        classNames={{ root: "ecv-tip-popover ect-tip-popover sp-tip-popover" }}
                        content={<TryOnUploadTipCard kind={slot.tip} onClose={() => setTip(false)} onDismiss={() => setTip(false)} />}
                    >
                        {addCard}
                    </Popover>
                )}
            </div>
        </div>
    );
}

const CHAT_EXAMPLES = ["白色陶瓷马克杯放在浅色原木桌面上，清晨自然窗光，背景简洁", "模特穿着参考图里的连衣裙在海边散步，逆光，胶片质感"];

/** 对话生图的参考图：每张一个缩略图卡片（左下角「图N」，悬停出删除），最后是「+」添加卡片；输入 @ 可引用。 */
function ChatRefStrip({ canvas, onLibrary }: { canvas: boolean; onLibrary: (trigger: HTMLButtonElement) => void }) {
    const draft = useChatDraft();
    const reduced = useReducedMotion();
    const full = draft.refs.length >= CHAT_MAX_REFS;
    const readyNumber = canvas ? new Map(draft.refs.filter((ref) => ref.resourceId && !ref.error).map((ref, index) => [ref.id, index + 1])) : null;
    return (
        <div className="sp-slot-group">
            <div className="sp-refs">
                <AnimatePresence initial={false}>
                    {draft.refs.map((ref, index) => (
                        <motion.span
                            key={ref.id}
                            layout={!reduced}
                            className="sp-ref"
                            data-error={ref.error ? true : undefined}
                            title={ref.error || ref.name}
                            initial={reduced ? false : { opacity: 0, scale: 0.8, y: 6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        >
                            <ShopReferencePreview src={canvas && ref.resourceId ? resourceVariantUrl(ref.resourceId, "thumbnail") : ref.previewUrl} name={`参考图 ${index + 1}`} />
                            {!ref.resourceId && !ref.error ? (
                                <i className="sp-ref-loading">
                                    <LoaderCircle className="sp-spin size-4" />
                                </i>
                            ) : null}
                            <em>{readyNumber ? (readyNumber.has(ref.id) ? `图${readyNumber.get(ref.id)}` : ref.error ? "上传失败" : "上传中") : `图${index + 1}`}</em>
                            <button type="button" aria-label="移除" onClick={() => removeChatRef(ref.id)}>
                                <X className="size-3" strokeWidth={2.6} />
                            </button>
                        </motion.span>
                    ))}
                </AnimatePresence>
                {full ? null : (
                    <motion.button
                        type="button"
                        layout={!reduced}
                        className="sp-ref-add"
                        data-empty={!draft.refs.length || undefined}
                        onClick={(event) => onLibrary(event.currentTarget)}
                        whileHover={reduced ? undefined : { y: -2 }}
                        whileTap={{ scale: 0.94 }}
                        aria-label="添加参考图"
                        aria-haspopup="dialog"
                    >
                        <Plus className="size-4" strokeWidth={1.8} />
                        {draft.refs.length ? null : <small>参考图</small>}
                    </motion.button>
                )}
            </div>
        </div>
    );
}

export function ShopComposer({
    state,
    allowed,
    mode,
    onPickFunction,
    variant = "hero",
    onSubmitted,
    canvasProjectId,
    modelBoundCount = false,
    managed = false,
    generationPage = false,
    toolbarExtra,
    canvasReferences,
    onCanvasReferenceSelect,
    resolveCanvasPrompt,
}: {
    state: TryOnState;
    allowed: TryOnFunction[];
    /** 界面上选中的功能（对话生图或某个换装功能）。 */
    mode: ShopFn;
    onPickFunction: (fn: ShopFn) => void;
    variant?: "hero" | "dock";
    onSubmitted?: (itemKeys: string[]) => void;
    canvasProjectId?: string;
    modelBoundCount?: boolean;
    managed?: boolean;
    /** 仅生成页启用的紧凑工具栏入口，首页与画布保持原有展示。 */
    generationPage?: boolean;
    toolbarExtra?: ReactNode;
    canvasReferences?: CanvasResourceReference[];
    onCanvasReferenceSelect?: (reference: CanvasResourceReference) => CanvasResourceReference | undefined;
    resolveCanvasPrompt?: (prompt: string) => string;
}) {
    const { message } = App.useApp();
    const reduced = useReducedMotion();
    const canvasEditor = Boolean(canvasProjectId);
    const { draft } = state;
    const chat = mode === "chat";
    const chatDraft = useChatDraft();
    const chatRefs = useMemo(() => chatDraft.refs.filter((ref) => ref.resourceId && !ref.error), [chatDraft.refs]);
    const chatSize = editSize(state.config, state.imageModel, state.ratio);
    const chatQuote = useImageQuote(state.config, chat ? state.imageModel : "", chatSize, state.resolution, chatRefs.length);
    const [reverseOpen, setReverseOpen] = useState(false);
    const reverseQuote = useImageQuote(state.config, reverseOpen ? state.imageModel : "", chatSize, state.resolution, 0);
    const creditsEnabled = useUserStore((store) => store.features.creditsEnabled);
    const chatMaxRefs = Math.min(20, modelCapabilityConfigFor(state.config, state.imageModel).image?.references.maxImages || 0);
    const chatMissing = !chatDraft.text.trim()
        ? "先写下想生成的画面"
        : chatDraft.refs.some((ref) => !ref.resourceId && !ref.error)
          ? "参考图还在上传"
          : !state.imageModel
            ? "当前没有可用的图片模型"
            : chatRefs.length > chatMaxRefs
              ? `当前模型最多接收 ${chatMaxRefs} 张参考图，请减少参考图或换模型`
              : creditsEnabled && chatQuote.value === null
                ? chatQuote.loading
                    ? "正在报价，请稍候"
                    : "当前配置暂时无法报价，请稍后重试或更换模型"
                : "";
    const missing = chat ? chatMissing : state.missing;
    const total = chat ? (chatQuote.value === null ? null : chatQuote.value * chatDraft.count) : state.total;
    const quoting = chat ? chatQuote.loading : state.estimate.loading;
    const reverseBlocked = !state.imageModel ? "当前没有可用的图片模型" : creditsEnabled && reverseQuote.value === null ? (reverseQuote.loading ? "正在报价，请稍候" : "当前配置暂时无法报价，请稍后重试或更换模型") : "";
    const count = chat ? chatDraft.count : state.count;
    const minCount = chat ? 1 : state.units;
    const modelMax = modelCapabilityConfigFor(state.config, state.imageModel).image?.maxOutputs || 1;
    const maxCount = modelBoundCount ? Math.max(minCount, Math.min(chat ? 8 : MAX_TRYON_COUNT, modelMax)) : chat ? 8 : MAX_TRYON_COUNT;
    const setCount = (value: number) => (chat ? updateChatDraft((current) => ({ ...current, count: Math.max(minCount, Math.min(maxCount, value)) })) : state.setCount(Math.min(maxCount, value)));
    useEffect(() => {
        if (modelBoundCount && count > maxCount) setCount(maxCount);
    }, [modelBoundCount, count, maxCount]);
    const text = chat ? chatDraft.text : draft.notes;
    const setText = (value: string) => (chat ? updateChatDraft((current) => ({ ...current, text: value })) : state.update({ notes: value }));
    const config = tryOnFunction(draft.fn);
    const fnLabel = chat ? "对话生图" : config.label;
    const examples = chat ? CHAT_EXAMPLES : config.examples;
    const ai = usesAiModel(draft);
    const slots = config.slots.filter((slot) => !(slot.key === "model" && ai));
    const submittedCanvasChat = useRef(false);
    const [library, setLibrary] = useState<{ slot: TryOnSlot; personal?: boolean } | "chat" | null>(null);
    const libraryTrigger = useRef<HTMLButtonElement | null>(null);
    const closeLibrary = () => {
        setLibrary(null);
        requestAnimationFrame(() => libraryTrigger.current?.isConnected && libraryTrigger.current.focus());
    };
    useEffect(() => setLibrary(null), [mode, state.scope]);
    const librarySlot = library && library !== "chat" ? library.slot : null;
    const libraryRoom = librarySlot ? (librarySlot.max === 1 ? 1 : Math.max(0, librarySlot.max - state.slotImages(librarySlot.key).length)) : Math.max(0, CHAT_MAX_REFS - chatDraft.refs.length);
    const [expanded, setExpanded] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const reverseTrigger = useRef<HTMLButtonElement>(null);
    const [mention, setMention] = useState<{ at: number; active: number } | null>(null);
    const canvasPrompt = useRef<CanvasResourceMentionTextareaActions | null>(null);
    const [drag, setDrag] = useState(false);
    const [feedback, setFeedback] = useState<"" | "pop" | "shake">("");
    const placement = variant === "dock" ? "top" : "bottom";
    const functions = TRYON_FUNCTIONS.filter((item) => allowed.includes(item.id));

    useEffect(() => {
        if (!feedback) return;
        const timer = window.setTimeout(() => setFeedback(""), 520);
        return () => window.clearTimeout(timer);
    }, [feedback]);

    const firstOpenSlot = () => slots.find((slot) => state.slotImages(slot.key).length < slot.max) || slots[0];
    const addFiles = (files: File[], slot = firstOpenSlot()) => {
        const images = files.filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        if (chat) {
            void addChatFiles(images).then((skipped) => skipped > 0 && message.warning(`参考图最多 ${CHAT_MAX_REFS} 张，${skipped} 张未添加`));
            return;
        }
        if (!slot) return;
        void state.addFiles(slot.key, images);
    };
    const submitChat = (text: string, refs: string[]) => {
        if (canvasProjectId && submittedCanvasChat.current) return;
        const resolved = resolveCanvasPrompt?.(text) ?? text;
        const prompt = refs.length ? resolved.replace(/@图(\d+)/g, (_, index: string) => `参考图${index}`) : resolved;
        const records = submitShopEdits(
            { scope: state.scope, config: state.config },
            { model: state.imageModel, modelLabel: modelDisplayName(state.config, state.imageModel), ratio: state.ratio, resolution: state.resolution, canvasProjectId },
            Array.from({ length: chatDraft.count }, () => ({ kind: "chat" as const, text, prompt, references: refs, submitRefs: refs })),
        );
        if (canvasProjectId) submittedCanvasChat.current = true;
        message.success(`已开始生成 ${chatDraft.count} 张`);
        setFeedback("pop");
        onSubmitted?.(records.map((record) => `e:${record.id}`));
    };
    const submit = () => {
        if (missing || state.submitting) {
            setFeedback("shake");
            if (missing) message.warning(missing);
            return;
        }
        if (chat) {
            submitChat(
                chatDraft.text.trim(),
                chatRefs.map((ref) => ref.resourceId),
            );
            return;
        }
        void state.generate(resolveCanvasPrompt).then((batch) => {
            if (!batch) return;
            setFeedback("pop");
            onSubmitted?.(batch.jobs.map((job) => `t:${batch.id}:${job.key}`));
        });
    };
    const mentionables = chat ? chatDraft.refs.filter((ref) => ref.resourceId) : [];
    const canvasPromptReferences = useMemo<CanvasResourceReference[]>(() => {
        if (!canvasEditor) return [];
        const inputs = chat ? chatRefs.map((ref, index) => ({ resourceId: ref.resourceId, label: `图${index + 1}`, name: ref.name })) : tryOnPromptReferences(draft);
        const inputIds = new Set(inputs.map((input) => input.resourceId));
        return [
            ...inputs.map(({ resourceId, label, name }) => ({
                id: `composer:${resourceId}:${label}`,
                nodeId: `composer:${resourceId}`,
                kind: "image" as const,
                label,
                title: name || label,
                active: true,
                mentionToken: `@${label}`,
                previewUrl: resourceVariantUrl(resourceId, "thumbnail-small"),
            })),
            ...(canvasReferences || []).filter((reference) => reference.kind !== "image" || !inputIds.has(resourceIdFromStorageKey(reference.storageKey))),
        ];
    }, [canvasEditor, canvasReferences, chat, chatRefs, draft]);
    const insertMention = (index: number) => {
        const area = textarea.current;
        if (!area || !mention) return;
        const before = text.slice(0, mention.at);
        const after = text.slice(area.selectionStart);
        const token = `@图${index + 1} `;
        setText(before + token + after);
        setMention(null);
        requestAnimationFrame(() => {
            area.focus();
            const caret = before.length + token.length;
            area.setSelectionRange(caret, caret);
        });
    };
    const onTextChange = (value: string, caret: number) => {
        setText(value);
        if (!chat) return;
        // 光标前紧挨着的是一个新输入的 @，就弹出引用列表。
        const at = value.lastIndexOf("@", caret - 1);
        if (at >= 0 && at === caret - 1 && mentionables.length) setMention({ at, active: 0 });
        else if (mention && (caret <= mention.at || /\s/.test(value.slice(mention.at, caret)))) setMention(null);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (mention && mentionables.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setMention({ ...mention, active: (mention.active + step + mentionables.length) % mentionables.length });
                return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(chatDraft.refs.indexOf(mentionables[mention.active]));
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
            }
        }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
        }
    };
    const onPaste = (event: ClipboardEvent<HTMLElement>) => {
        const files = [...event.clipboardData.files];
        if (files.some((file) => file.type.startsWith("image/"))) {
            event.preventDefault();
            addFiles(files);
        }
    };
    const onDrop = (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDrag(false);
        addFiles([...event.dataTransfer.files]);
    };

    const ratioText = imageSizeLabel(state.ratio);
    const busy = state.submitting;
    const unavailable = Boolean(missing) || busy;

    return (
        <div
            className="sp-composer"
            data-canvas-editor={canvasEditor || undefined}
            data-variant={variant}
            data-expanded={expanded || undefined}
            data-drag={drag || undefined}
            data-feedback={feedback || undefined}
            onPaste={onPaste}
            onDragOver={(event) => {
                event.preventDefault();
                setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
        >
            {!canvasEditor ? <div className="sp-paste-hint">Ctrl + V 可直接粘贴图片</div> : null}
            <div className="sp-composer-body">
                {canvasEditor ? (
                    <div className="sp-canvas-reference-head">
                        <span>参考素材</span>
                    </div>
                ) : null}
                <div className="sp-slots" data-canvas-wheel-scroll={canvasEditor || undefined}>
                    {chat ? (
                        <ChatRefStrip
                            canvas={canvasEditor}
                            onLibrary={(trigger) => {
                                libraryTrigger.current = trigger;
                                setLibrary("chat");
                            }}
                        />
                    ) : (
                        slots.map((slot, index) => (
                            <SlotCard
                                key={`${draft.fn}:${slot.key}`}
                                state={state}
                                slot={slot}
                                index={index}
                                onLibrary={(slot, trigger) => {
                                    libraryTrigger.current = trigger;
                                    setLibrary({ slot });
                                }}
                            />
                        ))
                    )}
                </div>
                <div className="sp-text">
                    {canvasEditor ? (
                        <CanvasResourceMentionTextarea
                            actionsRef={canvasPrompt}
                            autoLinkEnabled={false}
                            references={canvasPromptReferences}
                            showUnconnectedReferences
                            onSelectReference={(reference) => (reference.active ? reference : onCanvasReferenceSelect?.(reference))}
                            mentionMenuLabels={{ connected: "关联素材", unconnected: "画布素材", search: "搜索素材" }}
                            containerClassName="sp-canvas-prompt-input"
                            className="sp-canvas-prompt-editor"
                            style={{ color: "var(--ms-text)" }}
                            aria-label="图片提示词"
                            value={text}
                            placeholder={chat ? "描述想生成的画面，输入 @ 引用素材" : config.placeholder}
                            maxLength={chat ? 2000 : 800}
                            onChange={setText}
                            onSubmit={submit}
                        />
                    ) : (
                        <>
                            <textarea
                                ref={textarea}
                                aria-label="图片提示词"
                                value={text}
                                placeholder={chat ? "描述你要的画面，可上传参考图，输入 @ 引用图片。例如：把 @图1 的杯子放在原木桌面上，清晨窗光…" : `${config.description}。${config.placeholder}`}
                                onChange={(event) => onTextChange(event.target.value, event.target.selectionStart)}
                                onBlur={() => window.setTimeout(() => setMention(null), 150)}
                                onKeyDown={onKeyDown}
                                rows={expanded ? 8 : 3}
                                maxLength={chat ? 2000 : 800}
                            />
                            <AnimatePresence>
                                {mention && mentionables.length ? (
                                    <ShopPromptPopup anchor={textarea}>
                                        <motion.div className="sp-mention" role="listbox" initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
                                            <div className="sp-list-title">引用参考图</div>
                                            {mentionables.map((ref, index) => {
                                                const number = chatDraft.refs.indexOf(ref) + 1;
                                                return (
                                                    <button
                                                        key={ref.id}
                                                        type="button"
                                                        role="option"
                                                        aria-selected={index === mention.active}
                                                        data-active={index === mention.active || undefined}
                                                        onMouseDown={(event) => {
                                                            event.preventDefault();
                                                            insertMention(number - 1);
                                                        }}
                                                        onMouseEnter={() => setMention({ ...mention, active: index })}
                                                    >
                                                        <img src={ref.previewUrl} alt="" />
                                                        <span>图{number}</span>
                                                        <small>{ref.name}</small>
                                                    </button>
                                                );
                                            })}
                                        </motion.div>
                                    </ShopPromptPopup>
                                ) : null}
                            </AnimatePresence>
                        </>
                    )}
                    <AnimatePresence>
                        {text && !canvasEditor ? (
                            <motion.button
                                key="clear"
                                type="button"
                                className="sp-clear-text"
                                initial={reduced ? false : { opacity: 0, scale: 0.9, y: 4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                onClick={() => setText("")}
                            >
                                <X className="size-3" strokeWidth={2.4} />
                                清空文字
                            </motion.button>
                        ) : null}
                    </AnimatePresence>
                    <AnimatePresence>
                        {!canvasEditor && !text && examples.length ? (
                            <motion.div className="sp-examples" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {examples.slice(0, 2).map((example) => (
                                    <button key={example} type="button" onClick={() => setText(example)}>
                                        <Wand2 className="size-3" />
                                        {example.length > 22 ? `${example.slice(0, 22)}…` : example}
                                    </button>
                                ))}
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </div>
                {!managed ? (
                    <button type="button" className="sp-icon-btn sp-expand" aria-expanded={expanded} aria-label={expanded ? "收起提示词" : "展开提示词"} onClick={() => setExpanded((value) => !value)}>
                        {expanded ? <Shrink className="size-4" /> : <Expand className="size-4" />}
                    </button>
                ) : null}
            </div>

            <div className="sp-toolbar">
                <div className="sp-toolbar-left">
                    <ShopDropdown className={canvasEditor ? "sp-canvas-mode-hidden" : undefined} tone="accent" placement={placement} width={300} icon={<ToolIcon name={chat ? "chat" : TRYON_ICON[draft.fn]} className="size-4" />} label={fnLabel}>
                        {(close) => (
                            <div className="sp-fn-grid">
                                <motion.button
                                    type="button"
                                    className="sp-fn-item"
                                    data-active={chat || undefined}
                                    initial={reduced ? false : { opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    onClick={() => {
                                        onPickFunction("chat");
                                        close();
                                    }}
                                    title="一句话描述画面，可带参考图，直接出图"
                                >
                                    <span className="sp-fn-icon">
                                        <ToolIcon name="chat" className="size-4" />
                                    </span>
                                    <span className="truncate">对话生图</span>
                                    {chat ? <Check className="sp-fn-check size-3.5" strokeWidth={2.4} /> : null}
                                </motion.button>
                                {functions.map((item, index) => (
                                    <motion.button
                                        key={item.id}
                                        type="button"
                                        className="sp-fn-item"
                                        data-active={(!chat && item.id === draft.fn) || undefined}
                                        initial={reduced ? false : { opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: (index + 1) * 0.018 }}
                                        onClick={() => {
                                            onPickFunction(item.id);
                                            close();
                                        }}
                                        title={item.description}
                                    >
                                        <span className="sp-fn-icon">
                                            <ToolIcon name={TRYON_ICON[item.id]} className="size-4" />
                                        </span>
                                        <span className="truncate">{item.label}</span>
                                        {!chat && item.id === draft.fn ? <Check className="sp-fn-check size-3.5" strokeWidth={2.4} /> : null}
                                    </motion.button>
                                ))}
                            </div>
                        )}
                    </ShopDropdown>

                    <ModelPicker
                        config={state.config}
                        capability="image"
                        value={state.imageModel}
                        onChange={(model) => state.setModel(model)}
                        modelFilter={(model) => state.imageModels.includes(model)}
                        closeOnSelect
                        className="creation-model-picker sp-model-picker"
                        variant="creation"
                        showSelectedPrice={false}
                        showOptionPrices
                        placeholder="选择图片模型"
                    />

                    <ShopDropdown
                        placement={placement}
                        width={260}
                        title="选择当前模型支持的比例与清晰度"
                        ariaLabel={canvasEditor ? `比例与清晰度，${ratioText} · ${String(state.resolution).toUpperCase()}` : undefined}
                        icon={<Square className="size-3.5" />}
                        label={
                            <>
                                {ratioText}
                                <i className="sp-chip-sep" />
                                {String(state.resolution).toUpperCase()}
                            </>
                        }
                    >
                        {() => (
                            <div className="sp-size">
                                <div className="sp-list-title">比例</div>
                                <div className="sp-size-grid">
                                    {state.ratioChoices.map((choice) => (
                                        <button key={choice.value} type="button" data-active={choice.value === state.ratio || undefined} onClick={() => state.update({ ratio: choice.value })}>
                                            <RatioShape value={choice.label} />
                                            {choice.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="sp-list-title">清晰度</div>
                                <div className="sp-seg">
                                    {state.resolutionChoices.map((value) => (
                                        <button key={value} type="button" data-active={value === state.resolution || undefined} onClick={() => state.update({ resolution: value })}>
                                            {String(value).toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </ShopDropdown>

                    <ShopDropdown
                        placement={placement}
                        width={210}
                        title="设置生成张数"
                        ariaLabel={canvasEditor ? `生成张数，${count} 张` : undefined}
                        icon={
                            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                <path d="M5 7h14M5 12h10M5 17h6" />
                            </svg>
                        }
                        label={`${count} 张`}
                    >
                        {() => (
                            <div className="sp-count">
                                <div className="sp-list-title">生成张数</div>
                                <div className="sp-stepper">
                                    <button type="button" aria-label="减少" disabled={count <= minCount} onClick={() => setCount(count - 1)}>
                                        <Minus className="size-3.5" />
                                    </button>
                                    <motion.strong key={count} initial={reduced ? false : { y: -6, opacity: 0, filter: "blur(2px)" }} animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}>
                                        {count}
                                    </motion.strong>
                                    <button type="button" aria-label="增加" disabled={count >= maxCount} onClick={() => setCount(count + 1)}>
                                        <Plus className="size-3.5" />
                                    </button>
                                </div>
                                <div className="sp-count-quick">
                                    {[...new Set([1, 2, 4, 8, ...(modelBoundCount ? [maxCount] : [])])]
                                        .filter((value) => value <= maxCount)
                                        .sort((a, b) => a - b)
                                        .map((value) => (
                                            <button key={value} type="button" disabled={value < minCount} data-active={value === count || undefined} onClick={() => setCount(value)}>
                                                {value}
                                            </button>
                                        ))}
                                </div>
                                {!chat && state.units > 1 ? <p className="sp-hint">当前素材至少 {state.units} 张</p> : null}
                            </div>
                        )}
                    </ShopDropdown>

                    {generationPage && chat ? (
                        <button
                            type="button"
                            className="sp-icon-btn"
                            aria-label="引用参考图"
                            title={mentionables.length ? "引用参考图" : "先添加参考图"}
                            disabled={!mentionables.length}
                            onClick={() => {
                                const area = textarea.current;
                                if (!area) return;
                                const caret = area.selectionStart;
                                const next = text.slice(0, caret) + "@" + text.slice(area.selectionEnd);
                                onTextChange(next, caret + 1);
                                requestAnimationFrame(() => {
                                    area.focus();
                                    area.setSelectionRange(caret + 1, caret + 1);
                                });
                            }}
                        >
                            <AtSign className="size-4" />
                        </button>
                    ) : null}
                </div>

                <div className="sp-toolbar-right">
                    {toolbarExtra}
                    {!canvasEditor ? (
                        <ShopDropdown className={generationPage ? "sp-shortcut-trigger" : undefined} ariaLabel="快捷键" placement={placement} width={240} icon={<Keyboard className="size-3.5" />} label="快捷键">
                            {() => (
                                <div className="sp-shortcuts">
                                    <div className="sp-list-title">快捷键</div>
                                    {SHORTCUTS.map(([key, text]) => (
                                        <div key={key} className="sp-shortcut-row">
                                            <span>{text}</span>
                                            <kbd>{key}</kbd>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ShopDropdown>
                    ) : null}
                    <button ref={reverseTrigger} type="button" className="sp-ghost sp-reverse-trigger" aria-haspopup="dialog" aria-label="反推提示词" title="反推提示词" onClick={() => setReverseOpen(true)}>
                        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                            <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
                            <path d="m15 9 5-5M9 15l-5 5" />
                        </svg>
                        <span>反推提示词</span>
                    </button>
                    {canvasEditor ? (
                        <AntTooltip title={busy ? "正在提交生成" : missing || `生成 ${count} 张图片`} trigger={unavailable ? ["hover", "focus", "click"] : ["hover", "focus"]} classNames={CANVAS_TIP_CLASSES}>
                            <span className="sp-canvas-image-submit-wrap" data-disabled={unavailable || undefined} tabIndex={unavailable && !busy ? 0 : undefined} aria-label={unavailable && !busy ? "查看生成条件" : undefined}>
                                <motion.button className="sp-canvas-image-submit" type="button" disabled={unavailable} aria-label="开始生成" aria-busy={busy} onClick={submit} whileTap={reduced ? undefined : { scale: 0.97 }}>
                                    {creditsEnabled ? (
                                        <span className="sp-canvas-image-price">
                                            <CreditStar />
                                            {total === null ? <em>{quoting ? "报价中" : "--"}</em> : <RollingCreditAmount value={total} maximumFractionDigits={2} />}
                                        </span>
                                    ) : null}
                                    {busy ? "提交中" : "生成图片"}
                                    {busy ? <LoaderCircle className="sp-spin size-4" aria-hidden /> : unavailable ? <Ban className="size-3.5" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
                                </motion.button>
                            </span>
                        </AntTooltip>
                    ) : (
                        <>
                            <span className="sp-price" title={missing || `${count} 张`}>
                                <CreditStar />
                                {total === null ? <em>{quoting ? "报价中" : "--"}</em> : <RollingCreditAmount value={total} maximumFractionDigits={2} />}
                            </span>
                            <Tooltip title={missing || "开始生成"}>
                                <motion.button type="button" className="sp-send" data-ready={!missing || undefined} aria-label="开始生成" aria-busy={busy} onClick={submit} whileTap={{ scale: 0.88 }}>
                                    {busy ? <LoaderCircle className="sp-spin size-4" /> : <ArrowUp className="size-4" strokeWidth={2.4} />}
                                </motion.button>
                            </Tooltip>
                        </>
                    )}
                </div>
            </div>

            {library && library !== "chat" && (library.slot.key === "model" || library.slot.key === "face" || (draft.fn === "enhance" && library.slot.key === "subject")) ? (
                <ImageModelLibrary
                    open
                    max={libraryRoom}
                    current={
                        library.slot.max === 1
                            ? []
                            : state
                                  .slotImages(library.slot.key)
                                  .filter((image) => image.resourceId)
                                  .map((image) => ({ resourceId: image.resourceId!, name: image.name }))
                    }
                    onClose={closeLibrary}
                    onPick={(items) => state.addResources(library.slot.key, items)}
                />
            ) : library && library !== "chat" && !library.personal && (library.slot.key === "pose" || library.slot.key === "garment" || library.slot.key === "garment-back") ? (
                <TryOnReferenceLibrary
                    kind={library.slot.key === "pose" ? "pose" : "garment"}
                    room={libraryRoom}
                    onClose={closeLibrary}
                    onPersonal={() => setLibrary({ ...library, personal: true })}
                    onPick={(selections) => state.addReferences(library.slot.key, selections)}
                />
            ) : library ? (
                <WorkbenchAssetPicker
                    open
                    accept={["image"]}
                    maxCount={libraryRoom}
                    slotName={librarySlot?.label || "参考图"}
                    onClose={closeLibrary}
                    onPick={(items) => {
                        if (library === "chat") addChatResources(items);
                        else state.addResources(library.slot.key, items);
                    }}
                />
            ) : null}
            {canvasEditor && !chat ? (
                <details className="sp-canvas-scene-settings">
                    <summary>场景、模特与风格</summary>
                    <div className="ecs-shell ecv-shell ect-shell">
                        <div className="ect-sections">
                            <TryOnComposerSections state={state} />
                        </div>
                    </div>
                </details>
            ) : null}
            {reverseOpen ? (
                <ShopReversePrompt
                    config={state.config}
                    onClose={() => {
                        setReverseOpen(false);
                        requestAnimationFrame(() => reverseTrigger.current?.focus());
                    }}
                    onApply={(prompt) => {
                        updateChatDraft((draft) => ({ ...draft, text: prompt }));
                        onPickFunction("chat");
                        setReverseOpen(false);
                        requestAnimationFrame(() => textarea.current?.focus());
                    }}
                    generationBlocked={reverseBlocked}
                    onGenerate={(prompt) => {
                        if (reverseBlocked) return;
                        onPickFunction("chat");
                        setReverseOpen(false);
                        submitChat(prompt, []);
                    }}
                />
            ) : null}
        </div>
    );
}

function RatioShape({ value }: { value: string }) {
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
    const ratio = match ? Number(match[1]) / Number(match[2]) : 1;
    const w = ratio >= 1 ? 16 : Math.max(6, 16 * ratio);
    const h = ratio >= 1 ? Math.max(6, 16 / ratio) : 16;
    return <i className="sp-ratio-shape" style={{ width: w, height: h }} data-auto={match ? undefined : true} />;
}
