import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Popover } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, AtSign, Check, ChevronDown, ChevronRight, LoaderCircle, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { translate } from "@/i18n";
import type { Skill } from "@/services/api/skills";
import type { CreationReference } from "../creation-references";
import { AgentModeIcon, AudioModeIcon, ImageModeIcon, MusicModeIcon, SkillIcon, VideoModeIcon } from "./home-icons";

export type HomeMode = "agent" | "image" | "video" | "music" | "audio";

type ModeOption = { mode: HomeMode; label: string; description: string; icon: ComponentType<{ size?: number }> };

export const HOME_MODE_OPTIONS: ModeOption[] = [
    { mode: "agent", get label() { return translate("home.modes.agent.label"); }, get description() { return translate("home.modes.agent.description"); }, icon: AgentModeIcon },
    { mode: "image", get label() { return translate("nav.sidebar.toolboxImage"); }, get description() { return translate("home.modes.image.description"); }, icon: ImageModeIcon },
    { mode: "video", get label() { return translate("nav.sidebar.toolboxVideo"); }, get description() { return translate("home.modes.video.description"); }, icon: VideoModeIcon },
    { mode: "music", get label() { return translate("home.modes.music.label"); }, get description() { return translate("home.modes.music.description"); }, icon: MusicModeIcon },
    { mode: "audio", get label() { return translate("home.modes.audio.label"); }, get description() { return translate("home.modes.audio.description"); }, icon: AudioModeIcon },
];

export const homeModeLabel = (mode: HomeMode) => HOME_MODE_OPTIONS.find((item) => item.mode === mode)?.label || translate("home.modes.agent.label");

const popoverClassNames = { root: "home-popover", container: "home-popover-surface", content: "home-popover-content" };

/** thread=true 用于对话页：音乐/音频走独立面板，不进入对话流，所以只列 Agent / 图片 / 视频。 */
export function HomeModeMenu({ value, onChange, disabled, thread = false }: { value: HomeMode; onChange: (mode: HomeMode) => void; disabled?: boolean; thread?: boolean }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const options = thread ? HOME_MODE_OPTIONS.filter((item) => item.mode !== "music" && item.mode !== "audio") : HOME_MODE_OPTIONS;
    const current = options.find((item) => item.mode === value) || options[0];
    const CurrentIcon = current.icon;
    // 选项不做逐个位移入场：弹层本身有 antd 动效，再叠加位移会让菜单抖动、点击落空。
    const panel = <div className="home-mode-menu" role="listbox" aria-label={t("home.modes.menuLabel")}>
        {options.map((item) => {
            const Icon = item.icon;
            const selected = item.mode === value;
            return <button
                key={item.mode}
                type="button"
                role="option"
                aria-selected={selected}
                className={`home-mode-option${selected ? " is-selected" : ""}`}
                onClick={() => { onChange(item.mode); setOpen(false); }}
            >
                <span className="home-mode-option-icon"><Icon size={18} /></span>
                <span className="home-mode-option-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                {selected ? <Check className="home-mode-option-check" aria-hidden /> : null}
            </button>;
        })}
    </div>;
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomLeft" arrow={false} autoAdjustOverflow classNames={popoverClassNames} content={panel}>
        <button type="button" className="home-chip-control is-mode" data-mode={value} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
            <CurrentIcon size={16} />
            <span>{current.label}</span>
            <ChevronDown className={open ? "is-open" : undefined} aria-hidden />
        </button>
    </Popover>;
}

/** 技能入口只列出“我的技能”（已添加），选择后以 @技能 引用写入提示词，由技能运行时展开。 */
export function HomeSkillsButton({ skills, loading, onOpen, onPick, disabled }: { skills: Skill[]; loading: boolean; onOpen: () => void; onPick: (skill: Skill) => void; disabled?: boolean }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const visible = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return skills.filter((skill) => skill.isAdded && (!keyword || `${skill.skillName} ${skill.description}`.toLowerCase().includes(keyword)));
    }, [query, skills]);
    const panel = <div className="home-skill-menu">
        <header><span>{t("home.skills.mine")}</span><button type="button" onClick={() => { setOpen(false); navigate("/skills"); }}>{t("nav.tools.skills")}<ChevronRight aria-hidden /></button></header>
        <label className="home-skill-search"><Search aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("home.skills.search")} aria-label={t("home.skills.search")} /></label>
        <div className="home-skill-list" role="listbox" aria-label={t("home.skills.mine")}>
            {loading ? <div className="home-menu-state"><LoaderCircle className="animate-spin" aria-hidden />{t("home.skills.loading")}</div>
                : visible.length ? visible.map((skill) => <button key={skill.skillId} type="button" role="option" aria-selected="false" className="home-skill-option" onClick={() => { onPick(skill); setOpen(false); }}>
                    <span className="home-skill-option-badge">/</span>
                    <span className="home-skill-option-copy"><strong>{skill.skillName}</strong><small>{skill.description || t("home.skills.noDescription")}</small></span>
                </button>)
                    : <div className="home-menu-empty"><SkillIcon size={28} /><p>{query ? t("home.skills.noMatch") : t("home.skills.empty")}</p><button type="button" onClick={() => { setOpen(false); navigate("/skills"); }}><Plus aria-hidden />{t("home.skills.goAdd")}</button></div>}
        </div>
    </div>;
    return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) onOpen(); }} trigger="click" placement="bottomLeft" arrow={false} classNames={popoverClassNames} content={panel}>
        <button type="button" className="home-chip-control" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}><SkillIcon size={16} /><span>{t("nav.sidebar.skills")}</span></button>
    </Popover>;
}

/** @ 入口：列出当前可引用的主体（参考素材）与技能；没有任何主体时引导上传创建。 */
export function HomeMentionButton({ references, onPick, onCreateSubject, disabled }: { references: CreationReference[]; onPick: (reference: CreationReference) => void; onCreateSubject: () => void; disabled?: boolean }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const subjects = references.filter((reference) => reference.active && reference.kind !== "skill");
    const panel = <div className="home-mention-menu">
        <header><span>{t("home.mention.title")}</span></header>
        {subjects.length ? <div className="home-mention-grid" role="listbox" aria-label={t("home.mention.subjects")}>
            {subjects.map((reference) => <button key={reference.id} type="button" role="option" aria-selected="false" className="home-mention-item" onClick={() => { onPick(reference); setOpen(false); }}>
                <span className="home-mention-thumb">{reference.previewUrl && reference.kind === "image" ? <img src={reference.previewUrl} alt="" /> : reference.previewUrl && reference.kind === "video" ? <video src={reference.previewUrl} muted playsInline preload="metadata" /> : <AtSign aria-hidden />}</span>
                <span>@{reference.label}</span>
            </button>)}
            <button type="button" className="home-mention-item is-add" onClick={() => { setOpen(false); onCreateSubject(); }}><span className="home-mention-thumb"><Plus aria-hidden /></span><span>{t("home.mention.addSubject")}</span></button>
        </div> : <div className="home-menu-empty is-subject">
            <SubjectEmptyArt />
            <p>{t("home.mention.noSubjects")}</p>
            <button type="button" onClick={() => { setOpen(false); onCreateSubject(); }}><Plus aria-hidden />{t("home.mention.createSubject")}</button>
        </div>}
    </div>;
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomLeft" arrow={false} classNames={popoverClassNames} content={panel}>
        <button type="button" className="home-chip-control is-icon" disabled={disabled} aria-label={t("home.mention.trigger")} aria-haspopup="listbox" aria-expanded={open}><AtSign aria-hidden /></button>
    </Popover>;
}

function SubjectEmptyArt() {
    return <span className="home-subject-art" aria-hidden>
        <span className="is-back" />
        <span className="is-front"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V7" /><path d="m8 10.5 4-4 4 4" /><path d="M7 18h10" /></svg></span>
    </span>;
}

/** 首页上传格：没有参考素材时占位在输入框左侧，悬停时轻微倾斜。 */
export function HomeUploadTile({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label?: string }) {
    const { t } = useTranslation();
    const text = label ?? t("home.upload.reference");
    return <button type="button" className="home-upload-tile" onClick={onClick} disabled={disabled} aria-label={text} title={text}>
        <span className="home-upload-tile-card is-back" aria-hidden />
        <span className="home-upload-tile-card is-front" aria-hidden><Plus /></span>
    </button>;
}

/** 发送按钮：与即梦一致的实心圆 + 上箭头。可发送时取主题反色（暗色白底、亮色黑底），悬停时箭头上浮。 */
export function HomeSendOrb({ disabled, busy, onClick, label, cost }: { disabled: boolean; busy: boolean; onClick?: () => void; label: string; cost?: ReactNode }) {
    const reducedMotion = useReducedMotion();
    return <div className="home-send-wrap">
        <AnimatePresence initial={false}>{cost ? <motion.span key="cost" className="home-send-cost" initial={reducedMotion ? false : { opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}>{cost}</motion.span> : null}</AnimatePresence>
        <button type="button" className={`home-send-orb${busy ? " is-busy" : ""}${disabled ? "" : " is-ready"}`} disabled={disabled} onClick={onClick} aria-label={label} title={label}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
        </button>
    </div>;
}
