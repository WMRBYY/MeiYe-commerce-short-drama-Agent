import type { ReactNode } from "react";

/** 电商 / 短剧模式的线稿图标：24×24，1.6 线宽，主线条 currentColor。 */
function Line({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            {children}
        </svg>
    );
}

export type RailIconName = "home" | "spark" | "detail" | "canvas" | "video" | "batch" | "folder" | "drama" | "image" | "skills" | "assets" | "tasks" | "settings" | "script" | "shop" | "chat" | "plugins";

export function RailIcon({ name, className }: { name: RailIconName; className?: string }) {
    switch (name) {
        case "home":
            return (
                <Line className={className}>
                    <path d="M3 11.5 12 4l9 7.5M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
                </Line>
            );
        case "spark":
            return (
                <Line className={className}>
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                </Line>
            );
        case "detail":
            return (
                <Line className={className}>
                    <path d="M4 6h16M7 12h10M10 18h4M6 4l2 16m8-16-2 16" />
                </Line>
            );
        case "canvas":
            return (
                <Line className={className}>
                    <path d="M4 6h16M4 12h16M4 18h16M6 4v16M18 4v16" />
                </Line>
            );
        case "video":
            return (
                <Line className={className}>
                    <path d="M15 10l4.5-2.3a1 1 0 0 1 1.5.9v6.8a1 1 0 0 1-1.5.9L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" />
                </Line>
            );
        case "batch":
            return (
                <Line className={className}>
                    <path d="M3 4h18M3 20h18M3 4v16M21 4v16M3 10h18M9 4v16" />
                </Line>
            );
        case "folder":
            return (
                <Line className={className}>
                    <path d="M4 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
                </Line>
            );
        case "drama":
            return (
                <Line className={className}>
                    <rect x="3" y="7" width="18" height="13" rx="2" />
                    <path d="m3.5 7 3-4M10 7l3-4M16.5 7l3-4M10.5 11.2l4 2.3-4 2.3z" />
                </Line>
            );
        case "image":
            return (
                <Line className={className}>
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="m3.5 16 5-5 4 4 2.5-2.5 5.5 5.5" />
                    <circle cx="15.5" cy="8.5" r="1.5" />
                </Line>
            );
        case "skills":
            return (
                <Line className={className}>
                    <path d="M12 3 4 7v10l8 4 8-4V7z" />
                    <path d="m4 7 8 4 8-4M12 11v10" />
                </Line>
            );
        case "assets":
            return (
                <Line className={className}>
                    <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 5h18v3H3zM10 12h4" />
                </Line>
            );
        case "tasks":
            return (
                <Line className={className}>
                    <path d="M9 6h11M9 12h11M9 18h11" />
                    <path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" />
                </Line>
            );
        case "script":
            return (
                <Line className={className}>
                    <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                    <path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 19h4" />
                </Line>
            );
        case "shop":
            return (
                <Line className={className}>
                    <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2M9.5 12a2.5 2.5 0 0 0 5 0" />
                </Line>
            );
        case "chat":
            return (
                <Line className={className}>
                    <path d="M4 5h16v11H9l-5 4z" />
                    <path d="M8 9.5h8M8 12.5h5" />
                </Line>
            );
        case "plugins":
            return (
                <Line className={className}>
                    <path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" />
                </Line>
            );
        case "settings":
        default:
            return (
                <Line className={className}>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                </Line>
            );
    }
}

/** 功能图标（首页工具条、功能下拉、生图功能列表）：带浅色填充的双色线稿。 */
export type ToolIconName =
    | "chat"
    | "outfit"
    | "views"
    | "pose"
    | "upscale"
    | "cutout"
    | "background"
    | "scene"
    | "face"
    | "head"
    | "smartface"
    | "repaint"
    | "inpaint"
    | "print"
    | "enhance"
    | "noise"
    | "color"
    | "detail"
    | "multi"
    | "multiOutfit"
    | "video"
    | "viral"
    | "talk"
    | "marketing"
    | "replace"
    | "dance"
    | "canvas"
    | "batch"
    | "script"
    | "storyboard"
    | "character"
    | "film";

const F = "var(--ms-icon-fill, currentColor)";

export function ToolIcon({ name, className }: { name: ToolIconName; className?: string }) {
    const body = (() => {
        switch (name) {
            case "chat":
                return (
                    <>
                        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" fill={F} fillOpacity={0.18} />
                        <path d="M8.5 9.5h.01M12 9.5h.01M15.5 9.5h.01" strokeWidth={2.4} />
                    </>
                );
            case "outfit":
                return (
                    <>
                        <path d="M8.5 4 5 6 3 10l3 1.5.5 8.5h11l.5-8.5L21 10l-2-4-3.5-2Q12 7 8.5 4Z" fill={F} fillOpacity={0.18} />
                    </>
                );
            case "views":
                return (
                    <>
                        <circle cx="6" cy="6.5" r="2" />
                        <circle cx="12" cy="6.5" r="2" />
                        <circle cx="18" cy="6.5" r="2" />
                        <path d="M4 20v-5a2 2 0 0 1 4 0v5M10 20v-5a2 2 0 0 1 4 0v5M16 20v-5a2 2 0 0 1 4 0v5" fill={F} fillOpacity={0.18} />
                    </>
                );
            case "pose":
                return (
                    <>
                        <circle cx="12" cy="4.5" r="1.8" />
                        <path d="m7 9 5 1.5L17 8M12 10.5v4.5l-3 5.5M12 15l3.5 5" />
                    </>
                );
            case "upscale":
                return (
                    <>
                        <rect x="4" y="4" width="16" height="16" rx="2.5" fill={F} fillOpacity={0.14} />
                        <path d="M9 15 15 9M10.5 9H15v4.5" />
                    </>
                );
            case "cutout":
                return (
                    <>
                        <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="2.4 2.4" />
                        <path d="M8 18v-2a4 4 0 0 1 8 0v2" fill={F} fillOpacity={0.2} />
                        <circle cx="12" cy="9.5" r="2.6" fill={F} fillOpacity={0.2} />
                    </>
                );
            case "background":
                return (
                    <>
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="m3.5 15 4.5-4.5 4 4L16 10l4.5 4.5" fill={F} fillOpacity={0.18} />
                        <circle cx="8" cy="8" r="1.4" />
                    </>
                );
            case "scene":
                return (
                    <>
                        <path d="M3 19 9 9l4 6 2.5-3.5L21 19z" fill={F} fillOpacity={0.18} />
                        <circle cx="17" cy="6" r="2" />
                    </>
                );
            case "face":
                return (
                    <>
                        <circle cx="12" cy="12" r="8" fill={F} fillOpacity={0.14} />
                        <circle cx="12" cy="12" r="4.5" />
                        <path d="M10.5 11h.01M13.5 11h.01" strokeWidth={2.2} />
                    </>
                );
            case "head":
                return (
                    <>
                        <circle cx="12" cy="8" r="4" fill={F} fillOpacity={0.18} />
                        <path d="M5 20a7 7 0 0 1 14 0" />
                    </>
                );
            case "smartface":
                return (
                    <>
                        <path d="M7 4.5A8 8 0 0 0 4.5 10M17 4.5A8 8 0 0 1 19.5 10M4.5 14a8 8 0 0 0 2.5 5.5M19.5 14a8 8 0 0 1-2.5 5.5" />
                        <circle cx="12" cy="12" r="4.5" fill={F} fillOpacity={0.18} />
                    </>
                );
            case "repaint":
                return (
                    <>
                        <rect x="3" y="4" width="18" height="15" rx="2" fill={F} fillOpacity={0.12} />
                        <path d="m3.5 15 5-5 4 4" />
                        <path d="m14 13 4.5-4.5a1.4 1.4 0 0 1 2 2L16 15l-2.5.5z" />
                    </>
                );
            case "inpaint":
                return (
                    <>
                        <path d="m14.5 4.5 5 5L9 20H4v-5z" fill={F} fillOpacity={0.16} />
                        <path d="M17 3v2M20 6h2M18.5 4.5l1.5-1.5" />
                    </>
                );
            case "print":
                return (
                    <>
                        <path d="M8.5 4 5 6 3 10l3 1.5.5 8.5h11l.5-8.5L21 10l-2-4-3.5-2Q12 7 8.5 4Z" />
                        <path d="m12 10.5 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" fill={F} fillOpacity={0.3} />
                    </>
                );
            case "enhance":
                return (
                    <>
                        <circle cx="12" cy="10" r="5" fill={F} fillOpacity={0.14} />
                        <path d="M7 20a5 5 0 0 1 10 0M18.5 3.5v3M17 5h3" />
                    </>
                );
            case "noise":
                return (
                    <>
                        <rect x="4" y="4" width="16" height="16" rx="3" />
                        <path d="M8 8h.01M12 8h.01M16 8h.01M10 12h.01M14 12h.01M8 16h.01M12 16h.01M16 16h.01" strokeWidth={2.4} />
                    </>
                );
            case "color":
                return (
                    <>
                        <path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.2-1.6l-.4-1a1.5 1.5 0 0 1 1.4-2H17a4 4 0 0 0 4-4c0-5-4-9.4-9-9.4z" fill={F} fillOpacity={0.14} />
                        <path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" strokeWidth={2.4} />
                    </>
                );
            case "detail":
                return (
                    <>
                        <rect x="5" y="3" width="14" height="18" rx="2" fill={F} fillOpacity={0.12} />
                        <path d="M8 7h8M8 11h8M8 15h5" />
                    </>
                );
            case "multi":
                return (
                    <>
                        <circle cx="8" cy="8" r="2.6" />
                        <circle cx="16" cy="8" r="2.6" />
                        <path d="M3.5 19a4.5 4.5 0 0 1 9 0M11.5 19a4.5 4.5 0 0 1 9 0" fill={F} fillOpacity={0.18} />
                    </>
                );
            case "multiOutfit":
                return (
                    <>
                        <path d="M6 6 3.5 7.5 2.5 10l2 1 .3 6h6.4l.3-6 2-1-1-2.5L10 6Q8 8 6 6Z" fill={F} fillOpacity={0.18} />
                        <path d="M15 5 12.5 6.5M15 5q2 2 4 0l2.5 1.5 1 2.5-2 1-.3 6H15" />
                    </>
                );
            case "video":
                return (
                    <>
                        <rect x="3" y="6" width="13" height="12" rx="2" fill={F} fillOpacity={0.16} />
                        <path d="m16 10 5-2.5v9L16 14" />
                    </>
                );
            case "viral":
                return (
                    <>
                        <path d="M4 13V9a1 1 0 0 1 1-1h3l7-4v16l-7-4H5a1 1 0 0 1-1-1z" fill={F} fillOpacity={0.16} />
                        <path d="M18 9.5a3.5 3.5 0 0 1 0 5" />
                    </>
                );
            case "talk":
                return (
                    <>
                        <rect x="9" y="3" width="6" height="11" rx="3" fill={F} fillOpacity={0.18} />
                        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                    </>
                );
            case "marketing":
                return (
                    <>
                        <path d="m3 11 15-6v14L3 13z" fill={F} fillOpacity={0.16} />
                        <path d="M7 13.5V18a1.5 1.5 0 0 0 3 0v-3.5M18 9.5h3M18 14.5h3" />
                    </>
                );
            case "replace":
                return (
                    <>
                        <rect x="3" y="5" width="11" height="14" rx="2" fill={F} fillOpacity={0.14} />
                        <path d="M17 8h4v8h-4M19 6l2 2-2 2" />
                    </>
                );
            case "dance":
                return (
                    <>
                        <circle cx="13" cy="4.5" r="1.8" />
                        <path d="m8 9 4-1.5 4 3M12 7.5l-1 6 3.5 3-1 4M11 13.5l-4 3" />
                        <path d="M18 15.5a2 2 0 1 0 0 .01M18 15.5V10l2 1" />
                    </>
                );
            case "canvas":
                return (
                    <>
                        <path d="M4 6h16M4 12h16M4 18h16M6 4v16M18 4v16" />
                    </>
                );
            case "batch":
                return (
                    <>
                        <path d="M3 4h18v16H3zM3 10h18M9 4v16" fill={F} fillOpacity={0.1} />
                    </>
                );
            case "script":
                return (
                    <>
                        <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill={F} fillOpacity={0.14} />
                        <path d="M8.5 12h7M8.5 15.5h7" />
                    </>
                );
            case "storyboard":
                return (
                    <>
                        <rect x="3" y="4" width="8" height="7" rx="1.5" fill={F} fillOpacity={0.16} />
                        <rect x="13" y="4" width="8" height="7" rx="1.5" />
                        <rect x="3" y="13" width="8" height="7" rx="1.5" />
                        <rect x="13" y="13" width="8" height="7" rx="1.5" fill={F} fillOpacity={0.16} />
                    </>
                );
            case "character":
                return (
                    <>
                        <circle cx="12" cy="8" r="3.5" fill={F} fillOpacity={0.18} />
                        <path d="M5 20a7 7 0 0 1 14 0M18 4l1 1.5L20.5 6 19 7l-1 1.5L17 7l-1.5-1L17 5.5z" />
                    </>
                );
            case "film":
            default:
                return (
                    <>
                        <rect x="3" y="4" width="18" height="16" rx="2" fill={F} fillOpacity={0.12} />
                        <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
                    </>
                );
        }
    })();
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            {body}
        </svg>
    );
}
