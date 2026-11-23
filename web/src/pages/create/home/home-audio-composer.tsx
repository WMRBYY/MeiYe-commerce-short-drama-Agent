import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Download, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { translate } from "@/i18n";
import { ModelPicker } from "@/components/model-picker";
import { isAPIMartMusicProtocol } from "@/lib/apimart-music-options";
import { generationErrorMessage } from "@/lib/generation-error";
import { resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { cheerYoru } from "@/lib/yoru-events";
import { HomeSendOrb } from "./home-composer-tools";

type AudioResult = { id: string; prompt: string; status: "pending" | "done" | "error"; url?: string; error?: string; model: string };

const PLACEHOLDER = {
    get music() { return translate("home.audio.music.placeholder"); },
    get audio() { return translate("home.audio.speech.placeholder"); },
};

/** 首页的音乐 / 音频生成：复用后端统一生成任务（计费、任务记录与画布音频节点一致），结果直接在下方试听与下载。 */
export function HomeAudioComposer({ kind, config, modeMenu, trailingControls, userId, onRequireLogin, onConfigChange }: {
    kind: "music" | "audio";
    config: AiConfig;
    modeMenu: ReactNode;
    trailingControls?: ReactNode;
    userId: string | null;
    onRequireLogin: () => boolean;
    onConfigChange: (key: CanvasAudioSettingKey | "audioModel", value: string) => void;
}) {
    const { t } = useTranslation();
    const copy = kind === "music" ? "home.audio.music" : "home.audio.speech";
    const reducedMotion = useReducedMotion();
    const [prompt, setPrompt] = useState("");
    const [results, setResults] = useState<AudioResult[]>([]);
    const aborts = useRef(new Map<string, AbortController>());
    const isMusicModel = useMemo(() => (model: string) => isAPIMartMusicProtocol(resolveModelRequestConfig(config, model).interfaceType), [config]);
    const modelFilter = useMemo(() => (model: string) => kind === "music" ? isMusicModel(model) : !isMusicModel(model), [isMusicModel, kind]);
    const models = useMemo(() => selectableModelsByCapability(config, "audio").filter(modelFilter), [config, modelFilter]);
    const model = models.includes(config.audioModel) ? config.audioModel : models[0] || "";
    const runConfig = useMemo<AiConfig>(() => ({ ...config, model, audioModel: model }), [config, model]);
    const pending = results.some((item) => item.status === "pending");

    useEffect(() => () => { aborts.current.forEach((controller) => controller.abort()); }, []);

    const submit = async () => {
        const text = prompt.trim();
        if (!text || !onRequireLogin()) return;
        if (!model) return;
        const id = `audio-${Date.now()}`;
        const controller = new AbortController();
        aborts.current.set(id, controller);
        cheerYoru();
        const entry: AudioResult = { id, prompt: text, status: "pending", model };
        setResults((current) => [entry, ...current].slice(0, 6));
        setPrompt("");
        try {
            const { runBackendGenerationTask } = await import("@/services/api/generation-task");
            const result = await runBackendGenerationTask({ mode: "audio", prompt: text, config: runConfig, signal: controller.signal, metadata: { source: "create-page", homeMode: kind } });
            const url = result.audio?.dataUrl || result.audios?.[0]?.dataUrl;
            if (!url) throw new Error(t("home.audio.noPlayableAudio"));
            setResults((current) => current.map((item) => item.id === id ? { ...item, status: "done", url } : item));
        } catch (error) {
            if (controller.signal.aborted) return;
            setResults((current) => current.map((item) => item.id === id ? { ...item, status: "error", error: generationErrorMessage(error) } : item));
        } finally {
            aborts.current.delete(id);
        }
    };
    const cancel = (id: string) => {
        aborts.current.get(id)?.abort();
        setResults((current) => current.filter((item) => item.id !== id));
    };

    return <div className="home-audio-composer">
        <div className="creation-composer-shell is-home home-audio-shell">
            <div className="creation-chat-composer is-empty">
                <div className="creation-chat-writing-surface is-home">
                    <textarea className="home-audio-textarea creation-scrollbar" value={prompt} placeholder={PLACEHOLDER[kind]} aria-label={t(`${copy}.label`)} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
                </div>
                <footer className="creation-chat-dock">
                    <div className="creation-chat-controls">
                        {modeMenu}
                        <ModelPicker config={config} value={model} onChange={(value) => onConfigChange("audioModel", value)} capability="audio" modelFilter={modelFilter} className="creation-model-picker" placeholder={t(`${copy}.selectModel`)} showSelectedPrice={false} showOptionPrices variant="creation" />
                        {model ? <CanvasAudioSettingsPopover config={runConfig} onConfigChange={onConfigChange} buttonClassName="creation-chat-control" placement="top" /> : null}
                        {trailingControls}
                    </div>
                    <HomeSendOrb disabled={!prompt.trim() || !model} busy={false} onClick={() => void submit()} label={!model ? t(`${copy}.modelMissing`) : t(`${copy}.generate`)} />
                </footer>
            </div>
        </div>
        {!model && userId ? <p className="home-audio-hint"><AlertCircle aria-hidden />{t(`${copy}.noModel`)}</p> : null}
        <AnimatePresence initial={false}>
            {results.length ? <motion.ul className="home-audio-results" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {results.map((item) => <motion.li key={item.id} layout={!reducedMotion} className={`home-audio-result is-${item.status}`} initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                    <div className="home-audio-result-head">
                        <strong title={item.prompt}>{item.prompt}</strong>
                        {item.status === "pending" ? <button type="button" aria-label={t("common.cancel")} onClick={() => cancel(item.id)}><X /></button> : null}
                        {item.status === "done" && item.url ? <a href={item.url} download aria-label={t("home.audio.download")}><Download /></a> : null}
                    </div>
                    {item.status === "pending" ? <div className="home-audio-wave" aria-label={t("home.audio.generating")}><LoaderCircle className="animate-spin" aria-hidden />{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 60}ms` }} />)}</div>
                        : item.status === "done" && item.url ? <audio src={item.url} controls preload="metadata" />
                        : <p className="home-audio-error" role="alert">{item.error}</p>}
                </motion.li>)}
            </motion.ul> : null}
        </AnimatePresence>
        {pending ? <p className="home-audio-note">{t("home.audio.keepOpen")}</p> : null}
    </div>;
}
