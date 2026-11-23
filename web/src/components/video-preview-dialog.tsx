import { useRef } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { VideoPlayer } from "@/components/video-player";
import "./video-preview-dialog.css";

/** 作品预览统一在弹窗内播放，关闭时卸载播放器并停止声音。 */
export function VideoPreviewDialog({ open, src, title = "视频预览", onClose }: { open: boolean; src: string; title?: string; onClose: () => void }) {
    const stage = useRef<HTMLDivElement>(null);
    return (
        <AppModal
            open={open}
            onCancel={onClose}
            title={title}
            footer={null}
            centered
            width="min(1280px, calc(100vw - 32px))"
            className="video-preview-dialog"
            afterOpenChange={(visible) => {
                if (visible) stage.current?.focus();
            }}
        >
            {open ? (
                <div
                    ref={stage}
                    className="video-preview-stage"
                    tabIndex={-1}
                    onKeyDownCapture={(event) => {
                        if (event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey) return;
                        const target = event.target as HTMLElement;
                        if (target.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"], [role="button"]')) return;
                        const video = stage.current?.querySelector("video");
                        if (!video) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.repeat) return;
                        if (video.paused) void video.play().catch(() => undefined);
                        else video.pause();
                    }}
                >
                    <VideoPlayer key={src} src={src} title={title} autoPlay />
                </div>
            ) : null}
            <div className="video-preview-shortcuts">
                空格 播放 / 暂停<span>Esc 关闭</span>
            </div>
        </AppModal>
    );
}
