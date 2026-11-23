import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { ShopMediaMode } from "./shop-media-mode";

const ComposerHost = createContext<HTMLDivElement | null>(null);

/** 两种媒体只替换编辑内容，定位、尺寸与展开状态由同一个外壳持有。 */
export function ShopCreationDock({ mode, children }: { mode: "image" | "video"; children: ReactNode }) {
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [height, setHeight] = useState(0);
    const dock = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const element = dock.current;
        if (!element) return;
        const measure = () => setHeight(element.getBoundingClientRect().height);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <ComposerHost.Provider value={host}>
            <div className="sim-workspace ms-scope" style={{ "--sim-dock-height": `${height}px` } as CSSProperties}>
                {children}
                <div className="sim-creation-dock" ref={dock} data-expanded={expanded || undefined} data-collapsed={collapsed || undefined}>
                    <div className="sim-dock-head">
                        <ShopMediaMode value={mode} />
                        <button type="button" className="sim-collapse" aria-expanded={!collapsed} aria-controls="shop-creation-input" onClick={() => setCollapsed((value) => !value)}>
                            {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                            {collapsed ? "展开输入" : "收起输入"}
                        </button>
                    </div>
                    <div className="sim-composer-frame" id="shop-creation-input" inert={collapsed} aria-hidden={collapsed}>
                        <div className="sim-composer-host" ref={setHost} />
                        <button type="button" className="sim-expand" aria-label={expanded ? "缩小输入框" : "放大输入框"} aria-pressed={expanded} title={expanded ? "缩小输入框" : "放大输入框"} onClick={() => setExpanded((value) => !value)}>
                            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                        </button>
                    </div>
                </div>
            </div>
        </ComposerHost.Provider>
    );
}

export function ShopCreationPortal({ children }: { children: ReactNode }) {
    const host = useContext(ComposerHost);
    return host ? createPortal(<div className="sim-composer-content">{children}</div>, host) : null;
}

/** 提示词菜单脱离可滚动的编辑区，避免 @ 引用被紧凑外框裁掉。 */
export function ShopPromptPopup({ anchor, children }: { anchor: RefObject<HTMLElement | null>; children: ReactNode }) {
    const host = useContext(ComposerHost);
    const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
    useLayoutEffect(() => {
        const element = anchor.current;
        if (!host || !element) return;
        const measure = () => {
            const rect = element.getBoundingClientRect();
            const width = Math.min(320, window.innerWidth - 24);
            const above = rect.top > window.innerHeight - rect.bottom;
            setPosition({
                width,
                left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
                ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
                maxHeight: Math.max(80, Math.min(260, (above ? rect.top : window.innerHeight - rect.bottom) - 20)),
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [anchor, host]);
    return host
        ? createPortal(
              <div className="sim-prompt-popup ms-scope" style={position}>
                  {children}
              </div>,
              document.body,
          )
        : children;
}
