import type { ClipSubtitle } from "@/services/api/video-edit";

const minCaptionMs = 100;
const historyLimit = 100;
const captionSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const captionGraphemes = (text: string) => Array.from(captionSegmenter.segment(text), ({ segment }) => segment);
const copyCaptions = (captions: ClipSubtitle[]) => captions.map((caption) => ({ ...caption }));

/** Insert into unused time only; an empty line stays a draft until the user fills it. */
export function insertClipSubtitle(captions: ClipSubtitle[], durationMs: number): { transcript: ClipSubtitle[]; index: number } | null {
    if (!Number.isFinite(durationMs) || durationMs < minCaptionMs || captions.length >= 1000) return null;
    let startMs = 0;
    for (let index = 0; index <= captions.length; index++) {
        const next = captions[index];
        const gapEnd = Math.min(durationMs, next?.startMs ?? durationMs);
        if (gapEnd - startMs >= minCaptionMs) {
            const caption = { startMs, endMs: Math.min(gapEnd, startMs + 2000), text: "" };
            return { transcript: [...captions.slice(0, index), caption, ...captions.slice(index)], index };
        }
        if (next && Number.isFinite(next.endMs)) startMs = Math.max(startMs, next.endMs);
    }
    return null;
}

/** Cursor offsets use UTF-16; splitting and timing keep whole displayed characters. */
export function canSplitClipSubtitle(captions: ClipSubtitle[], index: number): boolean {
    const caption = captions[index];
    return Boolean(
        caption && captions.length < 1000 && Number.isFinite(caption.startMs) && Number.isFinite(caption.endMs) && caption.endMs - caption.startMs >= minCaptionMs * 2 && captionGraphemes(caption.text).filter((char) => char.trim() !== "").length >= 2,
    );
}

export function splitClipSubtitle(captions: ClipSubtitle[], index: number, cursorOffset?: number): ClipSubtitle[] | null {
    const caption = captions[index];
    if (!canSplitClipSubtitle(captions, index)) return null;
    const chars = captionGraphemes(caption.text);
    const firstContent = chars.findIndex((char) => char.trim() !== "");
    const lastContent = chars.findLastIndex((char) => char.trim() !== "");
    const valid = (at: number) => at > firstContent && at <= lastContent;
    let splitAt = 0;
    if (cursorOffset !== undefined && Number.isFinite(cursorOffset)) {
        let units = 0;
        for (let i = 0; i < chars.length; i++) {
            units += chars[i].length;
            if (units <= cursorOffset) splitAt = i + 1;
        }
    }
    if (!valid(splitAt)) {
        const middle = chars.length / 2;
        const candidates = chars.map((_, i) => i + 1).filter(valid);
        candidates.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
        splitAt = candidates.find((at) => /[，。！？；：,.!?;:\s]/u.test(chars[at - 1])) ?? candidates[0] ?? 0;
    }
    if (!valid(splitAt)) return null;
    const splitMs = Math.max(caption.startMs + minCaptionMs, Math.min(caption.endMs - minCaptionMs, caption.startMs + Math.round(((caption.endMs - caption.startMs) * splitAt) / chars.length)));
    return [...captions.slice(0, index), { ...caption, text: chars.slice(0, splitAt).join(""), endMs: splitMs }, { ...caption, text: chars.slice(splitAt).join(""), startMs: splitMs }, ...captions.slice(index + 1)];
}

export type CaptionHistory = { past: ClipSubtitle[][]; future: ClipSubtitle[][]; editKey?: string };
export const emptyCaptionHistory = (): CaptionHistory => ({ past: [], future: [] });

export function recordCaptionEdit(history: CaptionHistory, current: ClipSubtitle[], next: ClipSubtitle[], editKey?: string): CaptionHistory {
    if (JSON.stringify(current) === JSON.stringify(next)) return history;
    const merge = editKey !== undefined && editKey === history.editKey && history.past.length > 0;
    return { past: merge ? history.past : [...history.past, copyCaptions(current)].slice(-historyLimit), future: [], editKey };
}

export function moveCaptionHistory(history: CaptionHistory, current: ClipSubtitle[], direction: "undo" | "redo"): { history: CaptionHistory; transcript: ClipSubtitle[] } | null {
    if (direction === "undo") {
        const previous = history.past.at(-1);
        return previous ? { transcript: copyCaptions(previous), history: { past: history.past.slice(0, -1), future: [copyCaptions(current), ...history.future].slice(0, historyLimit) } } : null;
    }
    const next = history.future[0];
    return next ? { transcript: copyCaptions(next), history: { past: [...history.past, copyCaptions(current)].slice(-historyLimit), future: history.future.slice(1) } } : null;
}
