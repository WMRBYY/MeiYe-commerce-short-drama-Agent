import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, LoaderCircle, LockKeyhole, X } from "lucide-react";

import { TemplateAuthorAvatar } from "@/components/canvas-template/template-author-avatar";
import { TemplateCanvasViewer } from "@/components/canvas-template/template-canvas-viewer";
import { getPublicCanvasTemplateCanvas, type CanvasTemplate, type CanvasTemplateProject } from "@/services/api/canvas-templates";

// 同一次浏览中反复打开创作过程时不重复下载画布。
const projectCache = new Map<string, CanvasTemplateProject>();
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * 「查看创作过程」全屏层：从左下角以圆形遮罩展开，内容同时从左下角放大归位。
 * 不使用 role="dialog"：画布视口会忽略对话框内的滚轮缩放。
 */
export function CreationProcessOverlay({ template, onClose }: { template: CanvasTemplate; onClose: () => void }) {
    const [project, setProject] = useState<CanvasTemplateProject | null>(() => projectCache.get(template.id) || null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (projectCache.has(template.id)) return;
        const controller = new AbortController();
        getPublicCanvasTemplateCanvas(template.id, controller.signal)
            .then(({ project: next }) => {
                projectCache.set(template.id, next);
                setProject(next);
            })
            .catch((reason) => {
                if (!controller.signal.aborted) setError(reason instanceof Error && reason.message ? reason.message : "创作画布加载失败");
            });
        return () => controller.abort();
    }, [template.id]);

    return (
        <motion.section
            aria-label={`${template.title} 完整媒体发布画布`}
            className="fixed inset-0 z-30 overflow-hidden bg-[#101010] text-white"
            initial={{ clipPath: "circle(0% at 0% 100%)", opacity: 0.5 }}
            animate={{ clipPath: "circle(150% at 0% 100%)", opacity: 1 }}
            exit={{ clipPath: "circle(0% at 0% 100%)", opacity: 0.6 }}
            transition={{ duration: 0.7, ease: EASE }}
            onClick={(event) => event.stopPropagation()}
        >
            <motion.div
                className="flex size-full flex-col"
                style={{ transformOrigin: "0% 100%" }}
                initial={{ scale: 0.9, x: -32, y: 32 }}
                animate={{ scale: 1, x: 0, y: 0 }}
                exit={{ scale: 0.94, x: -20, y: 20 }}
                transition={{ duration: 0.7, ease: EASE }}
            >
                <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[#1c1c1c] px-4">
                    <motion.div className="flex min-w-0 items-center gap-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.4, ease: EASE }}>
                        <strong className="truncate text-sm font-semibold">{template.title}</strong>
                        <span className="shrink-0 text-sm text-white/75">完整媒体发布画布</span>
                        <span className="ml-2 hidden min-w-0 items-center gap-1.5 truncate text-xs text-white/45 md:inline-flex">
                            <TemplateAuthorAvatar name={template.author.displayName} url={template.author.avatarUrl} size={18} />
                            {template.author.displayName}
                        </span>
                    </motion.div>
                    <motion.div className="ml-auto flex shrink-0 items-center gap-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4, ease: EASE }}>
                        <span className="hidden items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-xs text-white/55 sm:inline-flex">
                            <LockKeyhole className="size-3.5" />
                            当前为只读模式，仅供查看，不可创作
                        </span>
                        <button type="button" className="grid size-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="关闭创作过程（Esc）" title="关闭（Esc）" onClick={onClose}>
                            <X className="size-5" />
                        </button>
                    </motion.div>
                </header>
                <div className="relative min-h-0 flex-1">
                    {project ? (
                        project.nodes?.length ? (
                            <TemplateCanvasViewer project={project} />
                        ) : (
                            <div className="grid h-full place-items-center text-sm text-white/50">这个作品没有附带画布节点</div>
                        )
                    ) : (
                        <div className="grid h-full place-items-center">
                            {error ? (
                                <span className="inline-flex items-center gap-2 text-sm text-white/60">
                                    <AlertCircle className="size-4" />
                                    {error}
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-2 text-sm text-white/50">
                                    <LoaderCircle className="size-4 animate-spin" />
                                    正在打开创作画布…
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>
        </motion.section>
    );
}
