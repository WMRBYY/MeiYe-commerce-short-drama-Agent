import { type RefObject, useEffect, useState } from "react";
import { observeCanvasMediaVisibility } from "@/lib/canvas/canvas-media-visibility";

/** One-way visibility gate shared by canvas media; panning away does not unload an already visible image. */
export function useNearViewport(ref: RefObject<Element | null>) {
    const [nearViewport, setNearViewport] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        return observeCanvasMediaVisibility(element, () => setNearViewport(true));
    }, [ref]);
    return nearViewport;
}
