import { useEffect, useRef } from "react";
import { paintDetailJoin } from "@/pages/ecommerce/detail-seam";

// Use the images already loaded by the editor; the overlay occupies no layout
// space and leaves the original coordinate system intact for OCR and edits.
export function DetailJoinPreview({ above, below }: { above: string; below: string }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        const section = canvas?.parentElement;
        const a = section?.previousElementSibling?.querySelector("img");
        const b = section?.querySelector("img");
        if (!canvas || !a || !b) return;
        const paint = () => {
            canvas.hidden = true;
            if (!a.complete || !b.complete || !a.naturalWidth || !b.naturalWidth) return;
            try {
                canvas.hidden = !paintDetailJoin(canvas, a, b, Math.min(1200, Math.max(a.naturalWidth, b.naturalWidth)));
            } catch (error) {
                // A cross-origin resource without CORS can display, but cannot be sampled.
                if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
            }
        };
        paint();
        a.addEventListener("load", paint);
        b.addEventListener("load", paint);
        return () => { a.removeEventListener("load", paint); b.removeEventListener("load", paint); };
    }, [above, below]);
    return <canvas className="sdwb-join" aria-hidden="true" hidden ref={ref} />;
}
