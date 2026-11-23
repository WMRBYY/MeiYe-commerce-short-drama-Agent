import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type ShopCanvasContextMenuScope = "canvas" | "node" | "selection";

export type ShopCanvasArrangeAction = "grid" | "masonry" | "row" | "column" | "align-left" | "align-center" | "align-right" | "align-top" | "align-middle" | "align-bottom" | "distribute-horizontal" | "distribute-vertical";

export interface ShopCanvasContextMenuState {
    scope: ShopCanvasContextMenuScope;
    x: number;
    y: number;
    selectedCount?: number;
    downloadableCount?: number;
    canGenerate?: boolean;
    canPaste?: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
}

export interface ShopCanvasContextMenuActions {
    onUpload?: () => void;
    onParseLinkUpload?: () => void;
    onAddNode?: () => void;
    onAddNote?: () => void;
    onAddCopy?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onPaste?: () => void;
    onDownload?: () => void;
    onGenerate?: () => void;
    onArrange?: (action: ShopCanvasArrangeAction) => void;
    onBringToFront?: () => void;
    onSendToBack?: () => void;
    onCopy?: () => void;
    onGroupCopy?: () => void;
    onOpenCreator?: () => void;
    onFlipHorizontal?: () => void;
    onFlipVertical?: () => void;
    onCopyToClipboard?: () => void;
    onDelete?: () => void;
}

export interface ShopCanvasContextMenuProps extends ShopCanvasContextMenuActions {
    menu: ShopCanvasContextMenuState | null;
    onClose: () => void;
}

type MenuItemProps = {
    label: string;
    icon: ReactNode;
    detail?: string;
    shortcut?: string;
    disabled?: boolean;
    danger?: boolean;
    chevron?: boolean;
    onClick?: () => void;
};

const menuSurface: CSSProperties = {
    position: "fixed",
    width: "min(280px, calc(100vw - 16px))",
    maxHeight: "calc(100dvh - 20px)",
    overflow: "hidden",
    border: "1px solid var(--ms-border)",
    borderRadius: "var(--r-lg)",
    background: "var(--ms-surface)",
    color: "var(--ms-text)",
    boxShadow: "var(--ms-shadow-pop)",
    padding: "var(--space-2)",
    zIndex: "var(--z-popover, 200)",
};

const rowStyle: CSSProperties = {
    display: "flex",
    width: "100%",
    minHeight: 44,
    alignItems: "center",
    gap: "var(--space-3)",
    border: 0,
    borderRadius: "var(--r-md)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    padding: "var(--space-2) var(--space-3)",
    textAlign: "left",
    font: "inherit",
};

const iconStyle: CSSProperties = {
    display: "grid",
    width: 20,
    height: 20,
    flex: "0 0 20px",
    placeItems: "center",
    color: "var(--ms-accent-strong)",
};

const sectionLabelStyle: CSSProperties = {
    padding: "var(--space-2) var(--space-3) var(--space-1)",
    color: "var(--ms-muted)",
    fontSize: "var(--fs-caption)",
    fontWeight: 600,
    letterSpacing: "0.04em",
};

function MenuDivider() {
    return <div role="separator" style={{ height: 1, margin: "5px 6px", background: "var(--ms-border)" }} />;
}

function MenuItem({ label, icon, detail, shortcut, disabled = false, danger = false, chevron = false, onClick }: MenuItemProps) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            type="button"
            role="menuitem"
            disabled={disabled}
            aria-disabled={disabled || undefined}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onClick}
            style={{
                ...rowStyle,
                background: hovered && !disabled ? "var(--ms-hover, #f2f7ef)" : "transparent",
                color: disabled ? "var(--ms-faint)" : danger ? "var(--ms-danger)" : "inherit",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.62 : 1,
            }}
        >
            <span style={{ ...iconStyle, color: disabled ? "inherit" : danger ? "currentColor" : undefined }}>{icon}</span>
            <span style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", gap: 1 }}>
                <span style={{ overflow: "hidden", fontSize: "var(--fs-body)", fontWeight: 600, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                {detail ? <span style={{ overflow: "hidden", color: "var(--ms-muted)", fontSize: "var(--fs-caption)", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span> : null}
            </span>
            {shortcut ? <kbd style={{ color: "var(--ms-muted)", fontSize: "var(--fs-label)", whiteSpace: "nowrap" }}>{shortcut}</kbd> : null}
            {chevron ? (
                <span aria-hidden="true" style={{ color: "var(--ms-muted)", fontSize: 14 }}>
                    ›
                </span>
            ) : null}
        </button>
    );
}

const arrangeItems: Array<{ action: ShopCanvasArrangeAction; label: string }> = [
    { action: "grid", label: "网格排列" },
    { action: "masonry", label: "瀑布流排列" },
    { action: "row", label: "横向排成一行" },
    { action: "column", label: "纵向排成一列" },
    { action: "align-left", label: "左对齐" },
    { action: "align-center", label: "水平居中" },
    { action: "align-right", label: "右对齐" },
    { action: "align-top", label: "顶部对齐" },
    { action: "align-middle", label: "垂直居中" },
    { action: "align-bottom", label: "底部对齐" },
    { action: "distribute-horizontal", label: "水平等距" },
    { action: "distribute-vertical", label: "垂直等距" },
];

/**
 * 电商画布专属上下文菜单。
 *
 * The parent owns the context-menu state and all mutations. This keeps the
 * menu reusable by /shop/canvas without coupling it to the shared creation
 * canvas or its node model.
 */
export function ShopCanvasContextMenu({ menu, onClose, ...actions }: ShopCanvasContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    const [position, setPosition] = useState({ x: menu?.x || 0, y: menu?.y || 0 });
    const [arrangeOpen, setArrangeOpen] = useState(false);

    useLayoutEffect(() => {
        if (!menu) return;
        setArrangeOpen(false);
    }, [menu]);

    useLayoutEffect(() => {
        if (!menu) return;
        const element = menuRef.current;
        if (!element) return;
        const place = () => {
            const edge = 8;
            setPosition({
                x: Math.max(edge, Math.min(menu.x, window.innerWidth - element.offsetWidth - edge)),
                y: Math.max(edge, Math.min(menu.y, window.innerHeight - element.offsetHeight - edge)),
            });
        };
        place();
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, [menu, arrangeOpen]);

    useLayoutEffect(() => {
        if (!menu) return;
        const closeOnPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
            onClose();
        };
        const closeOnKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("pointerdown", closeOnPointerDown);
        window.addEventListener("keydown", closeOnKeyDown);
        return () => {
            window.removeEventListener("pointerdown", closeOnPointerDown);
            window.removeEventListener("keydown", closeOnKeyDown);
        };
    }, [menu, onClose]);

    if (!menu) return null;

    const run = (callback?: () => void) => {
        if (!callback) return;
        callback();
        onClose();
    };
    const scope = menu.scope;
    const selectedCount = Math.max(1, menu.selectedCount || 1);
    const downloadableCount = Math.max(0, menu.downloadableCount || 0);
    const isSelection = scope === "selection" || (scope === "node" && selectedCount > 1);
    const canArrange = Boolean(actions.onArrange) && isSelection;

    return (
        <motion.div
            ref={menuRef}
            role="menu"
            aria-label={isSelection ? `已选 ${selectedCount} 个节点的菜单` : "电商画布上下文菜单"}
            data-canvas-context-menu
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            initial={reduced ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
            style={{ ...menuSurface, left: position.x, top: position.y, transformOrigin: "top left" }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div style={{ maxHeight: "calc(100dvh - 38px)", overflowY: "auto" }}>
                {scope === "canvas" ? (
                    <>
                        <div style={sectionLabelStyle}>画布操作</div>
                        <MenuItem icon={<ShopCanvasGlyph name="upload" size={16} />} label="上传素材" detail="从本地添加图片到画布" disabled={!actions.onUpload} onClick={() => run(actions.onUpload)} />
                        <MenuItem icon={<ShopCanvasGlyph name="link" size={16} />} label="解析链接上传" detail="解析商品图片或视频链接" disabled={!actions.onParseLinkUpload} onClick={() => run(actions.onParseLinkUpload)} />
                        <MenuItem icon={<ShopCanvasGlyph name="nodes" size={16} />} label="添加节点" disabled={!actions.onAddNode} onClick={() => run(actions.onAddNode)} />
                        <MenuItem icon={<ShopCanvasGlyph name="annotation" size={16} />} label="添加注释" detail="记录当前商品视觉想法" disabled={!actions.onAddNote} onClick={() => run(actions.onAddNote)} />
                        <MenuItem icon={<ShopCanvasGlyph name="text" size={16} />} label="添加文案" detail="添加标题、卖点或规格说明" disabled={!actions.onAddCopy} onClick={() => run(actions.onAddCopy)} />
                        <MenuDivider />
                        <MenuItem icon={<ShopCanvasGlyph name="undo" size={16} />} label="撤销" shortcut="Ctrl Z" disabled={!menu.canUndo || !actions.onUndo} onClick={() => run(actions.onUndo)} />
                        <MenuItem icon={<ShopCanvasGlyph name="redo" size={16} />} label="重做" shortcut="Ctrl Shift Z" disabled={!menu.canRedo || !actions.onRedo} onClick={() => run(actions.onRedo)} />
                        <MenuItem icon={<ShopCanvasGlyph name="clipboard" size={16} />} label="粘贴" shortcut="Ctrl V" disabled={!menu.canPaste || !actions.onPaste} onClick={() => run(actions.onPaste)} />
                    </>
                ) : (
                    <>
                        <div style={sectionLabelStyle}>{isSelection ? `已选 ${selectedCount} 个节点` : "节点操作"}</div>
                        <MenuItem
                            icon={<ShopCanvasGlyph name="download" size={16} />}
                            label={downloadableCount ? `下载 ${downloadableCount} 个资源` : "下载资源"}
                            detail={downloadableCount ? "逐个下载选中的电商素材" : "当前选区没有可下载资源"}
                            disabled={!downloadableCount || !actions.onDownload}
                            onClick={() => run(actions.onDownload)}
                        />
                        <MenuItem
                            icon={<ShopCanvasGlyph name="spark" size={16} />}
                            label={isSelection ? "批量生成" : "重新生成"}
                            detail={menu.canGenerate === false ? "当前节点缺少生成参数" : "使用电商模式模型生成"}
                            disabled={menu.canGenerate === false || !actions.onGenerate}
                            onClick={() => run(actions.onGenerate)}
                        />
                        <MenuItem icon={<ShopCanvasGlyph name="arrange-row" size={16} />} label="排列方式" detail={canArrange ? "网格、瀑布流、对齐与等距" : "至少选择两个节点"} chevron disabled={!canArrange} onClick={() => setArrangeOpen((open) => !open)} />
                        {arrangeOpen && canArrange ? (
                            <div role="menu" aria-label="排列方式" style={{ margin: "-2px 6px 5px 38px", borderLeft: "2px solid var(--ms-accent-soft)", paddingLeft: 4 }}>
                                {arrangeItems.map((item) => (
                                    <MenuItem
                                        key={item.action}
                                        icon={<ShopCanvasGlyph name="grid" size={14} />}
                                        label={item.label}
                                        onClick={() => {
                                            actions.onArrange?.(item.action);
                                            onClose();
                                        }}
                                    />
                                ))}
                            </div>
                        ) : null}
                        <MenuDivider />
                        <MenuItem icon={<ShopCanvasGlyph name="layer-front" size={16} />} label="置顶" disabled={!actions.onBringToFront} onClick={() => run(actions.onBringToFront)} />
                        <MenuItem icon={<ShopCanvasGlyph name="layer-back" size={16} />} label="置底" disabled={!actions.onSendToBack} onClick={() => run(actions.onSendToBack)} />
                        <MenuItem icon={<ShopCanvasGlyph name="spark" size={16} />} label="打开创作面板" detail="带入当前电商节点" disabled={!actions.onOpenCreator} onClick={() => run(actions.onOpenCreator)} />
                        <MenuItem icon={<span aria-hidden="true">↔</span>} label="水平翻转" disabled={!actions.onFlipHorizontal} onClick={() => run(actions.onFlipHorizontal)} />
                        <MenuItem icon={<span aria-hidden="true">↕</span>} label="垂直翻转" disabled={!actions.onFlipVertical} onClick={() => run(actions.onFlipVertical)} />
                        <MenuItem icon={<ShopCanvasGlyph name="duplicate" size={16} />} label={isSelection ? `复制 ${selectedCount} 个节点` : "复制节点"} shortcut="Ctrl C" disabled={!actions.onCopy} onClick={() => run(actions.onCopy)} />
                        <MenuItem icon={<ShopCanvasGlyph name="duplicate" size={16} />} label="组合复制" disabled={!actions.onGroupCopy} onClick={() => run(actions.onGroupCopy)} />
                        <MenuItem icon={<ShopCanvasGlyph name="clipboard" size={16} />} label="粘贴" shortcut="Ctrl V" disabled={!menu.canPaste || !actions.onPaste} onClick={() => run(actions.onPaste)} />
                        <MenuItem icon={<ShopCanvasGlyph name="clipboard" size={16} />} label="复制到剪贴板" disabled={!actions.onCopyToClipboard} onClick={() => run(actions.onCopyToClipboard)} />
                        <MenuItem icon={<ShopCanvasGlyph name="delete" size={16} />} label={isSelection ? `删除 ${selectedCount} 个节点` : "删除节点"} danger disabled={!actions.onDelete} onClick={() => run(actions.onDelete)} />
                    </>
                )}
            </div>
        </motion.div>
    );
}
