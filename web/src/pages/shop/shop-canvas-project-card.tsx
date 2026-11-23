import { useEffect, useRef, useState } from "react";
import { App, Dropdown, Tooltip } from "antd";
import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { AppModal } from "@/components/ui/product/app-modal";
import { resourceStorageKey, resourceVariantUrl } from "@/services/api/resources";
import { hydrateCanvasVideoPreview } from "@/services/canvas-video-preview";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { readShopCanvasProjects, saveShopCanvasProjects, SHOP_CANVAS_SNAPSHOT_SAVED, shopCanvasProjectLayerKey, type ShopCanvasProject } from "./shop-canvas-projects";
import { duplicateCanvasProject, readCanvasProjectCovers, saveCanvasCover } from "./shop-canvas-project-actions";
import type { ShopCanvasProjectCover } from "./shop-canvas-project-cover";

const coverKey = (cover: ShopCanvasProjectCover) => (cover.kind === "custom" ? cover.src : `${cover.kind}:${cover.resourceId}`);

/** The server may not have a video poster yet; reuse the same hydration as PassiveVideoPoster. */
function ProjectVideoCover({ resourceId, alt, onError }: { resourceId: string; alt: string; onError: () => void }) {
    const [src, setSrc] = useState("");
    const failure = useRef(onError);
    failure.current = onError;
    useEffect(() => {
        const controller = new AbortController();
        let localUrl = "";
        void hydrateCanvasVideoPreview({ id: "project-cover", metadata: { storageKey: resourceStorageKey(resourceId) } }, controller.signal, "thumbnail-small")
            .then((poster) => {
                if (!poster) {
                    if (!controller.signal.aborted) failure.current();
                    return;
                }
                localUrl = poster.localUrl;
                if (controller.signal.aborted) {
                    if (localUrl.startsWith("blob:")) URL.revokeObjectURL(localUrl);
                    return;
                }
                setSrc(localUrl);
            })
            .catch(() => {
                if (!controller.signal.aborted) failure.current();
            });
        return () => {
            controller.abort();
            if (localUrl.startsWith("blob:")) URL.revokeObjectURL(localUrl);
        };
    }, [resourceId]);
    return src ? <img src={src} alt={alt} decoding="async" onError={onError} /> : <ShopCanvasGlyph name="workflows" size={30} aria-hidden="true" />;
}

export function ShopCanvasProjectCard({ project, scope, userId, onOpen, onChange }: { project: ShopCanvasProject; scope: string; userId: string; onOpen: () => void; onChange: () => void }) {
    const { message } = App.useApp();
    const [covers, setCovers] = useState<ShopCanvasProjectCover[]>([]);
    const [failedCovers, setFailedCovers] = useState<string[]>([]);
    const thumbnail = useRef<HTMLSpanElement>(null);
    const cover = covers.find((candidate) => !failedCovers.includes(coverKey(candidate)));
    const [editing, setEditing] = useState<"rename" | "delete" | null>(null);
    const [name, setName] = useState(project.name);
    const [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const key = shopCanvasProjectLayerKey(userId, project.id);
        let revision = 0;
        let visible = false;
        setCovers([]);
        const refresh = async () => {
            const request = ++revision;
            const candidates = await readCanvasProjectCovers(scope, userId, project).catch(() => []);
            if (request !== revision) return;
            setCovers(candidates);
            setFailedCovers([]);
        };
        const observeSnapshot = (event: Event) => {
            const changed = (event as CustomEvent<{ key: string; scope: string }>).detail;
            if (visible && changed?.key === key && changed.scope === scope) void refresh();
        };
        const reveal = () => {
            visible = true;
            void refresh();
        };
        const observer =
            typeof IntersectionObserver === "undefined"
                ? null
                : new IntersectionObserver(
                      (entries) => {
                          if (!entries.some((entry) => entry.isIntersecting)) return;
                          observer?.disconnect();
                          reveal();
                      },
                      { rootMargin: "240px" },
                  );
        if (observer && thumbnail.current) observer.observe(thumbnail.current);
        else reveal();
        window.addEventListener(SHOP_CANVAS_SNAPSHOT_SAVED, observeSnapshot);
        return () => {
            revision++;
            observer?.disconnect();
            window.removeEventListener(SHOP_CANVAS_SNAPSHOT_SAVED, observeSnapshot);
        };
    }, [scope, userId, project.id, project.coverKey, project.updatedAt]);
    const run = async (action: () => Promise<void> | void) => {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            onChange();
            setEditing(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败，请检查浏览器存储空间后重试");
        } finally {
            setBusy(false);
        }
    };
    const update = (patch: Partial<ShopCanvasProject>) =>
        saveShopCanvasProjects(
            userId,
            readShopCanvasProjects(userId).map((item) => (item.id === project.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)),
        );
    const remove = async () => {
        // Retain an undo snapshot and the original nodes/resources; deleting a card never deletes media assets.
        await localForageStorageForScope(scope).setItem(`shop-canvas-removed:${project.id}`, JSON.stringify(project));
        saveShopCanvasProjects(
            userId,
            readShopCanvasProjects(userId).filter((item) => item.id !== project.id),
        );
        message.success({
            duration: 8,
            content: (
                <span>
                    项目已删除{" "}
                    <button
                        onClick={() => {
                            void run(() => {
                                const current = readShopCanvasProjects(userId);
                                if (!current.some((item) => item.id === project.id)) saveShopCanvasProjects(userId, [project, ...current]);
                            });
                        }}
                    >
                        撤销
                    </button>
                </span>
            ),
        });
    };
    return (
        <article className="sp-canvas-project-wrap" aria-label={`${project.name} 项目`}>
            <button type="button" className="sp-canvas-project" onClick={onOpen}>
                <span ref={thumbnail} className="sp-canvas-project-preview">
                    {cover?.kind === "video" ? (
                        <ProjectVideoCover key={`${scope}:${coverKey(cover)}`} resourceId={cover.resourceId} alt={`${project.name} 视频封面`} onError={() => setFailedCovers((failed) => [...failed, coverKey(cover)])} />
                    ) : cover ? (
                        <img
                            key={coverKey(cover)}
                            src={cover.kind === "custom" ? cover.src : resourceVariantUrl(cover.resourceId, "thumbnail-small")}
                            alt={`${project.name} 封面`}
                            decoding="async"
                            onError={() => setFailedCovers((failed) => [...failed, coverKey(cover)])}
                        />
                    ) : (
                        <ShopCanvasGlyph name="workflows" size={30} aria-hidden="true" />
                    )}
                </span>
                <strong>{project.name}</strong>
                <small>更新于 {new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
            </button>
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                    items: [
                        { key: "rename", label: "重命名", icon: <ShopCanvasGlyph name="edit" size={15} /> },
                        { key: "copy", label: "复制", icon: <ShopCanvasGlyph name="duplicate" size={15} /> },
                        { key: "cover", label: "更换封面", icon: <ShopCanvasGlyph name="insert-media" size={15} /> },
                        { type: "divider" },
                        { key: "delete", label: "删除", danger: true, icon: <ShopCanvasGlyph name="delete" size={15} /> },
                    ],
                    onClick: ({ key }) => {
                        if (key === "copy")
                            void run(async () => {
                                await duplicateCanvasProject(scope, userId, project);
                                message.success("已复制项目，可独立编辑");
                            });
                        else if (key === "cover") input.current?.click();
                        else {
                            setName(project.name);
                            setEditing(key as "rename" | "delete");
                        }
                    },
                }}
            >
                <Tooltip title="项目操作">
                    <button className="sp-project-more" aria-label={`${project.name} 操作菜单`} disabled={busy}>
                        <ShopCanvasGlyph name="more" size={19} />
                    </button>
                </Tooltip>
            </Dropdown>
            <input
                ref={input}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                aria-label={`${project.name} 封面文件`}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file)
                        void run(async () => {
                            const coverKey = await saveCanvasCover(scope, file);
                            update({ coverKey });
                            message.success("封面已更新");
                        });
                }}
            />
            <AppModal open={Boolean(editing)} onCancel={() => !busy && setEditing(null)} title={editing === "delete" ? "删除项目" : "重命名项目"} footer={null} destroyOnHidden>
                <form
                    className="sp-canvas-create-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void run(
                            editing === "delete"
                                ? remove
                                : () => {
                                      if (!name.trim()) throw new Error("请输入项目名称");
                                      update({ name: name.trim() });
                                  },
                        );
                    }}
                >
                    {editing === "delete" ? (
                        <p>删除「{project.name}」？项目将从本机列表移除，素材库中的图片和视频会保留。</p>
                    ) : (
                        <>
                            <label htmlFor={`name-${project.id}`}>项目名称</label>
                            <input id={`name-${project.id}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus />
                        </>
                    )}
                    <div>
                        <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                            取消
                        </button>
                        <button type="submit" disabled={busy}>
                            {busy ? "处理中…" : editing === "delete" ? "删除项目" : "保存"}
                        </button>
                    </div>
                </form>
            </AppModal>
        </article>
    );
}
