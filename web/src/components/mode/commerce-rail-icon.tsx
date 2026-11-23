import { useId, type ReactNode } from "react";

import { RailIcon, type RailIconName } from "./mode-icons";
import "./commerce-rail-icon.css";

// Filled silhouettes keep each destination recognizable at rail size; inner marks stay crisp on the selected gradient.
const artwork: Partial<Record<RailIconName, ReactNode>> = {
    home: (
        <>
            <path className="ms-commerce-icon-body" d="m3.5 10 7-6a2.3 2.3 0 0 1 3 0l7 6v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
            <path className="ms-commerce-icon-detail" d="M9 21v-6a3 3 0 0 1 6 0v6" />
            <path className="ms-commerce-icon-detail" d="M10 8h4" />
        </>
    ),
    spark: (
        <>
            <path className="ms-commerce-icon-body" d="M10.5 3.5c1.2 5.3 2.2 6.3 7.5 7.5-5.3 1.2-6.3 2.2-7.5 7.5C9.3 13.2 8.3 12.2 3 11c5.3-1.2 6.3-2.2 7.5-7.5Z" />
            <path className="ms-commerce-icon-satellite" d="M19 3v4m-2-2h4M19 17v4m-2-2h4" />
        </>
    ),
    batch: (
        <>
            <rect className="ms-commerce-icon-body" x="3" y="3" width="18" height="7" rx="2" />
            <rect className="ms-commerce-icon-body" x="3" y="13" width="7" height="8" rx="2" />
            <rect className="ms-commerce-icon-body" x="13" y="13" width="8" height="8" rx="2" />
            <path className="ms-commerce-icon-detail" d="M7 6.5h5M17 16v2m-1-1h2" />
        </>
    ),
    detail: (
        <>
            <rect className="ms-commerce-icon-body" x="5" y="2.5" width="14" height="19" rx="3" />
            <path className="ms-commerce-icon-detail" d="m8 11 2.5-3 2.5 2 1.5-1.5L16 11M8.5 15h7M8.5 18h4" />
        </>
    ),
    canvas: (
        <>
            <rect className="ms-commerce-icon-body" x="6" y="6" width="12" height="12" rx="3" />
            <path className="ms-commerce-icon-satellite" d="M7 2.5H4a1.5 1.5 0 0 0-1.5 1.5v3m14-4.5H20A1.5 1.5 0 0 1 21.5 4v3M7 21.5H4A1.5 1.5 0 0 1 2.5 20v-3m14 4.5H20a1.5 1.5 0 0 0 1.5-1.5v-3" />
            <path className="ms-commerce-icon-detail" d="M9.5 12h5M12 9.5v5" />
        </>
    ),
    video: (
        <>
            <path className="ms-commerce-icon-body" d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            <g className="ms-commerce-icon-clapper">
                <rect className="ms-commerce-icon-body" x="3" y="3" width="18" height="6" rx="1.5" />
                <path className="ms-commerce-icon-detail" d="m8 3-3 6m9-6-3 6m9-6-3 6" />
            </g>
            <path className="ms-commerce-icon-detail" d="m10 12 5 3-5 3Z" />
        </>
    ),
    script: (
        <>
            <path className="ms-commerce-icon-body" d="M5 3h10a2 2 0 0 1 2 2v12h4v2a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7H3V5a2 2 0 0 1 2-2Z" />
            <path className="ms-commerce-icon-detail" d="M5 3a2 2 0 0 1 2 2v2m10 10v2a2 2 0 0 0 2 2M10 8h4m-4 4h4m-4 4h2" />
        </>
    ),
    folder: (
        <>
            <path className="ms-commerce-icon-back" d="M3 10V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2" />
            <path className="ms-commerce-icon-body" d="M3 10h18l-1.5 9a2 2 0 0 1-2 1.5h-11a2 2 0 0 1-2-1.5Z" />
            <path className="ms-commerce-icon-detail" d="M9 14h6" />
        </>
    ),
};

export function CommerceRailIcon({ name }: { name: RailIconName }) {
    const gradientId = `commerce-icon-${useId().replace(/:/g, "")}`;
    if (!artwork[name]) return <RailIcon name={name} />;

    return (
        <svg className="ms-commerce-icon" data-icon={name} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id={gradientId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                    <stop className="ms-commerce-icon-stop-start" />
                    <stop className="ms-commerce-icon-stop-end" offset="1" />
                </linearGradient>
            </defs>
            <g fill={`url(#${gradientId})`} className="ms-commerce-icon-artwork">
                {artwork[name]}
            </g>
        </svg>
    );
}
