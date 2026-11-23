import { App } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, CircleHelp, ClipboardPaste, Download, Keyboard, LayoutPanelTop, ListChecks, LoaderCircle, Star, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { Checkbox } from "@/components/ui/base/checkbox";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceFileUrl, resourceVariantUrl } from "@/services/api/resources";
import type { EcommercePlanImage } from "@/services/api/ecommerce";
import { startEcommerceDownload } from "@/pages/ecommerce/export";
import type { TryOnState } from "@/pages/ecommerce/tryon/use-tryon";

import { ShopDropdown } from "./shop-dropdown";
import { addLocalShopEdit, addUploadedShopImage, removeShopEdit, favoriteWithNotice, useShopFavorites, type ShopEditRecord } from "./shop-edits";
import { ShopCropModal, ShopEditModal, type EditKind } from "./shop-edit-modal";
import { noiseImage } from "./shop-image-ops";
import type { ShopItem } from "./shop-items";
import "./shop-board.css";

type BoardNode = { id: string; key: string; x: number; y: number; w: number; h: number; original?: boolean };
type PendingPlacement = { at?: { x: number; y: number }; beside?: string };
type View = { x: number; y: number; s: number };
type Gesture =
    | { mode: "pan"; start: { x: number; y: number }; view: View }
    | { mode: "move"; start: { x: number; y: number }; nodes: BoardNode[]; moved: boolean }
    | { mode: "resize"; start: { x: number; y: number }; node: BoardNode; corner: string }
    | { mode: "marquee"; start: { x: number; y: number }; additive: boolean; base: string[] };

type TimeRange = "all" | "today" | "7d" | "30d";
const TIMES: Array<[TimeRange, string]> = [
    ["all", "全部时间"],
    ["today", "今天"],
    ["7d", "近 7 天"],
    ["30d", "近 30 天"],
];

const SHORTCUTS: Array<[string, string]> = [
    ["滚轮", "缩放画布"],
    ["空格", "+ 拖 平移画布"],
    ["拖空白", "框选"],
    ["← →", "换成上/下一张图"],
    ["⌘0", "等大并排（全部收进视野）"],
    ["⌘1", "画布回到 100%"],
    ["O", "查看原图 / 切回结果"],
    ["C", "裁剪当前这张"],
    ["Del", "移出画布"],
    ["⌘⌫", "删除这张记录"],
    ["⌘/Ctrl V", "粘贴图片到画布"],
    ["Esc", "关闭"],
];

const INTRO_ROWS: Array<[string, string]> = [
    ["放图进来", "点右上角上传、拖本地图片进画布，或复制图片后按 ⌘/Ctrl + V"],
    ["摆位置", "拖图挪位置，拽四个角改大小（等比，不会变形）"],
    ["看细节", "滚轮缩放整块画布，按住空格拖动平移"],
    ["并排比", "点「等大并排」，所有图按同样大小排开，全部收进可见范围"],
    ["换一张比", "← → 把选中那张换成上/下一张，位置和大小留在原地"],
    ["接着加工", "选中一张，图下方会出现裁剪、下载和继续加工；右键是全量菜单"],
];

const TOUR = [
    { title: "右边是这次生成的全部图", body: "点其中一张，它就落到左边画布上；直接拖进去也行。想比几张就放几张——现在点一张试试。", target: "side", next: "点右边任意一张图继续" },
    { title: "各自摆位置、看细节", body: "每张都是独立的一张图：拖着挪位置，拽四个角改大小（等比，不会变形）。滚轮缩放整块画布，按住空格拖动是平移。", target: "stage", next: "知道了，下一步" },
    { title: "要比差别，先排齐", body: "点「等大并排」（或 ⌘0），画布上所有图按同样大小并排铺开、全部收进可见范围——大小一致、挨在一起，差别才看得出来。", target: "arrange", next: "下一步" },
    { title: "选中一张就能接着加工", body: "选中哪张，这条就跟到哪张下面：裁剪、下载、高清放大、局部重绘……右键是全量菜单。按 ← → 把选中那张换成上/下一张，位置和大小留在原地。", target: "toolbar", next: "下一步" },
    { title: "随时能再看一遍", body: "按 Esc 关掉对照台。想重看这段引导，点顶栏这个按钮就行。", target: "guide", next: "开始用" },
] as const;

const INTRO_KEY = "shop-board-intro-v1";
const SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;
const uid = () => Math.random().toString(36).slice(2, 10);

function parseRatio(value: string) {
    const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(value || "");
    return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : 0;
}

function isImageFile(file: File) {
    return file.type.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
}

function clipboardImageFiles(data: DataTransfer | null) {
    const files = Array.from(data?.files || []).filter(isImageFile);
    if (files.length) return files;
    return Array.from(data?.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
}

function inRange(createdAt: string, range: TimeRange) {
    if (range === "all") return true;
    const time = Date.parse(createdAt);
    if (!Number.isFinite(time)) return false;
    if (range === "today") return new Date(time).toDateString() === new Date().toDateString();
    return Date.now() - time <= (range === "7d" ? 7 : 30) * 86_400_000;
}

/** 引导：高亮框与说明卡在步骤之间弹簧过渡，内容淡入淡出。 */
function BoardTour({ step, rect, canNext, onNext, onPrev, onSkip }: { step: number; rect: DOMRect | null; canNext: boolean; onNext: () => void; onPrev: () => void; onSkip: () => void }) {
    const reduced = useReducedMotion();
    const card = useRef<HTMLDivElement>(null);
    const [cardSize, setCardSize] = useState({ w: 272, h: 170 });
    useEffect(() => {
        if (card.current) setCardSize({ w: card.current.offsetWidth, h: card.current.offsetHeight });
    }, [step]);
    const info = TOUR[step];
    const pad = 6;
    const spot = rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = vw / 2 - cardSize.w / 2;
    let y = vh / 2 - cardSize.h / 2;
    if (rect) {
        if (info.target === "side") {
            x = rect.left - cardSize.w - 28;
            y = rect.top + 190;
        } else if (info.target === "stage") {
            x = rect.right - cardSize.w - 24;
            y = rect.bottom - cardSize.h - 90;
        } else if (info.target === "guide") {
            x = rect.left + rect.width / 2 + 24;
            y = rect.bottom + 14;
        } else {
            x = rect.right + 28;
            y = rect.top + rect.height / 2 - cardSize.h / 2;
            if (x + cardSize.w > vw - 16) x = rect.left - cardSize.w - 28;
        }
    }
    x = Math.max(16, Math.min(vw - cardSize.w - 16, x));
    y = Math.max(16, Math.min(vh - cardSize.h - 16, y));
    const transition = reduced ? { duration: 0 } : SPRING;
    return (
        <div className="sb-tour" aria-live="polite">
            <motion.div className="sb-spot" initial={false} animate={spot} transition={transition} />
            <motion.div ref={card} className="sb-tour-card" initial={reduced ? false : { opacity: 0, x, y: y + 12, scale: 0.96 }} animate={{ opacity: 1, x, y, scale: 1 }} transition={transition}>
                <div className="sb-tour-top">
                    <span className="sb-tour-dots">
                        {TOUR.map((_, index) => (
                            <motion.i key={index} animate={{ width: index === step ? 18 : 12, opacity: index <= step ? 1 : 0.35 }} data-on={index === step || undefined} />
                        ))}
                    </span>
                    <span>
                        {step + 1} / {TOUR.length}
                    </span>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={step}
                        initial={reduced ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, filter: "blur(4px)" }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <strong>{info.title}</strong>
                        <p>{info.body}</p>
                    </motion.div>
                </AnimatePresence>
                <div className="sb-tour-actions">
                    <button type="button" className="sb-tour-skip" onClick={onSkip}>
                        跳过
                    </button>
                    <span>
                        {step > 0 ? (
                            <button type="button" className="sb-tour-prev" onClick={onPrev}>
                                上一步
                            </button>
                        ) : null}
                        {canNext ? (
                            <motion.button type="button" className="sb-tour-next" onClick={onNext} whileTap={{ scale: 0.95 }}>
                                {info.next}
                            </motion.button>
                        ) : (
                            <span className="sb-tour-wait">{info.next}</span>
                        )}
                    </span>
                </div>
            </motion.div>
        </div>
    );
}

type MenuState = { x: number; y: number; nodeId: string } | null;

export function ShopBoard({ scope, state, items, initialKey, onClose, onUseImage }: { scope: string; state: TryOnState; items: ShopItem[]; initialKey: string; onClose: () => void; onUseImage: (resourceId: string) => void }) {
    const { message, modal } = App.useApp();
    const reduced = useReducedMotion();
    const favorites = useShopFavorites(scope);
    const stage = useRef<HTMLDivElement>(null);
    const side = useRef<HTMLElement>(null);
    const arrangeRef = useRef<HTMLButtonElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const guideRef = useRef<HTMLButtonElement>(null);
    const [nodes, setNodes] = useState<BoardNode[]>([]);
    const [view, setView] = useState<View>({ x: 0, y: 0, s: 1 });
    const [selected, setSelected] = useState<string[]>([]);
    const [natural, setNatural] = useState<Record<string, { w: number; h: number }>>({});
    const [animating, setAnimating] = useState(false);
    const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [space, setSpace] = useState(false);
    const [typeFilter, setTypeFilter] = useState("all");
    const [time, setTime] = useState<TimeRange>("all");
    const [favOnly, setFavOnly] = useState(false);
    const [downloadSelection, setDownloadSelection] = useState<Set<string> | null>(null);
    const [shortcuts, setShortcuts] = useState(true);
    const [menu, setMenu] = useState<MenuState>(null);
    const [edit, setEdit] = useState<{ kind: EditKind | "crop"; nodeId: string } | null>(null);
    const [working, setWorking] = useState("");
    const [uploading, setUploading] = useState(0);
    const [fileDragging, setFileDragging] = useState(false);
    const [pendingVersion, setPendingVersion] = useState(0);
    const [intro, setIntro] = useState(() => {
        try {
            return window.localStorage.getItem(INTRO_KEY) !== "1";
        } catch {
            return false;
        }
    });
    const [tour, setTour] = useState<number | null>(null);
    const [tourRect, setTourRect] = useState<DOMRect | null>(null);
    const gesture = useRef<Gesture | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const pendingPlace = useRef(new Map<string, PendingPlacement>());
    const animTimer = useRef<number | undefined>(undefined);
    const fileDragDepth = useRef(0);

    const itemMap = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
    const types = useMemo(() => [...new Set(items.map((item) => item.label))], [items]);
    const panelItems = useMemo(
        () => items.filter((item) => item.status !== "failed" && (typeFilter === "all" || item.label === typeFilter) && inRange(item.createdAt, time) && (!favOnly || (item.resourceId && favorites.has(item.resourceId)))),
        [favOnly, favorites, items, time, typeFilter],
    );
    const doneList = useMemo(() => panelItems.filter((item) => item.status === "done"), [panelItems]);
    const visibleDownloadIds = useMemo(() => [...new Set(doneList.map((item) => item.resourceId).filter(Boolean))], [doneList]);
    const selectedDownloadIds = useMemo(() => {
        if (!downloadSelection?.size) return [];
        return [...new Set(items.filter((item) => item.status === "done" && downloadSelection.has(item.resourceId)).map((item) => item.resourceId))];
    }, [downloadSelection, items]);
    const visibleSelectedCount = visibleDownloadIds.filter((id) => downloadSelection?.has(id)).length;
    const allVisibleSelected = visibleDownloadIds.length > 0 && visibleSelectedCount === visibleDownloadIds.length;
    const selectingDownloads = downloadSelection !== null;
    const primaryId = selected[selected.length - 1];
    const primary = nodes.find((node) => node.id === primaryId);
    const primaryItem = primary ? itemMap.get(primary.key) : undefined;
    const placedKeys = useMemo(() => new Set(nodes.map((node) => node.key)), [nodes]);

    const toggleDownloadImage = (id: string) => {
        setDownloadSelection((previous) => {
            const next = new Set(previous);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    };

    const toggleVisibleDownloads = () => {
        setDownloadSelection((previous) => {
            const next = new Set(previous);
            for (const id of visibleDownloadIds) {
                if (allVisibleSelected) next.delete(id);
                else next.add(id);
            }
            return next;
        });
    };

    const downloadImages = (ids: string[]) => {
        if (ids.length > 500) {
            message.warning("每次最多下载 500 张图片，请分批选择");
            return;
        }
        startEcommerceDownload(ids.map((resourceId, index) => ({ image: { imageType: "single" } as EcommercePlanImage, assetId: "", index, resourceId })));
    };

    useEffect(() => {
        const failed = (event: Event) => {
            const detail = (event as CustomEvent<{ owner: string; message: string }>).detail;
            if (detail?.owner === scope && getActiveUserScope() === scope) message.error(detail.message);
        };
        window.addEventListener("commerce-download-error", failed);
        return () => window.removeEventListener("commerce-download-error", failed);
    }, [message, scope]);

    const flash = useCallback(() => {
        setAnimating(true);
        window.clearTimeout(animTimer.current);
        animTimer.current = window.setTimeout(() => setAnimating(false), 650);
    }, []);
    useEffect(() => () => window.clearTimeout(animTimer.current), []);

    const stageSize = () => ({ w: stage.current?.clientWidth || 800, h: stage.current?.clientHeight || 600 });
    const toWorld = useCallback(
        (clientX: number, clientY: number) => {
            const bounds = stage.current?.getBoundingClientRect();
            return { x: (clientX - (bounds?.left || 0) - view.x) / view.s, y: (clientY - (bounds?.top || 0) - view.y) / view.s };
        },
        [view],
    );

    const ratioOf = useCallback(
        (key: string) => {
            const size = natural[key];
            if (size?.w && size.h) return size.w / size.h;
            return parseRatio(itemMap.get(key)?.ratio || "") || 3 / 4;
        },
        [itemMap, natural],
    );

    /** 放一张图到画布：指定位置时以该点为中心，否则排在最右边那张后面。 */
    const place = useCallback(
        (key: string, at?: { x: number; y: number }, beside?: string) => {
            const item = itemMap.get(key);
            if (!item || item.status !== "done") return;
            const { w: sw, h: sh } = stageSize();
            const ratio = ratioOf(key);
            setNodes((list) => {
                const anchor = beside ? list.find((node) => node.id === beside) : undefined;
                const h = anchor ? anchor.h : Math.min(560, (sh * 0.6) / view.s);
                const w = h * ratio;
                let x: number;
                let y: number;
                if (at) {
                    x = at.x - w / 2;
                    y = at.y - h / 2;
                } else if (anchor) {
                    x = anchor.x + anchor.w + 32;
                    y = anchor.y;
                } else if (list.length) {
                    const right = list.reduce((best, node) => (node.x + node.w > best.x + best.w ? node : best), list[0]);
                    x = right.x + right.w + 32;
                    y = right.y;
                } else {
                    x = (sw / 2 - view.x) / view.s - w / 2;
                    y = (sh / 2 - view.y) / view.s - h / 2 - 20 / view.s;
                }
                const node = { id: uid(), key, x, y, w, h };
                setSelected([node.id]);
                return [...list, node];
            });
        },
        [itemMap, ratioOf, view.s, view.x, view.y],
    );

    // 打开时把点到的那张放上画布。
    const opened = useRef(false);
    useEffect(() => {
        if (opened.current) return;
        opened.current = true;
        requestAnimationFrame(() => place(initialKey));
    }, [initialKey, place]);

    const queuePlacement = useCallback((key: string, placement: PendingPlacement) => {
        pendingPlace.current.set(key, placement);
        setPendingVersion((value) => value + 1);
    }, []);

    // 加工完成的新图自动放到原图旁边；上传图片按拖放位置放置。
    useEffect(() => {
        for (const [key, placement] of pendingPlace.current) {
            const item = itemMap.get(key);
            if (!item) continue;
            if (item.status === "done") {
                pendingPlace.current.delete(key);
                place(key, placement.at, nodes.some((node) => node.id === placement.beside) ? placement.beside : undefined);
                if (item.editKind !== "upload") message.success(`「${item.label}」完成，已放到画布上`);
            } else if (item.status === "failed") pendingPlace.current.delete(key);
        }
    }, [itemMap, message, nodes, pendingVersion, place]);

    /** 本地图片（上传、拖入或粘贴）先存成「本地上传」记录，出现在右侧列表后再放到画布上。 */
    const uploadImages = useCallback(
        async (files: File[], at?: { x: number; y: number }) => {
            const images = files.filter(isImageFile);
            if (!images.length) {
                if (files.length) message.warning("只能放入图片文件");
                return;
            }
            setUploading((count) => count + images.length);
            const results = await Promise.allSettled(
                images.map(async (file, index) => {
                    try {
                        const record = await addUploadedShopImage(scope, file);
                        queuePlacement(`e:${record.id}`, { at: at ? { x: at.x + index * 40, y: at.y + index * 40 } : undefined });
                    } finally {
                        setUploading((count) => Math.max(0, count - 1));
                    }
                }),
            );
            const failed = results.filter((result) => result.status === "rejected").length;
            if (failed) message.error(failed === images.length ? "图片上传失败，请重试" : `有 ${failed} 张图片上传失败`);
        },
        [message, queuePlacement, scope],
    );

    // 复制图片后在对照台里 ⌘/Ctrl + V 直接放上画布（输入框里粘贴文字不受影响）。
    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (edit || (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable))) return;
            const files = clipboardImageFiles(event.clipboardData);
            if (!files.length) return;
            event.preventDefault();
            const { w, h } = stageSize();
            const bounds = stage.current?.getBoundingClientRect();
            void uploadImages(files, bounds ? toWorld(bounds.left + w / 2, bounds.top + h / 2) : undefined);
        };
        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, [edit, toWorld, uploadImages]);

    // 原图加载后按真实比例修正高度。
    const onNatural = (key: string, w: number, h: number) => {
        if (natural[key]?.w === w && natural[key]?.h === h) return;
        setNatural((value) => ({ ...value, [key]: { w, h } }));
        setNodes((list) => list.map((node) => (node.key === key && !node.original ? { ...node, h: node.w / (w / h) } : node)));
    };

    // ---------- 排版 ----------
    const arrange = useCallback(() => {
        if (!nodes.length) return;
        const { w: sw, h: sh } = stageSize();
        const padX = 64;
        const padTop = 56;
        const padBottom = 150;
        const gap = 24;
        const availW = sw - padX * 2;
        const availH = sh - padTop - padBottom;
        const ratios = nodes.map((node) => node.w / node.h);
        let best = { h: 0, rows: [[0]] as number[][] };
        for (let rowCount = 1; rowCount <= nodes.length; rowCount++) {
            const per = Math.ceil(nodes.length / rowCount);
            const rows: number[][] = [];
            for (let index = 0; index < nodes.length; index += per) rows.push(nodes.slice(index, index + per).map((_, offset) => index + offset));
            const widest = Math.max(...rows.map((row) => row.reduce((sum, index) => sum + ratios[index], 0) + (gap * (row.length - 1)) / 1000));
            const hByW = rows.map((row) => (availW - gap * (row.length - 1)) / row.reduce((sum, index) => sum + ratios[index], 0));
            const hByH = (availH - gap * (rows.length - 1)) / rows.length;
            const h = Math.min(hByH, ...hByW);
            if (h > best.h && widest > 0) best = { h, rows };
        }
        const h = Math.max(40, best.h);
        const totalH = best.rows.length * h + gap * (best.rows.length - 1);
        let y = padTop + (availH - totalH) / 2;
        const placed = new Map<string, BoardNode>();
        for (const row of best.rows) {
            const rowW = row.reduce((sum, index) => sum + ratios[index] * h, 0) + gap * (row.length - 1);
            let x = (sw - rowW) / 2;
            for (const index of row) {
                const node = nodes[index];
                const w = ratios[index] * h;
                placed.set(node.id, { ...node, x, y, w, h });
                x += w + gap;
            }
            y += h + gap;
        }
        flash();
        setView({ x: 0, y: 0, s: 1 });
        setNodes((list) => list.map((node) => placed.get(node.id) || node));
    }, [flash, nodes]);

    const resetZoom = useCallback(() => {
        const { w: sw, h: sh } = stageSize();
        const cx = (sw / 2 - view.x) / view.s;
        const cy = (sh / 2 - view.y) / view.s;
        flash();
        setView({ s: 1, x: sw / 2 - cx, y: sh / 2 - cy });
    }, [flash, view]);

    // ---------- 节点操作 ----------
    const removeNodes = useCallback((ids: string[]) => {
        setNodes((list) => list.filter((node) => !ids.includes(node.id)));
        setSelected((list) => list.filter((id) => !ids.includes(id)));
    }, []);

    const step = useCallback(
        (direction: 1 | -1) => {
            if (!primary) return;
            const index = doneList.findIndex((item) => item.key === primary.key);
            const next = doneList[index === -1 ? 0 : (index + direction + doneList.length) % doneList.length];
            if (!next || next.key === primary.key) return;
            const ratio = ratioOf(next.key);
            // 位置和高度不动，宽度按新图比例。
            setNodes((list) => list.map((node) => (node.id === primary.id ? { ...node, key: next.key, w: node.h * ratio, original: false } : node)));
        },
        [doneList, primary, ratioOf],
    );

    const toggleOriginal = useCallback(() => {
        if (!primary) return;
        const item = itemMap.get(primary.key);
        if (!item?.baseResourceId) {
            message.info("这张没有原图");
            return;
        }
        setNodes((list) => list.map((node) => (node.id === primary.id ? { ...node, original: !node.original } : node)));
    }, [itemMap, message, primary]);

    const deleteRecord = useCallback(
        (node: BoardNode) => {
            const item = itemMap.get(node.key);
            if (!item) return;
            modal.confirm({
                title: "删除这张记录？",
                content: "会从生成记录和对照台里移除这张图，资产库里的文件不受影响。",
                okText: "删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => {
                    if (item.editId) removeShopEdit(scope, item.editId);
                    else if (item.batchId && item.jobKey) state.hideJob(item.batchId, item.jobKey);
                    setNodes((list) => list.filter((entry) => entry.key !== node.key));
                },
            });
        },
        [itemMap, modal, scope, state],
    );

    const download = (resourceId: string) => {
        const link = document.createElement("a");
        link.href = `${resourceFileUrl(resourceId)}?download=1`;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const runNoise = async (node: BoardNode) => {
        const item = itemMap.get(node.key);
        if (!item || working) return;
        setWorking("正在加噪点");
        try {
            const result = await noiseImage(item.resourceId);
            const record = await addLocalShopEdit(scope, "noise", result.blob, { baseResourceId: item.resourceId, text: `${item.label} · 加噪点`, width: result.width, height: result.height });
            queuePlacement(`e:${record.id}`, { beside: node.id });
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "加噪点失败");
        } finally {
            setWorking("");
        }
    };

    const runAction = (action: string, node: BoardNode) => {
        const item = itemMap.get(node.key);
        setMenu(null);
        if (!item) return;
        switch (action) {
            case "crop":
                setEdit({ kind: "crop", nodeId: node.id });
                break;
            case "download":
                download(item.resourceId);
                break;
            case "upscale":
            case "inpaint":
            case "repaint":
            case "cutout":
                setEdit({ kind: action, nodeId: node.id });
                break;
            case "noise":
                void runNoise(node);
                break;
            case "remove":
                removeNodes([node.id]);
                break;
            case "original":
                setSelected([node.id]);
                toggleOriginal();
                break;
            case "use":
                onUseImage(item.resourceId);
                break;
            case "favorite":
                void favoriteWithNotice(message, scope, item.resourceId);
                break;
            case "delete":
                deleteRecord(node);
                break;
        }
    };

    // ---------- 手势 ----------
    useEffect(() => {
        const node = stage.current;
        if (!node) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const bounds = node.getBoundingClientRect();
            const cx = event.clientX - bounds.left;
            const cy = event.clientY - bounds.top;
            setView((current) => {
                const s = Math.max(0.08, Math.min(8, current.s * Math.exp(-event.deltaY * 0.0015)));
                return { s, x: cx - ((cx - current.x) * s) / current.s, y: cy - ((cy - current.y) * s) / current.s };
            });
        };
        node.addEventListener("wheel", onWheel, { passive: false });
        return () => node.removeEventListener("wheel", onWheel);
    }, []);

    useEffect(() => {
        const onMove = (event: PointerEvent) => {
            const current = gesture.current;
            if (!current) return;
            const dx = event.clientX - current.start.x;
            const dy = event.clientY - current.start.y;
            if (current.mode === "pan") setView({ ...current.view, x: current.view.x + dx, y: current.view.y + dy });
            else if (current.mode === "move") {
                if (Math.abs(dx) + Math.abs(dy) > 2) current.moved = true;
                const moved = new Map(current.nodes.map((node) => [node.id, node]));
                setNodes((list) => list.map((node) => (moved.has(node.id) ? { ...node, x: moved.get(node.id)!.x + dx / view.s, y: moved.get(node.id)!.y + dy / view.s } : node)));
            } else if (current.mode === "resize") {
                const { node, corner } = current;
                const ratio = node.w / node.h;
                const left = corner.includes("l");
                const top = corner.includes("t");
                const w = Math.max(48, node.w + (left ? -dx : dx) / view.s);
                const h = w / ratio;
                setNodes((list) => list.map((entry) => (entry.id === node.id ? { ...entry, w, h, x: left ? node.x + node.w - w : node.x, y: top ? node.y + node.h - h : node.y } : entry)));
            } else if (current.mode === "marquee") {
                const bounds = stage.current?.getBoundingClientRect();
                const x0 = current.start.x - (bounds?.left || 0);
                const y0 = current.start.y - (bounds?.top || 0);
                const rect = { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) };
                setMarquee(rect);
                const world = { x: (rect.x - view.x) / view.s, y: (rect.y - view.y) / view.s, w: rect.w / view.s, h: rect.h / view.s };
                const hit = nodes.filter((node) => node.x < world.x + world.w && node.x + node.w > world.x && node.y < world.y + world.h && node.y + node.h > world.y).map((node) => node.id);
                setSelected([...new Set([...current.base, ...hit])]);
            }
        };
        const onUp = () => {
            if (gesture.current?.mode === "marquee") setMarquee(null);
            gesture.current = null;
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [nodes, view]);

    const onStageDown = (event: ReactPointerEvent) => {
        if (event.button === 2) return;
        setMenu(null);
        if (space || event.button === 1) {
            gesture.current = { mode: "pan", start: { x: event.clientX, y: event.clientY }, view };
            return;
        }
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        if (!additive) setSelected([]);
        gesture.current = { mode: "marquee", start: { x: event.clientX, y: event.clientY }, additive, base: additive ? selected : [] };
    };

    const onNodeDown = (node: BoardNode) => (event: ReactPointerEvent) => {
        if (event.button === 2) return;
        event.stopPropagation();
        setMenu(null);
        if (space || event.button === 1) {
            gesture.current = { mode: "pan", start: { x: event.clientX, y: event.clientY }, view };
            return;
        }
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        const next = additive ? (selected.includes(node.id) ? selected.filter((id) => id !== node.id) : [...selected, node.id]) : selected.includes(node.id) ? [...selected.filter((id) => id !== node.id), node.id] : [node.id];
        setSelected(next);
        gesture.current = { mode: "move", start: { x: event.clientX, y: event.clientY }, nodes: nodes.filter((entry) => next.includes(entry.id)), moved: false };
    };

    const onHandleDown = (node: BoardNode, corner: string) => (event: ReactPointerEvent) => {
        event.stopPropagation();
        gesture.current = { mode: "resize", start: { x: event.clientX, y: event.clientY }, node, corner };
    };

    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types || []).includes("Files");
    const onDragEnter = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        fileDragDepth.current += 1;
        setFileDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
        if (!fileDragDepth.current) setFileDragging(false);
    };
    const onDrop = (event: DragEvent) => {
        event.preventDefault();
        fileDragDepth.current = 0;
        setFileDragging(false);
        const at = toWorld(event.clientX, event.clientY);
        const key = event.dataTransfer.getData("text/x-shop-item");
        if (key) {
            place(key, at);
            return;
        }
        const files = Array.from(event.dataTransfer.files || []);
        if (files.length) void uploadImages(files, at);
    };

    // ---------- 键盘 ----------
    const close = useCallback(() => {
        if (tour !== null) {
            setTour(null);
            return;
        }
        if (intro) {
            setIntro(false);
            try {
                window.localStorage.setItem(INTRO_KEY, "1");
            } catch {
                // 存储不可用时下次还会提示。
            }
            return;
        }
        onClose();
    }, [intro, onClose, tour]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (edit) return;
            const target = event.target as HTMLElement | null;
            if (target?.isContentEditable || target?.matches("textarea, input:not([type=checkbox])")) return;
            const meta = event.metaKey || event.ctrlKey;
            if (event.key === "Escape") {
                event.preventDefault();
                if (menu) setMenu(null);
                else if (selectingDownloads && !intro && tour === null) setDownloadSelection(null);
                else close();
                return;
            }
            if (event.code === "Space") {
                if (target?.closest("button, input, [role=button]")) return;
                event.preventDefault();
                setSpace(true);
                return;
            }
            if (meta && event.key === "0") {
                event.preventDefault();
                arrange();
                return;
            }
            if (meta && event.key === "1") {
                event.preventDefault();
                resetZoom();
                return;
            }
            if (meta && event.key === "Backspace" && primary) {
                event.preventDefault();
                deleteRecord(primary);
                return;
            }
            if ((event.key === "Delete" || event.key === "Backspace") && selected.length) {
                event.preventDefault();
                removeNodes(selected);
                return;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                step(event.key === "ArrowLeft" ? -1 : 1);
                return;
            }
            if (!meta && event.key.toLowerCase() === "o") toggleOriginal();
            if (!meta && event.key.toLowerCase() === "c" && primary) setEdit({ kind: "crop", nodeId: primary.id });
        };
        const onKeyUp = (event: KeyboardEvent) => event.code === "Space" && setSpace(false);
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [arrange, close, deleteRecord, edit, intro, menu, primary, removeNodes, resetZoom, selected, selectingDownloads, step, toggleOriginal, tour]);

    // ---------- 引导 ----------
    const startTour = () => {
        setIntro(false);
        try {
            window.localStorage.setItem(INTRO_KEY, "1");
        } catch {
            // 忽略。
        }
        setTour(0);
    };
    const tourTarget = tour === null ? "" : TOUR[tour].target;
    useEffect(() => {
        if (tour === null) return;
        // 第 4 步需要一张选中的图，工具条才会出现。
        if (TOUR[tour].target === "toolbar" && !primary && nodes.length) setSelected([nodes[0].id]);
        const measure = () => {
            const element = tourTarget === "side" ? side.current : tourTarget === "stage" ? stage.current : tourTarget === "arrange" ? arrangeRef.current : tourTarget === "toolbar" ? toolbarRef.current : guideRef.current;
            setTourRect(element ? element.getBoundingClientRect() : null);
        };
        measure();
        const timer = window.setInterval(measure, 160);
        return () => window.clearInterval(timer);
    }, [nodes, primary, tour, tourTarget]);
    // 第 1 步：放上一张新图就自动下一步。
    const placedAtTour = useRef(0);
    useEffect(() => {
        if (tour === 0) placedAtTour.current = nodes.length;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tour]);
    useEffect(() => {
        if (tour === 0 && nodes.length > placedAtTour.current) setTour(1);
    }, [nodes.length, tour]);

    // ---------- 渲染 ----------
    const transition = animating && !reduced ? SPRING : { duration: 0 };
    const screen = (node: BoardNode) => ({ left: node.x * view.s + view.x, top: node.y * view.s + view.y, width: node.w * view.s, height: node.h * view.s });
    const primaryRect = primary ? screen(primary) : null;
    const primaryNatural = primary ? natural[primary.key] : undefined;
    const editNode = edit ? nodes.find((node) => node.id === edit.nodeId) : undefined;
    const editItem = editNode ? itemMap.get(editNode.key) : undefined;
    const placedIndex = primary ? doneList.findIndex((item) => item.key === primary.key) : -1;
    const info = primaryItem
        ? [primaryItem.label, primaryItem.modelLabel, primaryItem.resolution ? primaryItem.resolution.toLowerCase() : "", primaryItem.ratio, primaryNatural ? `${primaryNatural.w}×${primaryNatural.h}` : ""].filter(Boolean).join(" · ")
        : "";
    const fav = Boolean(primaryItem && favorites.has(primaryItem.resourceId));

    const TOOLS: Array<[string, string] | "|"> = [["crop", "裁剪"], ["download", "下载"], "|", ["upscale", "高清放大"], ["inpaint", "局部重绘"], ["repaint", "智能重绘"], ["cutout", "图片抠图"], ["noise", "加噪点"], "|", ["remove", "移出"]];

    return createPortal(
        <motion.div
            className="sb-root ms-scope"
            initial={reduced ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            onContextMenu={(event) => event.preventDefault()}
        >
            <div className="sb-main">
                <header className="sb-top">
                    <strong className="sb-title">对照台</strong>
                    <div className="sb-top-right">
                        <motion.button type="button" className="sb-btn" onClick={() => fileInput.current?.click()} disabled={uploading > 0} whileTap={{ scale: 0.95 }} title="上传本地图片，也可以直接拖进画布或 ⌘/Ctrl + V 粘贴">
                            {uploading > 0 ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                            {uploading > 0 ? `上传中 ${uploading}` : "上传图片"}
                        </motion.button>
                        <input ref={fileInput} hidden type="file" multiple accept="image/*" aria-label="上传对比图片" onChange={(event) => (void uploadImages(Array.from(event.target.files || [])), (event.target.value = ""))} />
                        <motion.button ref={guideRef} type="button" className="sb-btn" data-tone="ink" onClick={startTour} whileTap={{ scale: 0.95 }}>
                            <CircleHelp className="size-3.5" />
                            使用引导
                        </motion.button>
                        <AnimatePresence mode="wait">
                            {primaryItem ? (
                                <motion.span key={primary?.id + primary!.key} className="sb-info" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} title={primaryItem.text}>
                                    {info}
                                </motion.span>
                            ) : null}
                        </AnimatePresence>
                        {primaryItem ? (
                            <>
                                <motion.button type="button" className="sb-icon" data-on={fav || undefined} aria-label={fav ? "取消收藏" : "收藏"} onClick={() => void favoriteWithNotice(message, scope, primaryItem.resourceId)} whileTap={{ scale: 0.85 }}>
                                    <Star className="size-4" />
                                </motion.button>
                                <button type="button" className="sb-btn" onClick={() => removeNodes(selected)}>
                                    移出画布
                                </button>
                            </>
                        ) : null}
                        <button type="button" className="sb-btn" data-tone="ink" disabled={!nodes.length} onClick={() => removeNodes(nodes.map((node) => node.id))}>
                            清空画布
                        </button>
                        <span className="sb-count">
                            {placedIndex >= 0 ? placedIndex + 1 : 0} / {doneList.length} 张
                        </span>
                        <button type="button" className="sb-btn sb-close-text" onClick={onClose}>
                            关闭 <kbd>Esc</kbd>
                        </button>
                        <button type="button" className="sb-icon" aria-label="关闭" onClick={onClose}>
                            <X className="size-4" />
                        </button>
                    </div>
                </header>

                <div
                    ref={stage}
                    className="sb-stage"
                    data-space={space || undefined}
                    data-panning={gesture.current?.mode === "pan" || undefined}
                    onPointerDown={onStageDown}
                    data-file-drag={fileDragging || undefined}
                    onDragOver={(event) => event.preventDefault()}
                    onDragEnter={onDragEnter}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                >
                    {fileDragging ? (
                        <div className="sb-file-drop" aria-hidden>
                            <ClipboardPaste className="size-5" />
                            松开即可放入画布
                        </div>
                    ) : null}
                    <motion.div className="sb-world" initial={false} animate={{ x: view.x, y: view.y, scale: view.s }} transition={transition}>
                        {nodes.map((node) => {
                            const item = itemMap.get(node.key);
                            if (!item) return null;
                            const src = node.original && item.baseResourceId ? resourceFileUrl(item.baseResourceId) : resourceFileUrl(item.resourceId);
                            return (
                                <motion.div
                                    key={node.id}
                                    className="sb-node"
                                    data-selected={selected.includes(node.id) || undefined}
                                    initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                                    animate={{ opacity: 1, scale: 1, x: node.x, y: node.y, width: node.w, height: node.h }}
                                    transition={animating ? transition : { x: { duration: 0 }, y: { duration: 0 }, width: { duration: 0 }, height: { duration: 0 }, opacity: { duration: 0.25 }, scale: { type: "spring", stiffness: 380, damping: 28 } }}
                                    onPointerDown={onNodeDown(node)}
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        setSelected([node.id]);
                                        setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
                                    }}
                                >
                                    <img src={src} alt={item.text} draggable={false} onLoad={(event) => !node.original && onNatural(node.key, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
                                </motion.div>
                            );
                        })}
                    </motion.div>

                    {/* 选中框与操作放在屏幕坐标里，缩放时不变形。 */}
                    <AnimatePresence>
                        {primary && primaryRect && primaryItem && !animating ? (
                            <motion.div key={primary.id} className="sb-chrome" style={primaryRect} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                                <span className="sb-origin-chip" data-on={primary.original || undefined}>
                                    <i />
                                    {primaryItem.baseResourceId ? (primary.original ? "原图 · 按 O 切回结果" : "按 O 看原图") : "无原图"}
                                </span>
                                {["tl", "tr", "bl", "br"].map((corner) => (
                                    <b key={corner} className="sb-handle" data-corner={corner} onPointerDown={onHandleDown(primary, corner)} />
                                ))}
                                <button type="button" className="sb-node-x" aria-label="移出画布" onPointerDown={(event) => event.stopPropagation()} onClick={() => removeNodes([primary.id])}>
                                    <X className="size-3" strokeWidth={3} />
                                </button>
                                {doneList.length > 1 ? (
                                    <>
                                        <button type="button" className="sb-arrow" data-side="l" aria-label="上一张" onPointerDown={(event) => event.stopPropagation()} onClick={() => step(-1)}>
                                            <ChevronLeft className="size-4" />
                                        </button>
                                        <button type="button" className="sb-arrow" data-side="r" aria-label="下一张" onPointerDown={(event) => event.stopPropagation()} onClick={() => step(1)}>
                                            <ChevronRight className="size-4" />
                                        </button>
                                    </>
                                ) : null}
                                <span className="sb-scale">{primaryNatural ? `${(((primary.w * view.s) / primaryNatural.w) * 100).toFixed(1)}% · ${primaryNatural.w}×${primaryNatural.h}` : `${Math.round(view.s * 100)}%`}</span>
                                <motion.div ref={toolbarRef} className="sb-toolbar" onPointerDown={(event) => event.stopPropagation()} initial={reduced ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                                    <span className="sb-toolbar-order">生成的第 {primaryItem.order} 张</span>
                                    {TOOLS.map((tool, index) =>
                                        tool === "|" ? (
                                            <i key={`sep${index}`} />
                                        ) : (
                                            <button key={tool[0]} type="button" data-tone={tool[0] === "remove" ? "mute" : undefined} disabled={Boolean(working) && tool[0] === "noise"} onClick={() => runAction(tool[0], primary)}>
                                                {tool[1]}
                                            </button>
                                        ),
                                    )}
                                </motion.div>
                            </motion.div>
                        ) : null}
                    </AnimatePresence>

                    {marquee ? <div className="sb-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} /> : null}

                    <AnimatePresence>
                        {!nodes.length ? (
                            <motion.div className="sb-empty" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
                                <LayoutPanelTop className="size-7" strokeWidth={1.4} />
                                <strong>从右边把图拖进来</strong>
                                <p>点一张或拖几张进来就能并排看。拖图挪位置、拽四个角改大小、滚轮以光标为中心缩放；点「等大并排」所有图按同样大小铺开。</p>
                            </motion.div>
                        ) : null}
                    </AnimatePresence>

                    {working ? (
                        <div className="sb-working">
                            <LoaderCircle className="sp-spin size-4" />
                            {working}
                        </div>
                    ) : null}
                </div>

                <motion.button ref={arrangeRef} type="button" className="sb-arrange" disabled={!nodes.length} onClick={arrange} whileHover={reduced ? undefined : { y: -2 }} whileTap={{ scale: 0.94 }}>
                    <span className="sb-arrange-icon" aria-hidden>
                        <i />
                        <i />
                        <i />
                    </span>
                    等大并排
                    <kbd>⌘0</kbd>
                </motion.button>

                <div className="sb-keys" data-open={shortcuts || undefined}>
                    <button type="button" className="sb-keys-head" onClick={() => setShortcuts((value) => !value)}>
                        <Keyboard className="size-3.5" />
                        快捷键
                        <ChevronRight className="sb-keys-caret size-3" />
                    </button>
                    <AnimatePresence initial={false}>
                        {shortcuts ? (
                            <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                                {SHORTCUTS.map(([key, text]) => (
                                    <li key={key}>
                                        <kbd>{key}</kbd>
                                        <span>{text}</span>
                                    </li>
                                ))}
                            </motion.ul>
                        ) : null}
                    </AnimatePresence>
                </div>
            </div>

            <aside ref={side} className="sb-side">
                <header className="sb-side-head">
                    <span className="sb-side-count" role="status">
                        {selectingDownloads ? (
                            <>
                                已选 <strong>{selectedDownloadIds.length}</strong> 张
                            </>
                        ) : (
                            <>
                                <strong>{doneList.length}</strong> 张
                            </>
                        )}
                    </span>
                    <div className="sb-side-actions">
                        <button
                            type="button"
                            className="sb-btn"
                            aria-pressed={selectingDownloads}
                            data-on={selectingDownloads || undefined}
                            disabled={!selectingDownloads && !visibleDownloadIds.length}
                            onClick={() => setDownloadSelection((previous) => (previous ? null : new Set()))}
                        >
                            {selectingDownloads ? <X className="size-3.5" /> : <ListChecks className="size-3.5" />}
                            {selectingDownloads ? "退出多选" : "多选"}
                        </button>
                        {!selectingDownloads ? (
                            <button type="button" className="sb-btn" disabled={!visibleDownloadIds.length} onClick={() => downloadImages(visibleDownloadIds)}>
                                <Download className="size-3.5" />
                                下载全部
                            </button>
                        ) : null}
                    </div>
                </header>
                <div className="sb-side-filters">
                    <ShopDropdown width={190} label={typeFilter === "all" ? "全部类型" : typeFilter} className="sb-dd">
                        {(closeMenu) => (
                            <div className="sp-list sp-list-scroll">
                                {["all", ...types].map((value) => (
                                    <button key={value} type="button" className="sp-list-item" data-active={value === typeFilter || undefined} onClick={() => (setTypeFilter(value), closeMenu())}>
                                        <span>{value === "all" ? "全部类型" : value}</span>
                                        <small>{value === "all" ? items.length : items.filter((item) => item.label === value).length}</small>
                                    </button>
                                ))}
                            </div>
                        )}
                    </ShopDropdown>
                    <ShopDropdown width={160} label={TIMES.find(([value]) => value === time)?.[1]} className="sb-dd">
                        {(closeMenu) => (
                            <div className="sp-list">
                                {TIMES.map(([value, text]) => (
                                    <button key={value} type="button" className="sp-list-item" data-active={value === time || undefined} onClick={() => (setTime(value), closeMenu())}>
                                        <span>{text}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </ShopDropdown>
                    <button type="button" className="sb-btn sb-fav-filter" data-on={favOnly || undefined} onClick={() => setFavOnly((value) => !value)}>
                        <Star className="size-3.5" />
                        只看收藏
                    </button>
                </div>
                <div className="sb-thumbs">
                    <AnimatePresence initial={false}>
                        {panelItems.map((item, index) => {
                            const ready = item.status === "done" && Boolean(item.resourceId);
                            const picked = ready && Boolean(downloadSelection?.has(item.resourceId));
                            const placed = placedKeys.has(item.key);
                            return (
                                <motion.div
                                    key={item.key}
                                    layout={!reduced}
                                    className="sb-thumb-wrap"
                                    data-picking={selectingDownloads || undefined}
                                    data-picked={picked || undefined}
                                    initial={reduced ? false : { opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    transition={{ delay: Math.min(index, 18) * 0.015 }}
                                >
                                    <button
                                        type="button"
                                        className="sb-thumb"
                                        data-current={primary?.key === item.key || undefined}
                                        data-running={item.status === "running" || undefined}
                                        disabled={!ready}
                                        draggable={ready}
                                        onDragStart={(event: DragEvent) => event.dataTransfer.setData("text/x-shop-item", item.key)}
                                        onClick={() => {
                                            if (selectingDownloads) {
                                                toggleDownloadImage(item.resourceId);
                                                return;
                                            }
                                            const existing = nodes.find((node) => node.key === item.key);
                                            if (existing) setSelected([existing.id]);
                                            else place(item.key);
                                        }}
                                        aria-label={selectingDownloads ? `勾选第 ${index + 1} 张图片` : `将第 ${index + 1} 张图片放进画布`}
                                        aria-pressed={selectingDownloads ? picked : undefined}
                                        title={item.text}
                                    >
                                        {item.status === "done" ? (
                                            <img src={resourceVariantUrl(item.resourceId, "thumbnail")} alt="" draggable={false} />
                                        ) : (
                                            <span className="sb-thumb-wait">
                                                <LoaderCircle className="sp-spin size-4" />
                                                <small>{item.status === "loading" ? "正在读取作品" : item.label}</small>
                                            </span>
                                        )}
                                        {item.resourceId && favorites.has(item.resourceId) ? <Star className="sb-thumb-fav size-3" /> : null}
                                    </button>
                                    {ready ? (
                                        <button
                                            type="button"
                                            className="sb-thumb-pick"
                                            data-on-canvas={(!selectingDownloads && placed) || undefined}
                                            aria-label={`勾选第 ${index + 1} 张图片以下载`}
                                            aria-pressed={picked}
                                            title={!selectingDownloads && placed ? "已在画布 · 点击勾选下载" : picked ? "取消勾选" : "勾选下载"}
                                            onClick={() => toggleDownloadImage(item.resourceId)}
                                        >
                                            {picked ? <Check /> : !selectingDownloads && placed ? <LayoutPanelTop /> : null}
                                        </button>
                                    ) : null}
                                    {selectingDownloads && placed ? (
                                        <span className="sb-thumb-placed" title="已在画布" role="img" aria-label="已在画布">
                                            <LayoutPanelTop />
                                        </span>
                                    ) : null}
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                    {!panelItems.length ? <div className="sb-side-empty">没有符合条件的图</div> : null}
                </div>
                {selectingDownloads ? (
                    <footer className="sb-side-batch">
                        <Checkbox size="sm" checked={allVisibleSelected} indeterminate={!allVisibleSelected && visibleSelectedCount > 0} disabled={!visibleDownloadIds.length} onChange={toggleVisibleDownloads}>
                            全选可见
                        </Checkbox>
                        <button type="button" className="sb-btn sb-batch-download" disabled={!selectedDownloadIds.length} onClick={() => downloadImages(selectedDownloadIds)}>
                            <Download className="size-3.5" />
                            {selectedDownloadIds.length ? `下载 ${selectedDownloadIds.length} 张` : "批量下载"}
                        </button>
                    </footer>
                ) : null}
            </aside>

            <AnimatePresence>
                {menu ? (
                    <motion.div
                        className="sb-menu"
                        style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 380) }}
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ duration: 0.14 }}
                    >
                        {(
                            [
                                ["original", "查看原图 / 切回结果", "O"],
                                ["crop", "裁剪", "C"],
                                ["download", "下载原图", ""],
                                "|",
                                ["upscale", "高清放大", ""],
                                ["inpaint", "局部重绘", ""],
                                ["repaint", "智能重绘", ""],
                                ["cutout", "图片抠图", ""],
                                ["noise", "加噪点", ""],
                                "|",
                                ["use", "用这张图（放进输入框）", ""],
                                ["favorite", "收藏 / 取消收藏", ""],
                                ["remove", "移出画布", "Del"],
                                ["delete", "删除这张记录", "⌘⌫"],
                            ] as Array<[string, string, string] | "|">
                        ).map((entry, index) =>
                            entry === "|" ? (
                                <i key={`sep${index}`} />
                            ) : (
                                <button
                                    key={entry[0]}
                                    type="button"
                                    data-tone={entry[0] === "delete" ? "danger" : undefined}
                                    onClick={() => {
                                        const node = nodes.find((item) => item.id === menu.nodeId);
                                        if (node) runAction(entry[0], node);
                                    }}
                                >
                                    <span>{entry[1]}</span>
                                    {entry[2] ? <kbd>{entry[2]}</kbd> : null}
                                </button>
                            ),
                        )}
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <AnimatePresence>
                {intro ? (
                    <motion.div key="intro" className="sb-intro-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <motion.div
                            className="sb-intro"
                            initial={reduced ? false : { opacity: 0, y: 20, scale: 0.95, filter: "blur(6px)" }}
                            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: 12, scale: 0.97 }}
                            transition={{ type: "spring", stiffness: 320, damping: 30 }}
                        >
                            <h3>对照台</h3>
                            <p>把右边的图拖进来，几张并着看。每张是一张独立的图，可以各自摆位置、改大小。</p>
                            <dl>
                                {INTRO_ROWS.map(([title, text], index) => (
                                    <motion.div key={title} initial={reduced ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + index * 0.05 }}>
                                        <dt>{title}</dt>
                                        <dd>{text}</dd>
                                    </motion.div>
                                ))}
                            </dl>
                            <footer>
                                <span>
                                    <kbd>Esc</kbd> 关掉 · 顶栏「使用引导」随时重走一遍
                                </span>
                                <motion.button type="button" onClick={startTour} whileHover={reduced ? undefined : { scale: 1.03 }} whileTap={{ scale: 0.96 }}>
                                    知道了，带我走一遍
                                </motion.button>
                            </footer>
                        </motion.div>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <AnimatePresence>
                {tour !== null ? (
                    <motion.div key="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                        <BoardTour
                            step={tour}
                            rect={tourRect}
                            canNext={tour !== 0 || !doneList.length || doneList.every((item) => placedKeys.has(item.key))}
                            onNext={() => setTour((value) => (value === null || value >= TOUR.length - 1 ? null : value + 1))}
                            onPrev={() => setTour((value) => (value ? value - 1 : 0))}
                            onSkip={() => setTour(null)}
                        />
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <AnimatePresence>
                {edit && editItem && editNode ? (
                    edit.kind === "crop" ? (
                        <ShopCropModal
                            key="crop"
                            item={editItem}
                            natural={natural[editNode.key] || { w: Math.round(editNode.w), h: Math.round(editNode.h) }}
                            onClose={() => setEdit(null)}
                            onDone={async (blob, size) => {
                                const record = await addLocalShopEdit(scope, "crop", blob, { baseResourceId: editItem.resourceId, text: `${editItem.label} · 裁剪`, width: size.width, height: size.height });
                                queuePlacement(`e:${record.id}`, { beside: editNode.id });
                            }}
                        />
                    ) : (
                        <ShopEditModal
                            key="edit"
                            kind={edit.kind}
                            item={editItem}
                            natural={natural[editNode.key] || { w: Math.round(editNode.w), h: Math.round(editNode.h) }}
                            state={state}
                            onClose={() => setEdit(null)}
                            onSubmitted={(records: ShopEditRecord[]) => records.forEach((record) => queuePlacement(`e:${record.id}`, { beside: editNode.id }))}
                        />
                    )
                ) : null}
            </AnimatePresence>
        </motion.div>,
        document.body,
    );
}
