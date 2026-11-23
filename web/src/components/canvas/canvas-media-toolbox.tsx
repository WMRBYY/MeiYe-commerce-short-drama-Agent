import { BriefcaseBusiness, CircleHelp, Grid2X2, List, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { MANAGED_MEDIA_NODES, managedMediaNodeEnabled, type ManagedMediaNodeId } from "@/lib/media-conversion/managed-nodes";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const descriptions: Record<ManagedMediaNodeId, string> = {
    "image-remove-background": "一键去除白底或杂乱背景，保留透明主体",
    "image-upscale": "放大图片并改善纹理、边缘与细节",
    "psd-layers": "分离主体与背景，导出可编辑的双层 PSD",
    "video-replace-background": "保持主体动作，换成指定的新场景",
    "video-upscale": "提升低清视频的分辨率与细节",
    "image-expand": "扩展画面边界，补全自然的新区域",
};

export function CanvasMediaToolbox({ onChoose, onClose }: { onChoose: (id: ManagedMediaNodeId) => void; onClose: () => void }) {
    const enabled = useUserStore((state) => state.features.canvasNodesEnabled);
    const dark = useActiveTheme() === "dark";
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<"preset" | "personal">("preset");
    const [view, setView] = useState<"grid" | "list">("grid");
    const [showHelp, setShowHelp] = useState(false);
    const tools = useMemo(() => MANAGED_MEDIA_NODES.filter((item) => managedMediaNodeEnabled(item.id, enabled) && `${item.label} ${descriptions[item.id]}`.toLowerCase().includes(query.trim().toLowerCase())), [enabled, query]);

    return (
        <section className={`canvas-media-toolbox pointer-events-auto flex max-h-[calc(100dvh-96px)] w-[490px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[28px] border shadow-[0_24px_70px_rgba(0,0,0,.28)] ${dark ? "border-white/10 bg-[#1c1c1e] text-[#f5f5f5]" : "border-white/80 bg-[#f6f6f5] text-[#171717]"}`} aria-label="工具箱" onWheel={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <header className="flex shrink-0 items-center justify-between px-5 pt-5">
                <div className="flex items-center gap-2.5">
                    <h2 className="text-[17px] font-medium tracking-tight">工具箱</h2>
                    <div className={`flex rounded-full p-0.5 shadow-sm ${dark ? "bg-[#333336]" : "bg-white"}`} role="group" aria-label="展示方式">
                        <button type="button" className={`grid size-6 place-items-center rounded-full ${view === "list" ? dark ? "bg-[#505054]" : "bg-[#e9e9e7]" : ""}`} aria-label="列表展示" aria-pressed={view === "list"} onClick={() => setView("list")}><List className="size-3.5" /></button>
                        <button type="button" className={`grid size-6 place-items-center rounded-full ${view === "grid" ? dark ? "bg-[#505054]" : "bg-[#e9e9e7]" : ""}`} aria-label="网格展示" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 className="size-3.5" /></button>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button type="button" className="grid size-6 place-items-center" aria-label="工具箱帮助" onClick={() => setShowHelp((value) => !value)}><CircleHelp className="size-4" /></button>
                    <button type="button" className="grid size-6 place-items-center" aria-label="关闭工具箱" onClick={onClose}><X className="size-4" /></button>
                </div>
            </header>
            {showHelp ? <p className={`mx-5 mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed ${dark ? "bg-[#2b2b2d] text-[#c5c5c8]" : "bg-white text-[#555]"}`}>选择工具后，会在画布上创建输入、功能和使用说明组成的一组节点。上传自己的素材后，点击功能节点提交真实处理任务。</p> : null}
            <div className="mt-5 flex shrink-0 items-center justify-between gap-3 px-5">
                <div className="flex items-end gap-5 text-[14px]">
                    <button type="button" className={`border-b-2 pb-1.5 ${tab === "preset" ? dark ? "border-white font-medium" : "border-black font-medium" : dark ? "border-transparent text-[#a5a5a8]" : "border-transparent text-[#666]"}`} onClick={() => setTab("preset")}>预设</button>
                    <button type="button" className={`border-b-2 pb-1.5 ${tab === "personal" ? dark ? "border-white font-medium" : "border-black font-medium" : dark ? "border-transparent text-[#a5a5a8]" : "border-transparent text-[#666]"}`} onClick={() => setTab("personal")}>个人</button>
                </div>
                <label className={`flex h-9 w-[190px] max-w-[55%] items-center gap-2 rounded-full border px-3 ${dark ? "border-white/15 bg-[#29292b] text-[#aaa]" : "border-[#d8d8d6] bg-[#fbfbfa] text-[#999]"}`}>
                    <Search className="size-4 shrink-0" aria-hidden="true" />
                    <input className={`min-w-0 w-full bg-transparent text-xs outline-none ${dark ? "text-white placeholder:text-[#89898d]" : "text-[#333] placeholder:text-[#aaa]"}`} placeholder="按名称搜索工具箱" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索工具箱" />
                </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2" data-canvas-wheel-scroll>
                {tab === "personal" ? (
                    <div className={`grid min-h-56 place-content-center gap-2 text-center ${dark ? "text-[#a5a5a8]" : "text-[#777]"}`}><BriefcaseBusiness className="mx-auto size-8 opacity-50" /><span>个人工具暂未添加</span></div>
                ) : tools.length ? (
                    <div className={view === "grid" ? "grid grid-cols-3 gap-x-3 gap-y-4 max-[520px]:grid-cols-2" : "flex flex-col gap-2"}>
                        {tools.map((tool) => <button type="button" key={tool.id} className={view === "grid" ? "group min-w-0 text-left" : `group flex items-center gap-3 rounded-xl p-2 text-left ${dark ? "bg-[#29292b]" : "bg-white"}`} onClick={() => onChoose(tool.id)} aria-label={`添加${tool.label}`}>
                            <img src={`/toolbox/${tool.id}.webp`} alt="" className={view === "grid" ? "aspect-square w-full rounded-[15px] object-cover transition-transform group-hover:scale-[1.02]" : "size-[72px] shrink-0 rounded-lg object-cover"} />
                            <span className={view === "grid" ? `mt-1.5 block px-0.5 text-[13px] leading-snug ${dark ? "text-[#d0d0d2]" : "text-[#676767]"}` : "min-w-0"}>
                                <span className="block font-medium">{tool.label}</span>
                                {view === "list" ? <span className={`mt-1 block text-xs ${dark ? "text-[#a5a5a8]" : "text-[#888]"}`}>{descriptions[tool.id]}</span> : null}
                            </span>
                        </button>)}
                    </div>
                ) : <div className={`grid min-h-56 place-items-center ${dark ? "text-[#a5a5a8]" : "text-[#777]"}`}>没有找到匹配的工具</div>}
            </div>
        </section>
    );
}
