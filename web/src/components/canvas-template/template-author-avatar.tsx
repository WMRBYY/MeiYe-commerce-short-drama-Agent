import { useState, useEffect } from "react";
import { UserAvatar } from "@/components/layout/user-avatar";
import type { LocalUser } from "@/stores/use-user-store";

import { canvasTemplateMediaUrl } from "@/services/api/canvas-templates";

/** 作者头像：只渲染后端白名单内的头像地址，加载失败或缺省时显示昵称首字。 */
export function TemplateAuthorAvatar({ name, url, size = 28, className = "", avatarMode, avatarPreset }: { name: string; url?: string; size?: number; className?: string; avatarMode?: string; avatarPreset?: string }) {
    const [failed, setFailed] = useState(false);
    const src = !failed && url ? canvasTemplateMediaUrl(url) : "";
    const initial = Array.from(name.trim())[0] || "M";
    useEffect(() => setFailed(false), [url]);
    if (avatarMode === "default" || !url)
        return (
            <span style={{ width: size, height: size }} className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`}>
                <UserAvatar user={{ displayName: name, avatarMode: "default", avatarPreset } as LocalUser} className="size-full" iconClassName="p-1" />
            </span>
        );
    return (
        <span
            className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#5b8cff] to-[#9b6bff] font-semibold text-white ${className}`}
            style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
            aria-hidden
        >
            {src ? <img src={src} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} /> : initial}
        </span>
    );
}
