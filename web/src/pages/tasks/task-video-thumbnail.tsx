import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MediaPreview } from "@/components/media-preview";
import { hydrateCanvasVideoPreview } from "@/services/canvas-video-preview";

/** 优先复用服务器封面；缺失时保留浏览器抽帧并缓存封面。 */
export function TaskVideoThumbnail({ src }: { src: string }) {
    const { t } = useTranslation();
    const container = useRef<HTMLSpanElement>(null);
    const [poster, setPoster] = useState<{ source: string; url: string }>();
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = "";
        let started = false;
        const capture = () => {
            if (started || controller.signal.aborted) return;
            started = true;
            void hydrateCanvasVideoPreview({ id: "task-preview", metadata: { content: src } }, controller.signal, "thumbnail-small").then((result) => {
                if (!result) return;
                objectUrl = result.localUrl;
                if (controller.signal.aborted) {
                    if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
                    return;
                }
                setPoster({ source: src, url: objectUrl });
            }).catch((error) => {
                if (!controller.signal.aborted) console.warn("任务视频首帧提取失败", error instanceof Error ? error.name : "UnknownError");
            });
        };
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                observer.disconnect();
                capture();
            }
        });
        if (container.current) observer.observe(container.current);
        return () => {
            controller.abort();
            observer.disconnect();
            if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
        };
    }, [src]);
    return (
        <span ref={container} className="task-center-video-thumb">
            {poster?.source === src ? (
                <MediaPreview src={poster.url} kind="image" />
            ) : (
                <span className="task-center-video-placeholder">
                    <Video aria-hidden="true" />
                    <small>{t("library.tasks.row.videoPreview")}</small>
                </span>
            )}
        </span>
    );
}
