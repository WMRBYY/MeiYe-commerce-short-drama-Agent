import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { SkillVisualCover, skillVisualTagline } from "@/components/skills/skill-visual-cover";
import { listSkills, type Skill } from "@/services/api/skills";

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CHIP_LIMIT = 7;

type ChipSkill = Skill & { badge?: "new" | "hot" };

/** 输入框下方的技能快捷条：热门 + 新上架技能，悬停展示封面视频与简介，点击直接作为技能引用写入输入框。 */
export function HomeSkillChips({ userId, onApply }: { userId: string | null; onApply: (skill: Skill) => void }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const reducedMotion = useReducedMotion();
    const [skills, setSkills] = useState<ChipSkill[]>([]);
    const [hover, setHover] = useState<{ skill: ChipSkill; rect: DOMRect } | null>(null);
    const hideTimer = useRef<number | undefined>(undefined);
    const showTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            listSkills({ scope: "public", sort: "popular", pageSize: 12 }),
            listSkills({ scope: "public", sort: "new", pageSize: 6 }),
        ]).then(([popular, latest]) => {
            if (cancelled) return;
            const now = Date.now();
            const fresh = latest.skills.filter((skill) => now - Date.parse(skill.createdAt || "") < NEW_WINDOW_MS).slice(0, 3);
            const freshIds = new Set(fresh.map((skill) => skill.skillId));
            const hot = popular.skills.filter((skill) => !freshIds.has(skill.skillId));
            const merged: ChipSkill[] = [
                ...fresh.map((skill) => ({ ...skill, badge: "new" as const })),
                ...hot.map((skill, index) => ({ ...skill, badge: index < 2 ? "hot" as const : undefined })),
            ];
            setSkills(merged.slice(0, CHIP_LIMIT));
        }).catch(() => { if (!cancelled) setSkills([]); });
        return () => { cancelled = true; };
    }, [userId]);

    useEffect(() => () => { window.clearTimeout(hideTimer.current); window.clearTimeout(showTimer.current); }, []);

    const openPreview = (skill: ChipSkill, element: HTMLElement) => {
        window.clearTimeout(hideTimer.current);
        window.clearTimeout(showTimer.current);
        const rect = element.getBoundingClientRect();
        showTimer.current = window.setTimeout(() => setHover({ skill, rect }), hover ? 0 : 160);
    };
    const closePreview = () => {
        window.clearTimeout(showTimer.current);
        hideTimer.current = window.setTimeout(() => setHover(null), 140);
    };

    const previewStyle = useMemo(() => {
        if (!hover) return undefined;
        const width = 300;
        const left = Math.min(Math.max(12, hover.rect.left + hover.rect.width / 2 - width / 2), window.innerWidth - width - 12);
        return { left, top: hover.rect.bottom + 10, width };
    }, [hover]);

    if (!skills.length) return null;
    return <div className="home-skill-chips" aria-label={t("home.skills.recommended")}>
        {skills.map((skill, index) => <motion.button
            key={skill.skillId}
            type="button"
            className="home-skill-chip"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reducedMotion ? 0 : 0.05 * index, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onMouseEnter={(event) => openPreview(skill, event.currentTarget)}
            onMouseLeave={closePreview}
            onFocus={(event) => openPreview(skill, event.currentTarget)}
            onBlur={closePreview}
            onClick={() => onApply(skill)}
        >
            <span className="home-skill-chip-slash">/</span>
            <span className="home-skill-chip-name">{skill.skillName}</span>
            {skill.badge ? <em className={`home-skill-badge is-${skill.badge}`}>{skill.badge === "new" ? "New" : "Hot"}</em> : null}
        </motion.button>)}
        <button type="button" className="home-skill-chip is-more" onClick={() => navigate("/skills")}>{t("home.skills.more")}<ChevronRight aria-hidden /></button>
        {createPortal(<AnimatePresence>
            {hover && previewStyle ? <motion.div
                key={hover.skill.skillId}
                className="home-skill-preview"
                style={previewStyle}
                initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                onMouseEnter={() => window.clearTimeout(hideTimer.current)}
                onMouseLeave={closePreview}
            >
                <SkillPreviewMedia skill={hover.skill} />
                <div className="home-skill-preview-body">
                    <strong>{hover.skill.skillName}</strong>
                    <p>{skillVisualTagline(hover.skill) || hover.skill.description || t("home.skills.noDescription")}</p>
                    <button type="button" onClick={() => { setHover(null); navigate(`/skills?skill=${encodeURIComponent(hover.skill.skillId)}`); }}>{t("home.skills.details")}<ChevronRight aria-hidden /></button>
                </div>
            </motion.div> : null}
        </AnimatePresence>, document.body)}
    </div>;
}

type SkillPreviewAsset = { video?: string; image?: string; poster?: string };
type PreviewCandidate = { kind: "video"; src: string; poster?: string } | { kind: "image"; src: string };

/** 只接受同源路径（排除 // 与 /\ 开头的跨域写法）或 https 地址，避免配置错误把任意协议注入到 img/video。 */
function previewUrl(value: unknown) {
    const url = typeof value === "string" ? value.trim().slice(0, 2000) : "";
    return /^\/(?![/\\])/.test(url) || url.startsWith("https://") ? url : "";
}

let previewManifest: Promise<Record<string, SkillPreviewAsset>> | undefined;
let loadedPreviews: Record<string, SkillPreviewAsset> | undefined;

/**
 * 技能悬停预览素材：public/skill-previews.json，形如
 * { "version": 1, "items": { "<skillId>": { "video"?: "/…", "image"?: "/…", "poster"?: "/…" } } }。
 * 整个页面只请求一次；文件不存在或格式不对时按没有预览处理。
 */
function loadSkillPreviews() {
    previewManifest ??= fetch("/skill-previews.json", { cache: "no-cache" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: unknown) => {
            const items = data && typeof data === "object" ? (data as { items?: unknown }).items : undefined;
            const result: Record<string, SkillPreviewAsset> = {};
            if (items && typeof items === "object") for (const [id, entry] of Object.entries(items as Record<string, unknown>)) {
                if (!entry || typeof entry !== "object") continue;
                const item = entry as Record<string, unknown>;
                const asset = { video: previewUrl(item.video) || undefined, image: previewUrl(item.image) || undefined, poster: previewUrl(item.poster) || undefined };
                if (asset.video || asset.image) result[id] = asset;
            }
            return result;
        })
        .catch(() => ({}))
        .then((result) => { loadedPreviews = result; return result; });
    return previewManifest;
}

/** 依次尝试：静态预览视频 → 技能自带展示视频 → 静态预览图；都失败时只剩底层的技能封面。 */
function previewCandidates(skill: Skill, asset?: SkillPreviewAsset): PreviewCandidate[] {
    const poster = asset?.poster || asset?.image;
    const showcase = skill.showcaseMedia?.find((media) => media.type === "video" && media.showcaseUrl)?.showcaseUrl;
    const list: PreviewCandidate[] = [];
    if (asset?.video) list.push({ kind: "video", src: asset.video, poster });
    if (showcase && showcase !== asset?.video) list.push({ kind: "video", src: showcase, poster });
    if (asset?.image) list.push({ kind: "image", src: asset.image });
    return list;
}

/**
 * 预览卡媒体区：技能封面始终垫在最底层，视频或图片加载出首帧后淡入覆盖，任何一项加载失败就换下一项，
 * 预览区不会出现空白。卡片打开时自动静音循环播放，关闭（退场动画开始）时暂停并回到开头。
 */
function SkillPreviewMedia({ skill }: { skill: Skill }) {
    const isPresent = useIsPresent();
    const reducedMotion = useReducedMotion();
    const video = useRef<HTMLVideoElement>(null);
    const [previews, setPreviews] = useState(loadedPreviews);
    const [attempt, setAttempt] = useState({ key: "", index: 0, ready: false });
    useEffect(() => {
        let alive = true;
        void loadSkillPreviews().then((value) => { if (alive) setPreviews(value); });
        return () => { alive = false; };
    }, []);
    const candidates = useMemo(() => previewCandidates(skill, previews?.[skill.skillId]), [skill, previews]);
    const key = `${skill.skillId}:${candidates.map((item) => item.src).join("|")}`;
    const state = attempt.key === key ? attempt : { key, index: 0, ready: false };
    const current = candidates[state.index];
    const advance = () => setAttempt({ key, index: state.index + 1, ready: false });
    const ready = () => setAttempt({ key, index: state.index, ready: true });
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        if (isPresent && !reducedMotion) void element.play().catch(() => undefined);
        else { element.pause(); element.currentTime = 0; }
    }, [isPresent, reducedMotion, current?.src]);
    return <div className="home-skill-preview-media">
        <SkillVisualCover skill={skill} priority />
        {current?.kind === "video" ? <video key={current.src} ref={video} className={`home-skill-preview-layer${state.ready ? " is-ready" : ""}`} src={current.src} poster={current.poster} muted loop playsInline autoPlay={!reducedMotion} preload="auto" aria-hidden="true" onLoadedData={ready} onError={advance} />
            : current?.kind === "image" ? <img key={current.src} className={`home-skill-preview-layer${state.ready ? " is-ready" : ""}`} src={current.src} alt="" decoding="async" onLoad={ready} onError={advance} /> : null}
    </div>;
}
