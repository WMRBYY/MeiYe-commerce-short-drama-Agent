import { Button, Input, Select } from "antd";
import { Check, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import type { ClipMode, ClipTemplate, ShopClipVisual } from "@/services/api/video-edit";

const STYLE_OPTIONS: Array<{ key: keyof ShopClipVisual; label: string; options: Array<{ value: string; label: string }>; mixOnly?: boolean }> = [
    {
        key: "subtitleStyle",
        label: "字幕样式",
        options: [
            { value: "outline", label: "清晰描边" },
            { value: "solid", label: "醒目实色" },
            { value: "panel", label: "字幕底板" },
            { value: "highlight", label: "重点花字" },
            { value: "serif", label: "雅致衬线" },
            { value: "bubble", label: "气泡字幕" },
        ],
    },
    {
        key: "animation",
        label: "文字动效",
        options: [
            { value: "none", label: "静态呈现" },
            { value: "fade", label: "轻柔淡入" },
            { value: "rise", label: "向上浮现" },
            { value: "pop", label: "弹性入场" },
        ],
    },
    {
        key: "filter",
        label: "画面滤镜",
        options: [
            { value: "original", label: "保留原色" },
            { value: "warm", label: "温暖氛围" },
            { value: "cool", label: "清透冷调" },
            { value: "soft", label: "柔和质感" },
            { value: "crisp", label: "鲜明细节" },
            { value: "mono", label: "黑白叙事" },
        ],
    },
    {
        key: "widget",
        label: "画面组件",
        options: [
            { value: "none", label: "简洁画面" },
            { value: "label", label: "标题标签" },
            { value: "underline", label: "强调线条" },
            { value: "corner", label: "角标标识" },
            { value: "progress", label: "进度装饰" },
        ],
    },
    {
        key: "transition",
        label: "素材转场",
        mixOnly: true,
        options: [
            { value: "cut", label: "干净切换" },
            { value: "dissolve", label: "柔和叠化" },
            { value: "slide", label: "滑动切入" },
        ],
    },
    {
        key: "layout",
        label: "素材排版",
        mixOnly: true,
        options: [
            { value: "full", label: "全屏穿插" },
            { value: "pip", label: "画中画" },
        ],
    },
];

function TemplatePreview({ template, compact = false }: { template: ClipTemplate; compact?: boolean }) {
    const style = template.preview
        ? ({
              "--scl-preview-bg": template.preview.background,
              "--scl-preview-fg": template.preview.foreground,
              "--scl-preview-accent": template.preview.accent,
              "--scl-preview-font": template.preview.font,
          } as CSSProperties)
        : undefined;
    const reduced = useReducedMotion();
    return (
        <div className="scl-template-preview" style={style} data-style={template.visual?.subtitleStyle} data-compact={compact || undefined}>
            {template.previewUrl ? (
                <video
                    src={template.previewUrl}
                    muted
                    playsInline
                    loop
                    preload="none"
                    onPointerEnter={(event) => {
                        if (!reduced) void event.currentTarget.play().catch(() => undefined);
                    }}
                    onPointerLeave={(event) => event.currentTarget.pause()}
                />
            ) : (
                <>
                    <span className="scl-template-scene" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                    </span>
                    <span className="scl-template-eyebrow">{template.group || "精选样式"}</span>
                    <strong>
                        <span>让每一次表达</span>
                        <span>都有记忆点</span>
                    </strong>
                    <span className="scl-template-preview-label">字幕样式示意</span>
                </>
            )}
        </div>
    );
}

export function ClipTemplatePicker({
    open,
    mode,
    templates,
    templateId,
    visual,
    onClose,
    onUse,
}: {
    open: boolean;
    mode: ClipMode;
    templates: ClipTemplate[];
    templateId: string;
    visual?: ShopClipVisual;
    onClose: () => void;
    onUse: (id: string, visual?: ShopClipVisual) => void;
}) {
    const reduced = useReducedMotion();
    const [query, setQuery] = useState("");
    const [group, setGroup] = useState("全部");
    const [draftId, setDraftId] = useState(templateId);
    const [draftVisual, setDraftVisual] = useState(visual);
    const available = useMemo(() => templates.filter((template) => !template.modes?.length || template.modes.includes(mode)), [mode, templates]);
    const groups = ["全部", ...new Set(available.map((template) => template.group).filter((value): value is string => Boolean(value)))];
    const filtered = available.filter((template) => (group === "全部" || template.group === group) && `${template.name} ${template.description} ${(template.tags || []).join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const selected = available.find((template) => template.id === draftId);
    useEffect(() => {
        if (open) {
            setDraftId(templateId);
            setDraftVisual(visual);
            setGroup("全部");
            setQuery("");
        }
    }, [open, templateId, visual]);
    return (
        <AppModal open={open} onCancel={onClose} footer={null} closable={false} flush width={920} centered className="scl-template-modal ms-scope" title={null} aria-label="选择剪辑模板">
            <motion.div className="scl-dialog" initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}>
                <header className="scl-dialog-head">
                    <div>
                        <span className="scl-dialog-kicker">
                            <Sparkles size={14} /> 剪辑风格库
                        </span>
                        <h2>找到这条视频的表达方式</h2>
                        <p>从模板开始，再微调字幕、动效和画面质感。</p>
                    </div>
                    <Button type="text" icon={<X size={18} />} aria-label="关闭模板库" onClick={onClose} />
                </header>
                <div className="scl-template-tools">
                    <Input prefix={<Search size={15} />} aria-label="搜索剪辑模板" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索风格、品类或效果" allowClear />
                    <span>{available.length} 款模板</span>
                </div>
                <div className="scl-template-groups" aria-label="模板分类">
                    {groups.map((item) => (
                        <button type="button" key={item} aria-pressed={item === group} onClick={() => setGroup(item)}>
                            {item}
                        </button>
                    ))}
                </div>
                <div className="scl-template-body">
                    <div className="scl-template-grid">
                        {filtered.map((template) => (
                            <motion.button
                                type="button"
                                key={template.id}
                                className="scl-template-card"
                                aria-pressed={draftId === template.id}
                                whileHover={reduced ? undefined : { y: -3 }}
                                whileTap={reduced ? undefined : { scale: 0.985 }}
                                onClick={() => {
                                    setDraftId(template.id);
                                    setDraftVisual(template.visual);
                                }}
                            >
                                <TemplatePreview template={template} />
                                <span className="scl-template-card-info">
                                    <strong>{template.name}</strong>
                                    <small>{template.description}</small>
                                    <span className="scl-template-tags">
                                        {template.tags?.slice(0, 3).map((tag) => (
                                            <span key={tag}>{tag}</span>
                                        ))}
                                    </span>
                                </span>
                                {draftId === template.id && (
                                    <span className="scl-template-check">
                                        <Check size={13} />
                                    </span>
                                )}
                            </motion.button>
                        ))}
                        {!filtered.length && <p className="scl-template-no-results">没有找到这个风格，换一个关键词试试。</p>}
                    </div>
                    {selected && (
                        <aside className="scl-template-custom">
                            <span className="scl-dialog-kicker">
                                <SlidersHorizontal size={14} /> 模板微调
                            </span>
                            <h3>{selected.name}</h3>
                            <p>{selected.description}</p>
                            {draftVisual &&
                                STYLE_OPTIONS.filter((field) => !field.mixOnly || mode === "mix").map((field) => (
                                    <label key={field.key}>
                                        <span>{field.label}</span>
                                        <Select aria-label={field.label} value={draftVisual[field.key]} options={field.options} onChange={(value: string) => setDraftVisual({ ...draftVisual, [field.key]: value })} />
                                    </label>
                                ))}
                            <span className="scl-template-note">所选效果会应用到成片。卡片展示字幕风格，实际效果以视频内容为准。</span>
                        </aside>
                    )}
                </div>
                <footer className="scl-dialog-footer">
                    <span>{selected ? `已选 · ${selected.name}` : "选择一款适合内容的模板"}</span>
                    <Button
                        type="primary"
                        disabled={!selected}
                        onClick={() => {
                            if (selected) {
                                onUse(selected.id, draftVisual);
                                onClose();
                            }
                        }}
                    >
                        使用这款风格
                    </Button>
                </footer>
            </motion.div>
        </AppModal>
    );
}
