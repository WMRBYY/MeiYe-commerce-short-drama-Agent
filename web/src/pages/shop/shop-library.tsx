import { App } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight, LayoutTemplate, X } from "lucide-react";
import { useMemo, useState } from "react";

import { commerceModelCatalog, type CommerceModelProfile } from "@/pages/ecommerce/model-catalog";
import { GARMENT_REFERENCES, POSE_REFERENCES, referenceImageUrl, type ReferenceEntry } from "@/pages/ecommerce/tryon/reference-catalog";
import { tryOnFunction, type TryOnFunction, type TryOnSlotKey } from "@/pages/ecommerce/tryon/tryon-kinds";
import { switchTryOnFunction } from "@/pages/ecommerce/tryon/tryon-runtime";
import type { TryOnState } from "@/pages/ecommerce/tryon/use-tryon";

import { setShopFunction } from "./shop-context";

type Tab = "model" | "pose" | "garment";
const TABS: Array<{ id: Tab; label: string; slot: TryOnSlotKey; fallback: TryOnFunction }> = [
    { id: "model", label: "模特", slot: "model", fallback: "outfit" },
    { id: "pose", label: "姿势", slot: "pose", fallback: "pose" },
    { id: "garment", label: "服装", slot: "garment", fallback: "outfit" },
];

/** 模板推荐 · 系统素材库：模特 / 姿势 / 服装，点卡片填进当前功能对应的上传位。 */
/** 模特原图是 2MB 的 PNG，素材库里用 480px 缩略图，点选时仍用原图。 */
const thumbOf = (src: string) => (/^\/ecommerce-models\/[^/]+\.png$/.test(src) ? src.replace("/ecommerce-models/", "/ecommerce-models/thumbs/").replace(/\.png$/, ".jpg") : src);

export function ShopLibraryPanel({ state, allowed, open, onClose }: { state: TryOnState; allowed: TryOnFunction[]; open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const reduced = useReducedMotion();
    const [tab, setTab] = useState<Tab>("model");
    const [category, setCategory] = useState("全部");
    const entries = tab === "pose" ? POSE_REFERENCES : tab === "garment" ? GARMENT_REFERENCES : [];
    const categories = useMemo(() => {
        if (tab === "model") return [{ name: "全部", count: commerceModelCatalog.length }, ...["person", "mannequin"].map((kind) => ({ name: kind === "person" ? "真人" : "人台", count: commerceModelCatalog.filter((item) => item.kind === kind).length }))];
        const counts = new Map<string, number>();
        entries.forEach((entry) => counts.set(entry.category, (counts.get(entry.category) || 0) + 1));
        return [{ name: "全部", count: entries.length }, ...[...counts].slice(0, 8).map(([name, count]) => ({ name, count }))];
    }, [tab, entries]);
    const models = commerceModelCatalog.filter((item) => category === "全部" || (category === "真人" ? item.kind === "person" : item.kind === "mannequin"));
    const refs = entries.filter((entry) => category === "全部" || entry.category === category).slice(0, 60);

    const ensureSlot = (meta: (typeof TABS)[number]) => {
        if (tryOnFunction(state.draft.fn).slots.some((slot) => slot.key === meta.slot)) {
            // 对话生图下选素材：切回当前换装功能，素材才看得见。
            setShopFunction(state.draft.fn);
            return true;
        }
        if (!allowed.includes(meta.fallback)) {
            message.info(`当前功能没有「${meta.label}」上传位`);
            return false;
        }
        switchTryOnFunction(state.scope, meta.fallback);
        setShopFunction(meta.fallback);
        message.info(`已切换到「${tryOnFunction(meta.fallback).label}」`);
        return true;
    };
    const pickModel = (profile: CommerceModelProfile) => {
        if (ensureSlot(TABS[0])) void state.addCatalog("model", profile);
    };
    const pickRef = (entry: ReferenceEntry) => {
        const meta = TABS.find((item) => item.id === tab)!;
        if (!ensureSlot(meta)) return;
        void state
            .addReferences(meta.slot, [{ entry, angle: "front" }])
            .then(() => message.success(`已添加「${entry.title}」`))
            .catch((cause: unknown) => message.warning(cause instanceof Error ? cause.message : "添加失败"));
    };

    return (
        <AnimatePresence>
            {open ? (
                <motion.aside
                    className="sp-library"
                    initial={reduced ? false : { opacity: 0, y: 16, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.98 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                    <header className="sp-library-head">
                        <span className="sp-library-icon">
                            <LayoutTemplate className="size-3.5" />
                        </span>
                        <strong>系统素材库</strong>
                        <button type="button" className="sp-icon-btn" aria-label="关闭" onClick={onClose}>
                            <X className="size-3.5" />
                        </button>
                    </header>
                    <p className="sp-library-tip">
                        点击卡片填入参考图 <ChevronRight className="inline size-3" />
                    </p>
                    <div className="sp-library-tabs" role="tablist">
                        {TABS.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={tab === item.id}
                                data-active={tab === item.id || undefined}
                                onClick={() => {
                                    setTab(item.id);
                                    setCategory("全部");
                                }}
                            >
                                {tab === item.id ? <motion.i layoutId="sp-library-tab" className="sp-library-tab-pill" /> : null}
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="sp-library-cats">
                        {categories.map((item) => (
                            <button key={item.name} type="button" data-active={category === item.name || undefined} onClick={() => setCategory(item.name)}>
                                {item.name}
                                <em>{item.count}</em>
                            </button>
                        ))}
                    </div>
                    <motion.div key={`${tab}:${category}`} className="sp-library-grid" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
                        {tab === "model"
                            ? models.map((profile) => (
                                  <motion.button
                                      key={profile.id}
                                      type="button"
                                      className="sp-library-card"
                                      title={profile.description}
                                      onClick={() => pickModel(profile)}
                                      whileTap={reduced ? undefined : { scale: 0.94 }}
                                      transition={{ type: "spring", stiffness: 460, damping: 25 }}
                                  >
                                      <img src={thumbOf(profile.image)} alt={profile.name} loading="lazy" decoding="async" />
                                      <span>{profile.name}</span>
                                  </motion.button>
                              ))
                            : refs.map((entry) => (
                                  <motion.button
                                      key={entry.id}
                                      type="button"
                                      className="sp-library-card"
                                      title={entry.title}
                                      onClick={() => pickRef(entry)}
                                      whileTap={reduced ? undefined : { scale: 0.94 }}
                                      transition={{ type: "spring", stiffness: 460, damping: 25 }}
                                  >
                                      <img src={referenceImageUrl(entry)} alt={entry.title} loading="lazy" decoding="async" />
                                      <span>{entry.title}</span>
                                  </motion.button>
                              ))}
                    </motion.div>
                </motion.aside>
            ) : null}
        </AnimatePresence>
    );
}
