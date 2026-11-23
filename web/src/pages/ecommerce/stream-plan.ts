/**
 * Reads a planner reply while it is still streaming. The planner writes the
 * product analysis fields first and the `images` array last, so every image
 * object that has closed can be generated before the rest of the plan arrives.
 *
 * Returns the parsed header (everything before `images`) and each complete
 * image object in order. Nothing is returned when `images` is not reached yet
 * or the header is not valid JSON on its own.
 */
export type StreamingPlannerChunk = { header: Record<string, unknown>; images: unknown[] };

export function readStreamingPlannerText(text: string): StreamingPlannerChunk | null {
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let stringStart = -1;
    let lastKey = "";
    let lastKeyStart = -1;
    let imagesDepth = -1;
    let headerEnd = -1;
    let objectStart = -1;
    const images: unknown[] = [];
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') {
                inString = false;
                // A string directly inside the root object followed by ':' is a key.
                if (depth === 1 && imagesDepth < 0) {
                    const rest = text.slice(index + 1).trimStart();
                    if (rest.startsWith(":")) {
                        lastKey = text.slice(stringStart + 1, index);
                        lastKeyStart = stringStart;
                    }
                }
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            stringStart = index;
            continue;
        }
        if (char === "{" || char === "[") {
            depth += 1;
            if (char === "[" && depth === 2 && imagesDepth < 0 && lastKey === "images") {
                imagesDepth = depth;
                headerEnd = lastKeyStart;
            } else if (char === "{" && imagesDepth > 0 && depth === imagesDepth + 1) objectStart = index;
            continue;
        }
        if (char === "}" || char === "]") {
            if (char === "}" && imagesDepth > 0 && depth === imagesDepth + 1 && objectStart >= 0) {
                try {
                    images.push(JSON.parse(text.slice(objectStart, index + 1)));
                } catch {
                    return null;
                }
                objectStart = -1;
            }
            depth -= 1;
            if (imagesDepth > 0 && depth < imagesDepth) break;
        }
    }
    if (headerEnd < 0) return null;
    try {
        const header = JSON.parse(`${text.slice(start, headerEnd).replace(/,\s*$/, "")}}`) as unknown;
        if (!header || typeof header !== "object" || Array.isArray(header)) return null;
        return { header: header as Record<string, unknown>, images };
    } catch {
        return null;
    }
}

/**
 * Screens this page already sent to image generation while the plan was streaming, keyed by
 * screen index. Kept in localStorage so a reload merges them into the finished plan instead of
 * charging for the same screen twice.
 */
export type StreamedScreenReceipt = Record<string, { id: string; taskId: string }>;

const receiptKey = (scope: string, projectId: string, planningTaskId: string) => `ecommerce-stream:${scope}:${projectId}:${planningTaskId}`;

export function readStreamedScreens(scope: string, projectId: string, planningTaskId: string): StreamedScreenReceipt {
    try {
        const value = JSON.parse(localStorage.getItem(receiptKey(scope, projectId, planningTaskId)) || "{}") as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) return {};
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, { id: string; taskId: string }] => {
                const item = entry[1] as { id?: unknown; taskId?: unknown } | null;
                return Boolean(item && typeof item.id === "string" && item.id && typeof item.taskId === "string" && item.taskId);
            }),
        );
    } catch {
        return {};
    }
}

export function rememberStreamedScreen(scope: string, projectId: string, planningTaskId: string, index: number, entry: { id: string; taskId: string }) {
    try {
        const next = { ...readStreamedScreens(scope, projectId, planningTaskId), [String(index)]: entry };
        localStorage.setItem(receiptKey(scope, projectId, planningTaskId), JSON.stringify(next));
    } catch {
        /* The task still exists server-side; only reload de-duplication is lost. */
    }
}

export function forgetStreamedScreens(scope: string, projectId: string, planningTaskId: string) {
    try {
        localStorage.removeItem(receiptKey(scope, projectId, planningTaskId));
    } catch {
        /* Nothing to clean. */
    }
}
