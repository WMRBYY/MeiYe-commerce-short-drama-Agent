import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { App, Button } from "antd";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Check, CheckSquare, Download, Filter, LoaderCircle, Play, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { VideoPreviewDialog } from "@/components/video-preview-dialog";
import { PassiveVideoPoster } from "@/components/passive-video-poster";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";

import type { EcommercePlanImage } from "@/services/api/ecommerce";
import { resourceFileUrl, resourceIdFromStorageKey, resourceVariantUrl } from "@/services/api/resources";
import { deleteAssetsWithRemoteSync, loadAssetLibraryPage } from "@/services/user-data-sync";
import type { Asset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { startEcommerceDownload } from "@/pages/ecommerce/export";
import { useTryOn } from "@/pages/ecommerce/tryon/use-tryon";

import { ShopBoard } from "./shop-board";
import { SHOP_MARKET, useShopFunction, useShopScope } from "./shop-context";
import { ShopDropdown } from "./shop-dropdown";
import { useShopImageActions } from "./shop-image";
import { favoriteWithNotice, useShopEdits, useShopFavorites } from "./shop-edits";
import { groupByDay, useShopItems, type ShopItem } from "./shop-items";
import { collectShopWorkIds, deleteShopWorkIds } from "./shop-works-actions";

type Tab = "all" | "image" | "video";
const TABS: Array<[Tab, string]> = [
    ["all", "全部"],
    ["image", "图片"],
    ["video", "视频"],
];
const PAGE_SIZE = 60;

type Work = { id: string; kind: "image" | "video"; createdAt: string; resourceId: string; cover: string; url: string; label: string; duration?: number; item?: ShopItem };

function durationText(ms?: number) {
    if (!ms) return "";
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function toWork(asset: Asset, byResource: Map<string, ShopItem>): Work | null {
    if (asset.kind !== "image" && asset.kind !== "video") return null;
    const resourceId = resourceIdFromStorageKey(asset.data.storageKey) || "";
    const item = resourceId ? byResource.get(resourceId) : undefined;
    if (asset.kind === "image") {
        const cover = resourceId ? resourceVariantUrl(resourceId, "thumbnail") : asset.coverUrl || asset.data.dataUrl;
        return { id: asset.id, kind: "image", createdAt: asset.createdAt, resourceId, cover, url: resourceId ? resourceFileUrl(resourceId) : asset.data.dataUrl, label: item?.label || "图片", item };
    }
    return { id: asset.id, kind: "video", createdAt: asset.createdAt, resourceId, cover: asset.coverUrl, url: resourceId ? resourceFileUrl(resourceId) : asset.data.url, label: "视频", duration: asset.data.durationMs };
}

/** 作品：参考站「资产」版式——按天分组的方格，图片 / 视频切换、按功能筛选、仅看收藏、批量操作。点图片进对照台，点视频直接播放。 */
export default function ShopWorks() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const reduced = useReducedMotion();
    const scope = useShopScope();
    const { fn, mode, allowed, pick } = useShopFunction();
    const state = useTryOn({ scope, fn, market: SHOP_MARKET });
    const edits = useShopEdits(scope);
    const items = useShopItems(state, edits.records, edits.tasks);
    const favorites = useShopFavorites(scope);
    const { putImage } = useShopImageActions(state, mode, pick, allowed);
    const [tab, setTab] = useState<Tab>("all");
    const [label, setLabel] = useState("all");
    const [favOnly, setFavOnly] = useState(false);
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<string[]>([]);
    const [board, setBoard] = useState<string | null>(null);
    const [video, setVideo] = useState<Work | null>(null);
    const [deletion, setDeletion] = useState<{ ids: string[]; all: boolean; scope: string } | null>(null);
    const [preparing, setPreparing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");
    const [deletedCount, setDeletedCount] = useState(0);
    const operation = useRef<AbortController | null>(null);
    const deletingRef = useRef(false);

    useEffect(() => {
        setPicked([]);
    }, [scope, tab, label, favOnly]);

    useEffect(() => {
        setDeletion(null);
        setPreparing(false);
        setDeleting(false);
        return () => operation.current?.abort();
    }, [scope]);

    const query = useInfiniteQuery({
        queryKey: ["shop-works", scope, tab],
        initialPageParam: 1,
        queryFn: ({ pageParam, signal }) => loadAssetLibraryPage({ page: pageParam, pageSize: PAGE_SIZE, status: "active", kind: tab === "all" ? undefined : tab, signal }),
        getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
        enabled: Boolean(scope),
    });

    const byResource = useMemo(() => new Map(items.filter((item) => item.resourceId).map((item) => [item.resourceId, item])), [items]);
    const works = useMemo(() => {
        const seen = new Set<string>();
        const list: Work[] = [];
        for (const page of query.data?.pages || [])
            for (const asset of page.assets) {
                const work = toWork(asset, byResource);
                if (!work || seen.has(work.id)) continue;
                seen.add(work.id);
                list.push(work);
            }
        return list;
    }, [byResource, query.data?.pages]);
    const labels = useMemo(() => [...new Set(works.map((work) => work.label))], [works]);
    const shown = useMemo(() => works.filter((work) => (label === "all" || work.label === label) && (!favOnly || (work.resourceId && favorites.has(work.resourceId)))), [favOnly, favorites, label, works]);
    const groups = useMemo(() => groupByDay(shown), [shown]);
    const total = query.data?.pages[0]?.total ?? 0;
    const filtering = label !== "all" || favOnly;
    const allShownPicked = shown.length > 0 && shown.every((work) => picked.includes(work.id));
    const busy = preparing || deleting;

    const assertCurrentUser = (controller: AbortController) => {
        controller.signal.throwIfAborted();
        if (!scope || useUserStore.getState().user?.id !== scope) throw new Error("账号已切换，请重新选择要删除的作品");
    };

    const closeDeletion = () => {
        if (deletingRef.current) return;
        operation.current?.abort();
        setPreparing(false);
        setDeletion(null);
    };

    const prepareDeletion = async (all: boolean) => {
        if (operation.current && !operation.current.signal.aborted) return;
        const controller = new AbortController();
        operation.current = controller;
        setDeleteError("");
        setDeletedCount(0);
        setDeletion({ ids: all ? [] : [...picked], all, scope });
        setPreparing(all);
        try {
            assertCurrentUser(controller);
            if (all) {
                const ids = await collectShopWorkIds(
                    (page) => loadAssetLibraryPage({ page, pageSize: 200, status: "active", kind: tab === "all" ? undefined : tab, signal: controller.signal }),
                    (asset) => {
                        const work = toWork(asset, byResource);
                        return Boolean(work && (tab === "all" || work.kind === tab) && (label === "all" || work.label === label) && (!favOnly || favorites.has(work.resourceId)));
                    },
                    () => assertCurrentUser(controller),
                );
                setDeletion({ ids, all, scope });
            }
        } catch (error) {
            if (!controller.signal.aborted) setDeleteError(error instanceof Error ? error.message : "作品列表读取失败，请取消后重试");
        } finally {
            if (!controller.signal.aborted) setPreparing(false);
        }
    };

    const confirmDeletion = async () => {
        const controller = operation.current;
        if (!deletion?.ids.length || !controller || preparing || deletingRef.current || deletion.scope !== scope) return;
        deletingRef.current = true;
        setDeleting(true);
        setDeleteError("");
        let completed = 0;
        try {
            assertCurrentUser(controller);
            await queryClient.cancelQueries({ queryKey: ["shop-works", scope] });
            await deleteShopWorkIds(deletion.ids, {
                assertCurrentUser: () => assertCurrentUser(controller),
                deleteBatch: deleteAssetsWithRemoteSync,
                onDeleted: (ids) => {
                    completed += ids.length;
                    setDeletedCount((count) => count + ids.length);
                    const removed = new Set(ids);
                    setPicked((current) => current.filter((id) => !removed.has(id)));
                    setDeletion((current) => current && { ...current, ids: current.ids.filter((id) => !removed.has(id)) });
                    queryClient.setQueryData<InfiniteData<Awaited<ReturnType<typeof loadAssetLibraryPage>>>>(
                        ["shop-works", scope, tab],
                        (current) => current && { ...current, pages: current.pages.map((page) => ({ ...page, assets: page.assets.filter((asset) => !removed.has(asset.id)), total: Math.max(0, page.total - ids.length) })) },
                    );
                },
            });
            setDeletion(null);
            controller.abort();
        } catch (error) {
            if (!controller.signal.aborted) setDeleteError(error instanceof Error ? error.message : "作品删除失败，请重试");
        } finally {
            deletingRef.current = false;
            if (operation.current === controller) setDeleting(false);
            if (completed) void queryClient.invalidateQueries({ queryKey: ["shop-works", scope] });
        }
    };

    // 对照台：生图记录里的图带上功能与原图信息，其余资产图按普通图片放进去。
    const boardItems = useMemo(() => {
        const extra: ShopItem[] = works
            .filter((work) => work.kind === "image" && work.resourceId && !work.item)
            .map((work) => ({
                key: `a:${work.id}`,
                source: "asset",
                chip: "asset",
                label: "图片",
                createdAt: work.createdAt,
                text: "资产图片",
                status: "done",
                resourceId: work.resourceId,
                references: [],
                modelLabel: "",
                ratio: "",
                resolution: "",
                order: 1,
            }));
        return [...items, ...extra].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }, [items, works]);

    const open = (work: Work) => {
        if (selecting) {
            setPicked((list) => (list.includes(work.id) ? list.filter((id) => id !== work.id) : [...list, work.id]));
            return;
        }
        if (work.kind === "video") setVideo(work);
        else if (work.resourceId) setBoard(work.item?.key || `a:${work.id}`);
    };
    const downloadPicked = () => {
        const chosen = works.filter((work) => picked.includes(work.id));
        const images = chosen.filter((work) => work.kind === "image" && work.resourceId);
        if (images.length) startEcommerceDownload(images.map((work, index) => ({ image: { imageType: "single" } as EcommercePlanImage, assetId: work.id, index, resourceId: work.resourceId })));
        chosen
            .filter((work) => work.kind === "video" && work.url)
            .forEach((work) => {
                const link = document.createElement("a");
                link.href = work.resourceId ? `${resourceFileUrl(work.resourceId)}?download=1` : work.url;
                link.download = "";
                document.body.appendChild(link);
                link.click();
                link.remove();
            });
        message.success(`开始下载 ${chosen.length} 个作品`);
    };

    return (
        <div className="sp-page sw2-page ms-scope" data-selecting={selecting || undefined}>
            <header className="sw2-head">
                <div className="sw2-title">
                    <h1>作品</h1>
                    <span>
                        已加载 {works.length} 个结果{total > works.length ? ` / 共 ${total}` : ""}
                    </span>
                </div>
                <div className="sw2-bar">
                    <LayoutGroup id="sw2-tabs">
                        <div className="sw2-seg">
                            {TABS.map(([id, text]) => (
                                <button
                                    key={id}
                                    type="button"
                                    data-active={tab === id || undefined}
                                    onClick={() => {
                                        setTab(id);
                                        setLabel("all");
                                    }}
                                >
                                    {tab === id ? <motion.i layoutId="sw2-tab-pill" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 }} /> : null}
                                    <span>{text}</span>
                                </button>
                            ))}
                        </div>
                    </LayoutGroup>
                    <ShopDropdown width={200} tone={label !== "all" ? "accent" : undefined} icon={<Filter className="size-3.5" />} label={label === "all" ? "全部功能" : label}>
                        {(close) => (
                            <div className="sp-list sp-list-scroll">
                                {["all", ...labels].map((value) => (
                                    <button key={value} type="button" className="sp-list-item" data-active={value === label || undefined} onClick={() => (setLabel(value), close())}>
                                        <span>{value === "all" ? "全部功能" : value}</span>
                                        {value === label ? <Check className="size-3.5" strokeWidth={2.4} /> : <small>{value === "all" ? works.length : works.filter((work) => work.label === value).length}</small>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </ShopDropdown>
                    <button type="button" className="sw2-pill" data-on={favOnly || undefined} onClick={() => setFavOnly((value) => !value)}>
                        <Star className="size-3.5" />
                        仅看收藏
                    </button>
                    <AnimatePresence>
                        {filtering ? (
                            <motion.button
                                type="button"
                                className="sw2-reset"
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -6 }}
                                onClick={() => {
                                    setLabel("all");
                                    setFavOnly(false);
                                }}
                            >
                                重置
                            </motion.button>
                        ) : null}
                    </AnimatePresence>
                    <button
                        type="button"
                        className="sw2-pill sw2-batch"
                        data-on={selecting || undefined}
                        aria-pressed={selecting}
                        disabled={busy}
                        onClick={() => {
                            setSelecting((value) => !value);
                            setPicked([]);
                        }}
                    >
                        <CheckSquare className="size-3.5" />
                        {selecting ? "完成" : "批量操作"}
                    </button>
                </div>
            </header>

            <div className="sw2-body">
                {query.isError ? (
                    <div role="alert">
                        <WorkspaceErrorState title="作品读取失败" description="请检查网络后重试，已生成的作品不会因此丢失。" onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())} compact={works.length > 0} />
                    </div>
                ) : null}
                {query.isLoading ? (
                    <div className="si-loading">
                        <LoaderCircle className="sp-spin size-5" />
                        正在读取作品
                    </div>
                ) : !groups.length && query.isError ? null : !groups.length ? (
                    <div className="sp-empty">
                        <strong>{works.length ? "没有符合条件的作品" : "还没有作品"}</strong>
                        <small>{works.length ? "换个筛选条件看看" : "生成的图片和视频会自动出现在这里"}</small>
                    </div>
                ) : (
                    <motion.div key={`${tab}:${label}:${favOnly}`} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                        {groups.map((group) => (
                            <section key={group.key} className="sw2-group">
                                <h2>{group.label}</h2>
                                <small>{group.items.length} ASSETS</small>
                                <div className="sw2-grid">
                                    {group.items.map((work, index) => {
                                        const isPicked = picked.includes(work.id);
                                        const fav = Boolean(work.resourceId && favorites.has(work.resourceId));
                                        return (
                                            <motion.button
                                                key={work.id}
                                                type="button"
                                                className="sw2-card"
                                                data-picked={isPicked || undefined}
                                                data-selecting={selecting || undefined}
                                                aria-pressed={selecting ? isPicked : undefined}
                                                disabled={busy}
                                                onClick={() => open(work)}
                                                initial={reduced ? false : { opacity: 0, scale: 0.94, y: 8 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                transition={{ delay: Math.min(index, 16) * 0.02, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                                                whileTap={{ scale: 0.97 }}
                                                title={work.item?.text || work.label}
                                            >
                                                {work.kind === "video" ? (
                                                    <PassiveVideoPoster
                                                        src={work.url}
                                                        storageKey={work.resourceId ? `resource:${work.resourceId}` : undefined}
                                                        poster={work.cover}
                                                        alt="视频封面"
                                                        className="sw2-cover"
                                                        fallback={<span className="sw2-blank" />}
                                                    />
                                                ) : work.cover ? (
                                                    <img src={work.cover} alt="" loading="lazy" draggable={false} />
                                                ) : (
                                                    <span className="sw2-blank" />
                                                )}
                                                {work.kind === "video" ? (
                                                    <>
                                                        <span className="sw2-play">
                                                            <Play className="size-5" fill="currentColor" />
                                                        </span>
                                                        {work.duration ? <span className="sw2-duration">{durationText(work.duration)}</span> : null}
                                                    </>
                                                ) : null}
                                                <span className="sw2-overlay">
                                                    <em>{work.label}</em>
                                                </span>
                                                {work.resourceId && !selecting ? (
                                                    <span
                                                        role="button"
                                                        tabIndex={0}
                                                        className="sw2-fav"
                                                        data-on={fav || undefined}
                                                        aria-label={fav ? "取消收藏" : "收藏"}
                                                        aria-pressed={fav}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Enter" || event.key === " ") {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                void favoriteWithNotice(message, scope, work.resourceId);
                                                            }
                                                        }}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            void favoriteWithNotice(message, scope, work.resourceId);
                                                        }}
                                                    >
                                                        <Star className="size-3.5" />
                                                    </span>
                                                ) : null}
                                                {selecting ? (
                                                    <span className="sw2-check" data-on={isPicked || undefined}>
                                                        <Check className="size-3" strokeWidth={3} />
                                                    </span>
                                                ) : null}
                                            </motion.button>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                        {query.hasNextPage ? (
                            <button type="button" className="si-more sw2-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                                {query.isFetchingNextPage ? "加载中…" : "加载更多"}
                            </button>
                        ) : (
                            <div className="si-end sw2-more">已加载全部资产</div>
                        )}
                    </motion.div>
                )}
            </div>

            <AnimatePresence>
                {selecting ? (
                    <motion.div
                        className="sw2-selbar"
                        role="toolbar"
                        aria-label="作品批量操作"
                        initial={{ opacity: 0, y: reduced ? 0 : 20, x: "-50%" }}
                        animate={{ opacity: 1, y: 0, x: "-50%" }}
                        exit={{ opacity: 0, y: reduced ? 0 : 20, x: "-50%" }}
                        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }}
                    >
                        <span role="status">
                            已选 <b>{picked.length}</b> 个
                        </span>
                        <Button disabled={busy || !shown.length} onClick={() => setPicked(allShownPicked ? [] : shown.map((work) => work.id))}>
                            {allShownPicked ? "取消全选" : "全选已加载"}
                        </Button>
                        <Button disabled={busy || !picked.length} onClick={downloadPicked} icon={<Download className="size-3.5" />}>
                            下载
                        </Button>
                        <AntTooltip title={!picked.length ? "先选择要删除的作品" : undefined}>
                            <Button danger disabled={busy || !picked.length} onClick={() => void prepareDeletion(false)} icon={<Trash2 className="size-3.5" />}>
                                删除所选
                            </Button>
                        </AntTooltip>
                        <Button danger disabled={busy || query.isLoading || query.isError || !total} onClick={() => void prepareDeletion(true)}>
                            全部删除
                        </Button>
                        <Button
                            type="text"
                            aria-label="退出批量操作"
                            disabled={busy}
                            onClick={() => {
                                setSelecting(false);
                                setPicked([]);
                            }}
                        >
                            <X className="size-3.5" />
                        </Button>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <AppModal
                title={preparing ? "正在统计待删除作品…" : deletion?.all ? `删除当前筛选的全部 ${deletion.ids.length} 个作品？` : `删除所选的 ${deletion?.ids.length ?? 0} 个作品？`}
                open={Boolean(deletion)}
                onCancel={closeDeletion}
                onOk={() => void confirmDeletion()}
                confirmLoading={deleting}
                okText="删除作品"
                okButtonProps={{ danger: true, disabled: preparing || !deletion?.ids.length }}
                cancelText="取消"
                cancelButtonProps={{ disabled: deleting }}
                closable={!deleting}
                keyboard={!deleting}
                maskClosable={!deleting}
            >
                <p>{deletion?.all ? "范围：当前类型、功能及收藏筛选下的全部作品，包含尚未加载的作品。" : "将删除已选中的作品。"}</p>
                <p>作品及素材库中的对应记录将永久删除，无法恢复。引用这些作品的画布或项目可能无法再显示原文件。</p>
                {preparing ? <p role="status">正在读取全部作品，请稍候…</p> : null}
                {!preparing && !deletion?.ids.length && !deleteError ? <p role="status">没有需要删除的作品。</p> : null}
                {deleting || deletedCount ? (
                    <p role="status">
                        已删除 {deletedCount} 个作品{deleting ? "，正在继续…" : "；其余作品尚未删除。"}
                    </p>
                ) : null}
                {deleteError ? (
                    <p className="sw2-delete-error" role="alert">
                        {deleteError}。可以取消后刷新列表，或重试剩余作品。
                    </p>
                ) : null}
            </AppModal>

            <AnimatePresence>{board ? <ShopBoard key="board" scope={scope} state={state} items={boardItems} initialKey={board} onClose={() => setBoard(null)} onUseImage={putImage} /> : null}</AnimatePresence>
            <VideoPreviewDialog open={Boolean(video)} src={video?.url || ""} onClose={() => setVideo(null)} />
        </div>
    );
}
