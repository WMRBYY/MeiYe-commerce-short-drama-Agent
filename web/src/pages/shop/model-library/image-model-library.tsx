import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { Check, LoaderCircle, Search, Star, Upload, UserRound, UserRoundPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { Select } from "@/components/ui/base/select";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { assertImageModelScope, listImageModels, saveImageModel, setImageModelFavorite, IMAGE_MODEL_FAVORITE, type ImageModelAsset } from "@/services/image-model-library";
import { useShopScope } from "../shop-context";
import { matchesImageModel, IMAGE_MODELS, IMAGE_MODEL_CATEGORIES, IMAGE_MODEL_LIMIT, type ImageModel } from "./image-model-catalog";
import "./image-model-library.css";
import "@/components/mode/mode-shell.css";

type ModelPick = { resourceId: string; name: string };
type Props = { open: boolean; max: number; current: ModelPick[]; disabled?: boolean; onClose: () => void; onPick: (items: ModelPick[]) => void | Promise<void> };
type Item = { id: string; name: string; preset?: ImageModel; asset?: ImageModelAsset };

async function presetFile(preset: ImageModel) {
    const response = await fetch(preset.image || preset.atlas);
    if (!response.ok) throw new Error("内置模特图片加载失败，请重试");
    const original = await response.blob();
    if (preset.image) return new File([original], `${preset.name}.png`, { type: original.type || "image/png" });
    const bitmap = await createImageBitmap(original);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(bitmap.width / 6);
        canvas.height = Math.floor(bitmap.height / 6);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器无法读取模特图片");
        context.drawImage(bitmap, (preset.column * bitmap.width) / 6, (preset.row * bitmap.height) / 6, bitmap.width / 6, bitmap.height / 6, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("模特图片读取失败"))), "image/png"));
        return new File([blob], `${preset.name}.png`, { type: "image/png" });
    } finally {
        bitmap.close();
    }
}

export function ImageModelLibrary(props: Props) {
    const scope = useShopScope();
    return <ModelLibrarySession key={scope} {...props} scope={scope} />;
}

function ModelLibrarySession({ open, max, current, disabled, onClose, onPick, scope }: Props & { scope: string }) {
    const { message } = App.useApp();
    const client = useQueryClient();
    const [source, setSource] = useState<"system" | "mine">("system");
    const [query, setQuery] = useState("");
    const [favOnly, setFavOnly] = useState(false);

    const [category, setCategory] = useState("modern");
    const [categoryOpen, setCategoryOpen] = useState(false);

    const [picked, setPicked] = useState<Item[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const input = useRef<HTMLInputElement>(null);
    const lock = useRef(false);
    const active = useRef(true);
    const ready = useRef(new Map<string, ImageModelAsset>());
    const room = Math.max(0, Math.min(IMAGE_MODEL_LIMIT - current.length, max));
    const limit = Math.min(IMAGE_MODEL_LIMIT, current.length + Math.max(0, max));
    const canManage = Boolean(scope) && scope !== "guest";
    const scopeValid = canManage && scope === getActiveUserScope();
    const queryKey = ["image-model-library", scope];
    const assets = useQuery({ queryKey, queryFn: ({ signal }) => listImageModels(scope, signal), enabled: open && scopeValid, retry: false, staleTime: 0 });

    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);
    useEffect(() => {
        if (!open) {
            setSource("system");
            setQuery("");
            setFavOnly(false);

            setCategory("modern");
            setCategoryOpen(false);
            setPicked([]);
            setError("");
        }
    }, [open]);

    const saved = scopeValid ? assets.data || [] : [];
    const presetAssets = new Map(saved.filter((asset) => asset.id.startsWith("image-model:")).map((asset) => [asset.id.slice("image-model:".length), asset]));
    const currentIds = new Set(current.map((item) => item.resourceId));
    const resourceId = (item: Item) => resourceIdFromStorageKey(item.asset?.data.storageKey) || "";
    const isCurrent = (item: Item) => Boolean(resourceId(item) && currentIds.has(resourceId(item)));
    const items: Item[] =
        source === "system"
            ? IMAGE_MODELS.filter((model) => matchesImageModel(model, query, "", "", category)).map((preset) => ({ id: preset.id, name: preset.name, preset, asset: presetAssets.get(preset.id) }))
            : saved.filter((asset) => asset.source === "image-model-upload" && asset.title.toLowerCase().includes(query.trim().toLowerCase())).map((asset) => ({ id: asset.id, name: asset.title, asset }));
    const visible = items.filter((item) => !favOnly || item.asset?.tags.includes(IMAGE_MODEL_FAVORITE));
    const close = () => {
        if (!lock.current) onClose();
    };
    const switchSource = (next: "system" | "mine") => {
        setSource(next);
        setQuery("");
    };
    const cacheAsset = (asset: ImageModelAsset) => {
        assertImageModelScope(scope);
        if (!active.current) return;
        const presetId = IMAGE_MODELS.find((model) => asset.id === `image-model:${model.id}`)?.id;
        if (presetId) ready.current.set(presetId, asset);
        client.setQueryData<ImageModelAsset[]>(queryKey, (list = []) => [asset, ...list.filter((entry) => entry.id !== asset.id)]);
        void client.invalidateQueries({ queryKey: ["asset-library"] });
    };
    const ensureAsset = async (item: Item) => {
        assertImageModelScope(scope);
        const systemAssetId = item.preset ? `image-model:${item.preset.id}` : item.asset?.id;
        const latest = client.getQueryData<ImageModelAsset[]>(queryKey)?.find((asset) => asset.id === systemAssetId);
        if (latest) return latest;
        if (item.asset) return item.asset;
        if (!item.preset) throw new Error("模特素材已失效，请重新选择");
        const cached = ready.current.get(item.preset.id) || presetAssets.get(item.preset.id);
        if (cached) return cached;
        // 首次使用系统模特前重新确认服务端状态，避免重复上传或覆盖已有收藏。
        const result = await assets.refetch();
        if (result.error) throw result.error;
        const existing = result.data?.find((asset) => asset.id === systemAssetId);
        if (existing) return existing;
        const file = await presetFile(item.preset);
        const asset = await saveImageModel(scope, file, item.preset.id);
        cacheAsset(asset);
        return asset;
    };
    const perform = async (task: () => Promise<void>) => {
        if (lock.current || disabled) return;
        if (!canManage || !scopeValid) {
            setError(!canManage ? "请先登录后使用模特库" : "账号已切换，请刷新页面后重试");
            return;
        }
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            await task();
        } catch (cause) {
            if (active.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试");
        } finally {
            lock.current = false;
            if (active.current) setBusy(false);
        }
    };
    const toggle = (item: Item) => {
        if (busy || disabled) return;
        if (!canManage || !scopeValid) {
            setError(!canManage ? "请先登录后使用模特库" : "账号已切换，请刷新页面后重试");
            return;
        }
        if (isCurrent(item)) return;
        if (picked.some((value) => value.id === item.id)) setPicked((list) => list.filter((value) => value.id !== item.id));
        else if (picked.length >= room) message.warning(`当前最多还能填入 ${room} 张模特图`);
        else setPicked((list) => [...list, item]);
    };
    const confirm = (list = picked) =>
        perform(async () => {
            if (!list.length || list.length > room) throw new Error(`当前最多还能填入 ${room} 张模特图，请调整选择`);
            const result: ModelPick[] = [];
            for (const item of list) {
                const asset = await ensureAsset(item);
                const id = resourceIdFromStorageKey(asset.data.storageKey);
                if (id && !currentIds.has(id) && !result.some((entry) => entry.resourceId === id)) result.push({ resourceId: id, name: asset.title });
            }
            assertImageModelScope(scope);
            if (!active.current) return;
            if (!result.length) throw new Error("这些模特已填入，请选择其他模特");
            await onPick(result);
            onClose();
        });
    const favorite = (item: Item) =>
        perform(async () => {
            const asset = await ensureAsset(item);
            cacheAsset(await setImageModelFavorite(scope, asset));
        });
    const upload = (files: File[]) =>
        perform(async () => {
            if (!files.length) return;
            const added: Item[] = [];
            const failures: string[] = [];
            for (const file of files.slice(0, IMAGE_MODEL_LIMIT)) {
                assertImageModelScope(scope);
                try {
                    const asset = await saveImageModel(scope, file);
                    cacheAsset(asset);
                    added.push({ id: asset.id, name: asset.title, asset });
                } catch (cause) {
                    failures.push(`${file.name}：${cause instanceof Error ? cause.message : "上传失败"}`);
                }
            }
            if (!active.current) return;
            if (files.length > IMAGE_MODEL_LIMIT) failures.push("每次最多上传 9 张，超出的图片未上传");
            if (added.length) {
                setSource("mine");
                setQuery("");
                setFavOnly(false);
                setPicked((list) => [...list, ...added].slice(0, room));
                message.success(`已保存 ${added.length} 张到我的模特`);
            }
            if (failures.length) throw new Error(failures.join("；"));
        });

    return (
        <AppModal open={open} flush centered footer={null} closable={false} onCancel={close} keyboard={!busy} mask={{ closable: !busy }} width="min(1180px, calc(100vw - 32px))" className="image-model-modal" aria-label="素材库 · 模特">
            <div className="smo ms-scope" aria-busy={busy}>
                <aside className="smo-side">
                    <h3>素材库</h3>
                    <small>来源</small>
                    <button type="button" className="smo-source" aria-pressed={source === "system"} onClick={() => switchSource("system")}>
                        <UserRound size={14} />
                        系统模特
                    </button>
                    <button type="button" className="smo-source" aria-pressed={source === "mine"} onClick={() => switchSource("mine")}>
                        <UserRoundPlus size={14} />
                        我的模特
                    </button>
                    <small>范围</small>
                    <label className="smo-favorite-only">
                        <input type="checkbox" checked={favOnly} onChange={(event) => setFavOnly(event.target.checked)} />
                        只看收藏
                    </label>
                </aside>
                <section className="smo-main">
                    <header className="smo-header">
                        <div className="smo-heading">
                            <h2>{source === "system" ? "系统模特" : "我的模特"}</h2>
                            <span>
                                将填入 <em>→ 模特</em>
                            </span>
                        </div>
                        <label className="smo-search">
                            <Search size={14} />
                            <input aria-label="搜索模特" placeholder="搜索" value={query} onChange={(event) => setQuery(event.target.value)} />
                        </label>

                        <button type="button" className="smo-close" aria-label="关闭模特库" onClick={close} disabled={busy}>
                            <X size={16} />
                        </button>
                    </header>
                    {source === "system" ? (
                        <div className="smo-filters">
                            <label>
                                人物分类
                                <Select
                                    ariaLabel="人物分类"
                                    appearance="field"
                                    className="smo-category-select"
                                    classNames={{ popup: { root: "ms-scope smo-category-menu" } }}
                                    value={category}
                                    open={categoryOpen}
                                    onOpenChange={setCategoryOpen}
                                    onChange={setCategory}
                                    showSearch={{ optionFilterProp: "label" }}
                                    listHeight={320}
                                    onInputKeyDown={(event) => {
                                        if (event.key === "Escape") {
                                            event.stopPropagation();
                                            setCategoryOpen(false);
                                        }
                                    }}
                                    options={[
                                        { value: "", label: `全部 · ${IMAGE_MODELS.length} 位` },
                                        ...IMAGE_MODEL_CATEGORIES.map((item) => ({ value: item.id, label: `${item.label} · ${item.style} · ${IMAGE_MODELS.filter((model) => model.category === item.id).length} 位` })),
                                    ]}
                                />
                            </label>
                        </div>
                    ) : null}

                    <div
                        className="smo-scroll"
                        onDragOver={(event) => {
                            if (source === "mine") event.preventDefault();
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (source === "mine") void upload(Array.from(event.dataTransfer.files));
                        }}
                    >
                        <div className="smo-grid">
                            {source === "mine" ? (
                                <button type="button" className="smo-upload" onClick={() => input.current?.click()} disabled={busy || disabled || !canManage || !scopeValid}>
                                    <span>{busy ? <LoaderCircle size={16} className="smo-spin" /> : <Upload size={16} />}</span>
                                    <strong>上传模特</strong>
                                    <small>使用你的模特进行创作</small>
                                </button>
                            ) : null}
                            {visible.map((item) => {
                                const selected = picked.some((entry) => entry.id === item.id);
                                const filled = isCurrent(item);
                                const favored = item.asset?.tags.includes(IMAGE_MODEL_FAVORITE) || false;
                                return (
                                    <div key={item.id} className="smo-card" data-selected={selected || undefined} data-current={filled || undefined}>
                                        <button
                                            type="button"
                                            className="smo-portrait"
                                            aria-label={item.name}
                                            aria-pressed={selected}
                                            disabled={busy || disabled || !canManage || !scopeValid || filled}
                                            onClick={() => toggle(item)}
                                            onDoubleClick={() => void confirm([item])}
                                            title={filled ? `${item.name} · 已填入` : item.name}
                                        >
                                            {item.preset?.image ? (
                                                <img src={item.preset.thumbnail || item.preset.image} alt={item.name} loading="lazy" decoding="async" />
                                            ) : item.preset ? (
                                                <span role="img" aria-label={item.name} className="smo-preset" style={{ backgroundImage: `url(${item.preset.atlas})`, backgroundPosition: `${item.preset.column * 20}% ${item.preset.row * 20}%` }} />
                                            ) : (
                                                <img src={resourceFileUrl(resourceId(item))} alt={item.name} loading="lazy" decoding="async" />
                                            )}
                                            {selected ? (
                                                <span className="smo-check">
                                                    <Check size={13} strokeWidth={3} />
                                                </span>
                                            ) : null}
                                            {filled ? <span className="smo-filled">已填入</span> : null}
                                            <span className="smo-card-name">{item.name}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="smo-star"
                                            aria-label={`${favored ? "取消收藏" : "收藏"}${item.name}`}
                                            aria-pressed={favored}
                                            onClick={() => void favorite(item)}
                                            disabled={busy || disabled || !canManage || !scopeValid}
                                        >
                                            <Star size={14} fill={favored ? "currentColor" : "none"} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        {source === "mine" && assets.isLoading ? (
                            <p className="smo-empty" role="status">
                                正在读取我的模特…
                            </p>
                        ) : !visible.length && !assets.isError && canManage ? (
                            <p className="smo-empty">{query || (source === "system" && category) ? "没有找到符合条件的模特" : favOnly ? "还没有收藏的模特" : "这里还没有素材，可以先从第一格本地上传"}</p>
                        ) : null}
                        {open && !scopeValid ? (
                            <p className="smo-error" role="alert">
                                {canManage ? "账号已切换，请刷新页面后重试" : "请先登录后使用模特库"}
                            </p>
                        ) : null}
                        {assets.isError ? (
                            <p className="smo-error" role="alert">
                                模特库读取失败，
                                <button type="button" onClick={() => void assets.refetch()}>
                                    点击重试
                                </button>
                            </p>
                        ) : null}
                    </div>
                    <input
                        ref={input}
                        type="file"
                        hidden
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        aria-label="上传模特图"
                        disabled={!canManage || !scopeValid}
                        onChange={(event) => {
                            const files = Array.from(event.target.files || []);
                            event.target.value = "";
                            void upload(files);
                        }}
                    />
                    {error ? (
                        <p className="smo-error" role="alert">
                            {error}
                        </p>
                    ) : null}
                    <footer className="smo-footer">
                        <span>
                            {busy ? "正在保存模特，请稍候…" : `单击选择，双击直接填入 · 最多 ${limit} 张`}
                            {!busy && current.length ? ` · 已填入 ${current.length} 张` : ""}
                            {!busy && room < IMAGE_MODEL_LIMIT ? ` · 当前可再填 ${room} 张` : ""}
                        </span>
                        <button type="button" className="smo-button" onClick={close} disabled={busy}>
                            取消
                        </button>
                        <button type="button" className="smo-button smo-confirm" onClick={() => void confirm()} disabled={busy || disabled || !canManage || !scopeValid || !picked.length || picked.length > room}>
                            填入模特{picked.length ? `（${picked.length}）` : ""}
                        </button>
                    </footer>
                </section>
            </div>
        </AppModal>
    );
}
