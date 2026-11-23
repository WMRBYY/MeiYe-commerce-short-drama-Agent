import { Input, InputNumber, Switch } from "antd";
import { Select } from "@/components/ui/base/select";
import { apimartMusicOptions, type APIMartMusicProtocol } from "@/lib/apimart-music-options";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";

type Props = { protocol: APIMartMusicProtocol; config: AiConfig; onConfigChange: (key: CanvasAudioSettingKey, value: string) => void; theme: CanvasTheme; showTitle: boolean; className: string };

export function APIMartMusicSettingsPanel({ protocol, config, onConfigChange, theme, showTitle, className }: Props) {
    const options = apimartMusicOptions(protocol, config.audioAdvancedOptions);
    const update = (field: string, value: string | number | boolean | undefined) => {
        const next: Record<string, string | number | boolean> = { ...options };
        if (value === undefined || value === "") delete next[field];
        else next[field] = value;
        if (field === "custom_model_id" && value) {
            delete next.version;
            delete next.persona_id;
        }
        if ((field === "version" || field === "persona_id") && value) delete next.custom_model_id;
        onConfigChange("audioAdvancedOptions", JSON.stringify({ _protocol: protocol, ...next }));
    };
    const textField = (field: string, label: string, hint?: string) => (
        <label className="flex flex-col gap-1 text-xs" key={field}>{label}
            <Input aria-label={label} value={String(options[field] ?? "")} placeholder={hint} onChange={(event) => update(field, event.target.value)} />
        </label>
    );
    const numberField = (field: string, label: string, min: number, max: number, step = 1) => (
        <label className="flex flex-col gap-1 text-xs" key={field}>{label}
            <InputNumber className="w-full" aria-label={label} min={min} max={max} step={step} value={typeof options[field] === "number" ? options[field] as number : null} onChange={(value) => update(field, value ?? undefined)} />
        </label>
    );
    const switchField = (field: string, label: string) => (
        <label className="flex items-center justify-between text-xs" key={field}>{label}
            <Switch aria-label={label} checked={options[field] === true} onChange={(value) => update(field, value)} />
        </label>
    );
    const selection = (field: string, label: string, values: Array<{ value: string; label: string }>) => (
        <label className="flex flex-col gap-1 text-xs" key={field}>{label}
            <Select className="w-full" ariaLabel={label} value={String(options[field] ?? "")} onChange={(value) => update(field, value)} options={values} />
        </label>
    );

    return (
        <section className={className} style={{ color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} aria-label="APIMart 音乐生成参数">
            {showTitle ? <h3 className="text-base font-semibold">音乐设置</h3> : null}
            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>提示词填写在节点正文；此处字段按 APIMart 原名提交。</p>
            {protocol === "apimart-flowmusic" ? <div className="space-y-3">
                {selection("version", "版本", [{ value: "", label: "Flow Music 默认" }, { value: "lyria-3.5", label: "Lyria 3.5" }])}
                {textField("title", "标题")}
                <label className="flex flex-col gap-1 text-xs">歌词 lyrics
                    <Input.TextArea aria-label="歌词 lyrics" rows={4} value={String(options.lyrics ?? "")} onChange={(event) => update("lyrics", event.target.value)} />
                </label>
                {textField("bpm", "节拍 bpm", "例如 120")}
                {numberField("length", "时长 length（秒）", 1, 240)}
                {textField("seed", "随机种子 seed")}
            </div> : <div className="space-y-3">
                {switchField("custom", "自定义模式 custom")}
                {switchField("instrumental", "纯音乐 instrumental")}
                {selection("version", "公共版本 version", [{ value: "", label: "v6（默认）" }, { value: "v6", label: "v6" }, { value: "v6-wild", label: "v6-wild" }, { value: "v6-mini", label: "v6-mini" }])}
                {textField("custom_model_id", "自定义模型 custom_model_id")}
                {textField("persona_id", "歌手 Persona ID")}
                {textField("title", "标题 title")}
                {textField("style", "风格 style")}
                {textField("negative_tags", "排除风格 negative_tags")}
                {selection("vocal_gender", "人声性别 vocal_gender", [{ value: "", label: "不指定" }, { value: "Male", label: "Male" }, { value: "Female", label: "Female" }])}
                {selection("variety", "风格变化 variety", [{ value: "", label: "不指定" }, ...["off", "normal", "high", "extra", "max"].map((value) => ({ value, label: value }))])}
                {selection("audio_format", "输出格式 audio_format", [{ value: "", label: "上游默认" }, ...["mp3", "m4a", "wav"].map((value) => ({ value, label: value.toUpperCase() }))])}
                {numberField("duration", "目标时长 duration（秒）", 10, 360)}
                {numberField("style_weight", "风格权重 style_weight", 0, 1, 0.05)}
                {numberField("weirdness_constraint", "创意度 weirdness_constraint", 0, 1, 0.05)}
                {numberField("audio_weight", "音频权重 audio_weight", 0, 1, 0.05)}
                {switchField("auto_lyrics", "歌词再创作 auto_lyrics")}
                {switchField("max_mode", "Max 模式 max_mode")}
            </div>}
        </section>
    );
}
