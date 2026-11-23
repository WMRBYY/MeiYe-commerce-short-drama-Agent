export type APIMartMusicProtocol = "apimart-flowmusic" | "apimart-suno";

const fields: Record<APIMartMusicProtocol, readonly string[]> = {
    "apimart-flowmusic": ["version", "lyrics", "title", "bpm", "length", "seed"],
    "apimart-suno": ["custom", "instrumental", "version", "custom_model_id", "title", "style", "negative_tags", "auto_lyrics", "persona_id", "vocal_gender", "style_weight", "weirdness_constraint", "audio_weight", "variety", "max_mode", "audio_format", "duration"],
};

export function isAPIMartMusicProtocol(value: string | undefined): value is APIMartMusicProtocol {
    return value === "apimart-flowmusic" || value === "apimart-suno";
}

export function apimartMusicOptions(protocol: APIMartMusicProtocol, serialized: string | undefined): Record<string, string | number | boolean> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized || "{}");
    } catch {
        return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const source = parsed as Record<string, unknown>;
    if (typeof source._protocol === "string" && source._protocol !== protocol) return {};
    const result: Record<string, string | number | boolean> = {};
    for (const field of fields[protocol]) {
        const value = source[field];
        if (typeof value === "string" && value.trim()) result[field] = value.trim();
        if (typeof value === "number" && Number.isFinite(value)) result[field] = value;
        if (typeof value === "boolean") result[field] = value;
    }
    return result;
}
