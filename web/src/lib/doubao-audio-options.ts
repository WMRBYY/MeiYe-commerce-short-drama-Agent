export type DoubaoAudioOptions = {
    sample_rate: number;
    loudness_rate: number;
    pitch_rate: number;
    enable_subtitle: boolean;
    aigc_watermark: boolean;
    aigc_metadata: {
        enable: boolean;
        content_producer: string;
        produce_id: string;
        content_propagator: string;
        propagate_id: string;
    };
};

export const defaultDoubaoAudioOptions: DoubaoAudioOptions = {
    sample_rate: 24000,
    loudness_rate: 0,
    pitch_rate: 0,
    enable_subtitle: false,
    aigc_watermark: false,
    aigc_metadata: { enable: false, content_producer: "", produce_id: "", content_propagator: "", propagate_id: "" },
};

export function doubaoAudioOptions(value: string): DoubaoAudioOptions {
    let stored: Partial<DoubaoAudioOptions> = {};
    try {
        const parsed: unknown = JSON.parse(value || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Partial<DoubaoAudioOptions>;
    } catch { /* Invalid legacy preference falls back to official defaults. */ }
    const metadata = stored.aigc_metadata || {} as DoubaoAudioOptions["aigc_metadata"];
    const rate = Number(stored.sample_rate);
    const loudness = Number(stored.loudness_rate);
    const pitch = Number(stored.pitch_rate);
    return {
        sample_rate: [8000, 16000, 24000, 32000, 44100, 48000].includes(rate) ? rate : 24000,
        loudness_rate: Number.isInteger(loudness) && loudness >= -50 && loudness <= 100 ? loudness : 0,
        pitch_rate: Number.isInteger(pitch) && pitch >= -12 && pitch <= 12 ? pitch : 0,
        enable_subtitle: stored.enable_subtitle === true,
        aigc_watermark: stored.aigc_watermark === true,
        aigc_metadata: {
            enable: metadata.enable === true,
            content_producer: String(metadata.content_producer || ""),
            produce_id: String(metadata.produce_id || ""),
            content_propagator: String(metadata.content_propagator || ""),
            propagate_id: String(metadata.propagate_id || ""),
        },
    };
}
