import { App } from "antd";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Check, ImageIcon, LayoutGrid, LayoutTemplate, ListFilter, LoaderCircle, Plus, RotateCcw, Star, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation } from "react-router";

import { resourceVariantUrl } from "@/services/api/resources";
import { tryOnFunction } from "@/pages/ecommerce/tryon/tryon-kinds";
import { usesAiModel } from "@/pages/ecommerce/tryon/tryon-plan";
import { useTryOn, type TryOnState } from "@/pages/ecommerce/tryon/use-tryon";

import { ShopBoard } from "./shop-board";
import { ShopComposer } from "./shop-composer";
import { SHOP_MARKET, useShopFunction, useShopScope, type ShopFn } from "./shop-context";
import { ShopDropdown } from "./shop-dropdown";
import { addChatResources, removeShopEdit, retryShopEdit, favoriteWithNotice, updateChatDraft, useShopEdits, useShopFavorites } from "./shop-edits";
import { groupByDay, SHOP_CHIPS, stampLabel, useShopItems, type ShopItem } from "./shop-items";
import { ShopLibraryPanel } from "./shop-library";
import { ShopCreating } from "./shop-thinking";
import { GridLayoutMenu, gridStyle, useGridLayout } from "./shop-layout";
import { ShopImageVideo } from "./shop-image-video";
import { ShopCreationDock, ShopCreationPortal } from "./shop-creation-dock";
import "./shop-image-video.css";

function aspectOf(ratio: string) {
    const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(ratio || "");
    return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? `${match[1]} / ${match[2]}` : "3 / 4";
}

type Status = "all" | "running" | "done" | "failed";
const STATUSES: Array<[Status, string]> = [
    ["all", "全部"],
    ["running", "生成中"],
    ["done", "已完成"],
    ["failed", "失败"],
];
const PAGE = 120;

/** 把一张图放进当前功能的输入框：对话生图放进参考图，换装功能放进第一个还有空位的上传位。 */
export function useShopImageActions(state: TryOnState, mode: ShopFn, pick: (fn: ShopFn) => void, allowed: string[]) {
    const { message } = App.useApp();
    const putImage = (resourceId: string) => {
        if (mode === "chat") {
            addChatResources([{ resourceId, name: "生成图" }]);
            message.success("已放进参考图");
            return;
        }
        const config = tryOnFunction(state.draft.fn);
        const slots = config.slots.filter((slot) => !(slot.key === "model" && usesAiModel(state.draft)));
        const slot = slots.find((item) => state.slotImages(item.key).length < item.max) || slots[0];
        if (!slot) return;
        state.addResources(slot.key, [{ resourceId, name: "生成图" }]);
        message.success(`已放进「${slot.label}」`);
    };
    const reEdit = (item: ShopItem) => {
        if (item.source === "tryon" && item.batchId && item.tryOnFn) {
            if (!allowed.includes(item.tryOnFn)) {
                message.warning(`「${tryOnFunction(item.tryOnFn).label}」暂未开放，不能恢复这批设置`);
                return;
            }
            pick(item.tryOnFn);
            if (state.restoreBatch(item.batchId)) message.success("已把这批的提示词和素材放回输入框");
            else message.info("这批来自其他设备，没有可恢复的素材");
            return;
        }
        // 对话生图与对照台加工：提示词放回输入框，参考图一并带上。
        pick("chat");
        const refs = item.references.length ? item.references : item.baseResourceId ? [item.baseResourceId] : [];
        updateChatDraft((draft) => ({ ...draft, text: item.text, refs: [] }));
        addChatResources(refs.map((resourceId) => ({ resourceId, name: "参考图" })));
        message.success(refs.length ? "提示词和参考图已放回输入框" : "提示词已放回输入框");
    };
    return { putImage, reEdit };
}

function ShopCard({
    item,
    index,
    favorite,
    onOpen,
    onFavorite,
    onUse,
    onEdit,
    onRetry,
    onRemove,
    onDelete,
}: {
    item: ShopItem;
    index: number;
    favorite: boolean;
    onOpen: () => void;
    onFavorite: () => void;
    onUse: () => void;
    onEdit: () => void;
    onRetry: () => void;
    onRemove: () => void;
    onDelete: () => void;
}) {
    const reduced = useReducedMotion();
    return (
        <motion.article
            layout={!reduced}
            className="si-card"
            data-status={item.status}
            initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ delay: Math.min(index, 12) * 0.025, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
            <div
                className="si-thumb"
                style={{ "--si-ar": aspectOf(item.ratio) } as CSSProperties}
                onClick={item.status === "done" ? onOpen : undefined}
                role={item.status === "done" ? "button" : undefined}
                tabIndex={item.status === "done" ? 0 : undefined}
                onKeyDown={(event) => event.key === "Enter" && item.status === "done" && onOpen()}
            >
                {item.status === "done" ? (
                    <>
                        <img src={resourceVariantUrl(item.resourceId, "thumbnail")} alt={item.text} loading="lazy" draggable={false} />
                        <div className="si-hover">
                            <button
                                type="button"
                                className="si-fav"
                                data-on={favorite || undefined}
                                aria-label={favorite ? "取消收藏" : "收藏"}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onFavorite();
                                }}
                            >
                                <Star className="size-4" strokeWidth={2} />
                            </button>
                            <button
                                type="button"
                                className="si-del"
                                aria-label="删除这张"
                                title="删除这张"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDelete();
                                }}
                            >
                                <Trash2 className="size-3.5" strokeWidth={2} />
                            </button>
                            <button
                                type="button"
                                className="si-use"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onUse();
                                }}
                            >
                                <Plus className="size-3.5" strokeWidth={2.6} />
                                用这张图
                            </button>
                            <div className="si-meta">
                                <strong>{item.label}</strong>
                                <p>{item.text}</p>
                                <small>{stampLabel(item.createdAt)}</small>
                            </div>
                        </div>
                        {favorite ? <Star className="si-fav-mark size-3.5" strokeWidth={2.4} /> : null}
                    </>
                ) : item.status === "running" ? (
                    <ShopCreating progress={item.progress} since={item.createdAt} />
                ) : item.status === "loading" ? (
                    <div className="si-running" role="status">
                        <ImageIcon className="size-5" />
                        <small>正在读取作品</small>
                    </div>
                ) : (
                    <div className="si-failed" title={item.error}>
                        <TriangleAlert className="size-5" />
                        <small>{item.error || "生成失败"}</small>
                        <span>
                            <button type="button" onClick={onRetry}>
                                <RotateCcw className="size-3" />
                                重试
                            </button>
                            <button type="button" onClick={onRemove}>
                                <Trash2 className="size-3" />
                                移除
                            </button>
                        </span>
                    </div>
                )}
            </div>
            <footer className="si-foot">
                <button type="button" className="si-edit" onClick={onEdit}>
                    <Undo2 className="size-3" />
                    重新编辑
                </button>
                <span className="si-tag" data-chip={item.chip}>
                    {item.label}
                </span>
            </footer>
        </motion.article>
    );
}

/** 同一创作页内保留两种草稿；切换时卸载输入控件，避免隐藏控件响应粘贴或快捷键。 */
export default function ShopImage() {
    const location = useLocation();
    const video = new URLSearchParams(location.search).get("media") === "video";
    const [videoVisited, setVideoVisited] = useState(video);
    useEffect(() => {
        if (video) setVideoVisited(true);
    }, [video]);
    return (
        <ShopCreationDock mode={video ? "video" : "image"}>
            <ShopImageWorkspace active={!video} />
            {video || videoVisited ? <ShopImageVideo active={video} /> : null}
        </ShopCreationDock>
    );
}

/** 图片记录与图片草稿只属于图片模式，视频模式复用独立的视频任务链路。 */
function ShopImageWorkspace({ active }: { active: boolean }) {
    const { message, modal } = App.useApp();
    const reduced = useReducedMotion();
    const scope = useShopScope();
    const { fn, mode, allowed, pick } = useShopFunction();
    const state = useTryOn({ scope, fn, market: SHOP_MARKET });
    const edits = useShopEdits(scope);
    const items = useShopItems(state, edits.records, edits.tasks);
    const favorites = useShopFavorites(scope);
    const [chip, setChip] = useState("all");
    const [layout, setLayout] = useGridLayout("image");
    const [status, setStatus] = useState<Status>("all");
    const [favOnly, setFavOnly] = useState(false);
    const [limit, setLimit] = useState(PAGE);
    const [library, setLibrary] = useState(false);
    const [board, setBoard] = useState<string | null>(null);
    useEffect(() => {
        if (!active) {
            setLibrary(false);
            setBoard(null);
        }
    }, [active]);
    const { putImage, reEdit } = useShopImageActions(state, mode, pick, allowed);

    const filtered = useMemo(
        () => items.filter((item) => (chip === "all" || item.chip === chip) && (status === "all" || item.status === status) && (!favOnly || (item.resourceId && favorites.has(item.resourceId)))),
        [chip, favOnly, favorites, items, status],
    );
    const groups = useMemo(() => groupByDay(filtered.slice(0, limit)), [filtered, limit]);
    const counts = useMemo(() => {
        const map = new Map<string, number>();
        items.forEach((item) => map.set(item.chip, (map.get(item.chip) || 0) + 1));
        return map;
    }, [items]);
    const loaded = state.batchesLoaded && edits.loaded;
    const hasMore = filtered.length > limit || state.hasMoreBatches;
    const filtering = status !== "all" || favOnly;

    const retry = (item: ShopItem) => {
        if (item.editId) retryShopEdit({ scope, config: state.config }, item.editId);
        else if (item.batchId && item.jobKey) void state.retry(item.batchId, item.jobKey);
    };
    const remove = (item: ShopItem) => {
        if (item.editId) removeShopEdit(scope, item.editId);
        else if (item.batchId && item.jobKey) state.hideJob(item.batchId, item.jobKey);
    };
    /** 从生成记录里删除：单张或一整天。资产库里的文件保留，可在作品页找到。 */
    const confirmDelete = (list: ShopItem[], title: string) =>
        modal.confirm({
            title,
            content: `共 ${list.length} 张，会从生成记录和对照台里移除；已保存到资产库的图片不受影响。`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                list.forEach(remove);
                message.success(`已删除 ${list.length} 张`);
            },
        });

    if (!active) return null;

    return (
        <div className="sp-page sp-image si-page ms-scope">
            <header className="si-head">
                <div className="si-head-row">
                    <div className="sp-image-title">
                        <i />
                        <strong>生成记录</strong>
                    </div>
                    <div className="si-head-tools">
                        <GridLayoutMenu layout={layout} onChange={setLayout} />
                        <ShopDropdown align="end" width={240} tone={filtering ? "accent" : undefined} icon={<ListFilter className="size-3.5" />} label="筛选">
                            {() => (
                                <div className="sp-size">
                                    <div className="sp-list-title">生成状态</div>
                                    <div className="sp-seg">
                                        {STATUSES.map(([value, text]) => (
                                            <button key={value} type="button" data-active={value === status || undefined} onClick={() => setStatus(value)}>
                                                {text}
                                            </button>
                                        ))}
                                    </div>
                                    <button type="button" className="si-switch" data-on={favOnly || undefined} onClick={() => setFavOnly((value) => !value)}>
                                        <Star className="size-3.5" />
                                        只看收藏
                                        <i>
                                            <b />
                                        </i>
                                    </button>
                                    {filtering ? (
                                        <button
                                            type="button"
                                            className="si-reset"
                                            onClick={() => {
                                                setStatus("all");
                                                setFavOnly(false);
                                            }}
                                        >
                                            重置筛选
                                        </button>
                                    ) : null}
                                </div>
                            )}
                        </ShopDropdown>
                    </div>
                </div>
                <LayoutGroup id="si-chips">
                    <div className="sp-filter si-chips">
                        {[{ key: "all", label: "全部" }, ...SHOP_CHIPS].map(({ key, label }) => {
                            const active = chip === key;
                            const count = key === "all" ? items.length : counts.get(key) || 0;
                            return (
                                <button key={key} type="button" data-active={active || undefined} data-empty={!count || undefined} onClick={() => setChip(key)}>
                                    {active ? <motion.i layoutId="si-chip-pill" className="sp-filter-pill" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 }} /> : null}
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                    </div>
                </LayoutGroup>
            </header>

            <div className="sp-image-body si-body">
                {!loaded ? (
                    <div className="si-loading">
                        <LoaderCircle className="sp-spin size-5" />
                        正在读取生成记录
                    </div>
                ) : !groups.length ? (
                    <motion.div key={`${chip}:${status}:${favOnly}`} className="sp-empty" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                        <span className="sp-empty-icon">
                            <ImageIcon className="size-5" />
                        </span>
                        <strong>{items.length ? "没有符合条件的记录" : "还没有生成记录"}</strong>
                        <small>{items.length ? "换个功能或重置筛选看看" : "在下方输入想法，开始你的第一次生产"}</small>
                    </motion.div>
                ) : (
                    <motion.div key={`${chip}:${status}:${favOnly}`} className="si-groups" data-size={layout.size} data-cols={layout.cols} style={gridStyle(layout)} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
                        {groups.map((group) => {
                            const labels = new Map<string, number>();
                            group.items.forEach((item) => labels.set(item.label, (labels.get(item.label) || 0) + 1));
                            return (
                                <section key={group.key} className="si-group">
                                    <header>
                                        <strong>{group.label}</strong>
                                        <span className="si-group-count">{group.items.length} 张</span>
                                        {[...labels].map(([label, count]) => (
                                            <span key={label} className="si-group-chip">
                                                {label} <b>{count}</b>
                                            </span>
                                        ))}
                                        <i />
                                        <button type="button" className="si-group-del" title={`删除${group.label}的 ${group.items.length} 张`} onClick={() => confirmDelete(group.items, `删除${group.label}的全部记录？`)}>
                                            <Trash2 className="size-3.5" />
                                            <span>删除这天</span>
                                        </button>
                                    </header>
                                    <div className="si-grid sp-grid-layout">
                                        <AnimatePresence initial={false}>
                                            {group.items.map((item, index) => (
                                                <ShopCard
                                                    key={item.key}
                                                    item={item}
                                                    index={index}
                                                    favorite={Boolean(item.resourceId && favorites.has(item.resourceId))}
                                                    onOpen={() => setBoard(item.key)}
                                                    onFavorite={() => void favoriteWithNotice(message, scope, item.resourceId)}
                                                    onUse={() => putImage(item.resourceId)}
                                                    onEdit={() => reEdit(item)}
                                                    onRetry={() => retry(item)}
                                                    onRemove={() => remove(item)}
                                                    onDelete={() => confirmDelete([item], "删除这张记录？")}
                                                />
                                            ))}
                                        </AnimatePresence>
                                    </div>
                                </section>
                            );
                        })}
                        {hasMore ? (
                            <button
                                type="button"
                                className="si-more"
                                onClick={() => {
                                    setLimit((value) => value + PAGE);
                                    if (state.hasMoreBatches) state.showMoreBatches();
                                }}
                            >
                                加载更多
                            </button>
                        ) : (
                            <div className="si-end">— 已加载全部记录 —</div>
                        )}
                    </motion.div>
                )}
            </div>

            <ShopCreationPortal>
                <ShopComposer
                    variant="dock"
                    managed
                    generationPage
                    state={state}
                    allowed={allowed}
                    mode={mode}
                    onPickFunction={pick}
                    onSubmitted={() => setChip("all")}
                    toolbarExtra={
                        <button type="button" className="sp-chip" aria-label="模板推荐" data-open={library || undefined} onClick={() => setLibrary((value) => !value)}>
                            <LayoutTemplate className="size-3.5" />
                            模板
                        </button>
                    }
                />
            </ShopCreationPortal>
            <ShopLibraryPanel state={state} allowed={allowed} open={library} onClose={() => setLibrary(false)} />
            <AnimatePresence>{board ? <ShopBoard key="board" scope={scope} state={state} items={items} initialKey={board} onClose={() => setBoard(null)} onUseImage={putImage} /> : null}</AnimatePresence>
        </div>
    );
}
