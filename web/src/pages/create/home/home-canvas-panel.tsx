import { useRef, useState } from "react";
import { App } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { LoaderCircle, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { translate } from "@/i18n";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { getActiveUserScope } from "@/lib/user-scope";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { CreationRecentCanvases } from "../creation-recent-canvases";
import { HomeSendOrb } from "./home-composer-tools";

type CanvasSeed = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
type Template = { key: string; title: string; image: string; video?: string; build: () => CanvasSeed };

const link = (from: CanvasNodeData, to: CanvasNodeData): CanvasConnection => ({ id: `edge-${from.id}-${to.id}`, fromNodeId: from.id, toNodeId: to.id });

/** 视频创作模板：剧本文本 → 关键帧图片 → 视频镜头，三个节点按生成顺序串联。 */
function videoTemplate(): CanvasSeed {
    const script = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 }, { content: "【镜头 1】黄昏的海边网球场，少女坐在长椅上翻阅报纸，海风吹动纸页。\n景别：中景，缓慢推近。\n情绪：安静、怀旧。" });
    const frame = createCanvasNode(CanvasNodeType.Image, { x: 460, y: 0 }, { prompt: "黄昏海边网球场，少女坐在长椅上读报纸，胶片质感，暖色逆光，电影感构图" });
    const shot = createCanvasNode(CanvasNodeType.Video, { x: 920, y: 0 }, { prompt: "镜头缓慢推近，海风吹动报纸与发丝，夕阳光斑闪烁" });
    return { nodes: [script, frame, shot], connections: [link(script, frame), link(frame, shot)] };
}

/** 图像创作模板：一段创意描述分发到两张不同风格的图片节点，方便对比出图。 */
function imageTemplate(): CanvasSeed {
    const brief = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 120 }, { content: "创意：一只陶瓷质感的大象雕塑站在极简展台上，蓝色渐变背景，产品海报风格。" });
    const studio = createCanvasNode(CanvasNodeType.Image, { x: 460, y: 0 }, { prompt: "陶瓷大象雕塑，极简展台，蓝色渐变背景，柔和棚拍光，产品海报" });
    const poster = createCanvasNode(CanvasNodeType.Image, { x: 460, y: 380 }, { prompt: "陶瓷大象雕塑，杂志封面排版，留白，高级感海报设计" });
    return { nodes: [brief, studio, poster], connections: [link(brief, studio), link(brief, poster)] };
}

const TEMPLATES: Template[] = [
    { key: "video", get title() { return translate("home.canvasPanel.videoTemplate"); }, image: "/login-showcase/video.webp", video: "/login-showcase/video.mp4", build: videoTemplate },
    { key: "image", get title() { return translate("home.canvasPanel.imageTemplate"); }, image: "/login-showcase/product.webp", build: imageTemplate },
];

export function HomeCanvasPanel({ onRequireLogin }: { onRequireLogin: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const reducedMotion = useReducedMotion();
    const userId = useUserStore((state) => state.user?.id);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const [busyKey, setBusyKey] = useState("");
    const [prompt, setPrompt] = useState("");
    const lock = useRef(false);

    const createAndOpen = async (key: string, title: string, seed?: CanvasSeed, agent = false) => {
        if (!userId) { onRequireLogin(); return; }
        if (!canvasHydrated || lock.current) return;
        lock.current = true;
        setBusyKey(key);
        const scope = getActiveUserScope();
        try {
            const { id, syncError } = await createCanvasProjectWithRemoteSync(title, undefined, seed);
            await flushCanvasStorePersistence();
            if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== userId) return;
            if (syncError) message.warning(t("create.recent.syncPending"));
            navigate(`/canvas/${encodeURIComponent(id)}${agent ? "?agent=1" : ""}`);
        } catch (error) {
            if (getActiveUserScope() === scope) message.error(error instanceof Error ? error.message : t("create.recent.createFailed"));
        } finally {
            lock.current = false;
            setBusyKey("");
        }
    };
    const submitIdea = () => {
        const text = prompt.trim();
        if (!text) return;
        const note = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 }, { content: text });
        void createAndOpen("agent", text.slice(0, 24) || t("create.agentEntry.canvasTitle"), { nodes: [note], connections: [] }, true);
    };
    const disabled = Boolean(userId) && !canvasHydrated;

    return <motion.div className="home-canvas-panel" initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
        <div className="home-canvas-cards">
            <button type="button" className="home-canvas-new" disabled={disabled || Boolean(busyKey)} onClick={() => void createAndOpen("new", t("create.recent.untitledCanvas"))} onPointerEnter={() => void loadCanvasProjectPage()}>
                <CanvasNodesArt />
                <span className="home-canvas-new-icon">{busyKey === "new" ? <LoaderCircle className="animate-spin" /> : <Plus />}</span>
                <span className="home-canvas-new-label">{busyKey === "new" ? t("create.recent.creating") : t("home.canvasPanel.newCanvas")}</span>
            </button>
            {TEMPLATES.map((template) => <TemplateCard key={template.key} template={template} busy={busyKey === template.key} disabled={disabled || Boolean(busyKey)} onOpen={() => void createAndOpen(template.key, template.title, template.build())} />)}
        </div>
        <div className="home-canvas-prompt">
            <input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submitIdea(); } }} placeholder={t("home.canvasPanel.promptPlaceholder")} aria-label={t("home.canvasPanel.promptLabel")} disabled={busyKey === "agent"} />
            <HomeSendOrb disabled={!prompt.trim() || Boolean(busyKey)} busy={busyKey === "agent"} onClick={submitIdea} label={t("home.canvasPanel.submit")} />
        </div>
        <CreationRecentCanvases onRequireLogin={onRequireLogin} />
    </motion.div>;
}

function TemplateCard({ template, busy, disabled, onOpen }: { template: Template; busy: boolean; disabled: boolean; onOpen: () => void }) {
    const { t } = useTranslation();
    const video = useRef<HTMLVideoElement>(null);
    return <button type="button" className="home-canvas-template" disabled={disabled} onClick={onOpen}
        onMouseEnter={() => void video.current?.play().catch(() => undefined)}
        onMouseLeave={() => { if (video.current) { video.current.pause(); video.current.currentTime = 0; } }}>
        <img src={template.image} alt="" loading="lazy" />
        {template.video ? <video ref={video} src={template.video} muted loop playsInline preload="none" /> : null}
        <span className="home-canvas-template-shade" aria-hidden />
        <em className="home-canvas-template-tag">{t("home.canvasPanel.template")}</em>
        <strong>{busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}{template.title}</strong>
    </button>;
}

/** 新建画布卡片背景：节点 + 连接线。悬停时连线沿路径流动、节点依次浮起。 */
function CanvasNodesArt() {
    return <svg className="home-canvas-art" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <path className="home-canvas-wire" d="M92 62 C150 62 150 110 206 110" />
        <path className="home-canvas-wire is-b" d="M92 146 C150 146 150 110 206 110" />
        <path className="home-canvas-wire is-c" d="M266 110 C300 110 300 70 330 70" />
        <rect className="home-canvas-node is-1" x="32" y="44" width="60" height="36" rx="9" />
        <rect className="home-canvas-node is-2" x="32" y="128" width="60" height="36" rx="9" />
        <rect className="home-canvas-node is-3" x="206" y="88" width="60" height="44" rx="10" />
        <rect className="home-canvas-node is-4" x="330" y="52" width="48" height="36" rx="9" />
        <circle className="home-canvas-port" cx="92" cy="62" r="3" />
        <circle className="home-canvas-port" cx="92" cy="146" r="3" />
        <circle className="home-canvas-port" cx="206" cy="110" r="3" />
        <circle className="home-canvas-port" cx="266" cy="110" r="3" />
        <circle className="home-canvas-port" cx="330" cy="70" r="3" />
    </svg>;
}
