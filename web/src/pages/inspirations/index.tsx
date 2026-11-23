import { useEffect, useMemo, useRef, useState } from "react";

import type { CreationInspiration } from "@/lib/inspirations/catalog";
import { resolveInspirations } from "@/lib/inspirations/resolve";
import { loadVideoInspirationCatalog } from "@/services/inspiration-catalog";
import { useInspirationStore } from "@/stores/use-inspiration-store";
import { FeaturedWorks } from "./featured-works";

/** 视频作品进入可视区时才请求目录；本地隐藏和改写仍照常生效。 */
export function InspirationHall() {
    const sectionRef = useRef<HTMLElement>(null);
    const [shouldLoad, setShouldLoad] = useState(false);
    const [catalog, setCatalog] = useState<CreationInspiration[] | null>(null);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const custom = useInspirationStore((state) => state.custom);
    const overrides = useInspirationStore((state) => state.overrides);
    const hidden = useInspirationStore((state) => state.hidden);
    const hydrated = useInspirationStore((state) => state.hydrated);

    useEffect(() => {
        if (typeof IntersectionObserver === "undefined") {
            setShouldLoad(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) {
                    setShouldLoad(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "600px" },
        );
        if (sectionRef.current) observer.observe(sectionRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!shouldLoad) return;
        let cancelled = false;
        setError("");
        loadVideoInspirationCatalog()
            .then((items) => {
                if (!cancelled) setCatalog(items);
            })
            .catch((reason) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : "视频作品加载失败");
            });
        return () => {
            cancelled = true;
        };
    }, [shouldLoad, attempt]);

    const overlay = useMemo(() => ({ custom, overrides, hidden }), [custom, overrides, hidden]);
    const videos = useMemo(() => (catalog ? resolveInspirations(catalog, overlay).filter((item) => item.mode === "video" && Boolean(item.videoUrl)) : []), [catalog, overlay]);

    return (
        <section ref={sectionRef} className="inspiration-video-section" aria-label="创作精选视频">
            {error ? (
                <div role="alert" className="featured-works-status">
                    {error}{" "}
                    <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                        重试
                    </button>
                </div>
            ) : null}
            {!error && catalog && hydrated ? <FeaturedWorks entries={videos} /> : null}
            {!error && shouldLoad && (!catalog || !hydrated) ? (
                <div className="featured-works-status" role="status">
                    正在加载视频作品…
                </div>
            ) : null}
        </section>
    );
}

export default InspirationHall;
