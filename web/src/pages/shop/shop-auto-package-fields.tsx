import { Button, Input } from "antd";
import { Check, Minus, Plus, ScanLine } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { CreditStar } from "@/components/ui/credit-star";
import { Select } from "@/components/ui/base/select";
import { AppModal } from "@/components/ui/product/app-modal";
import { displayImageSizeChoices, formatCommerceCredits, imageSizeLabel, languages, options, platforms } from "@/pages/ecommerce/catalog";
import type { EcommercePackageProduct, EcommercePackageSlot } from "@/services/api/ecommerce";

import "./shop-auto-package-fields.css";

const packagePlatforms = [
    ["taobao", "淘宝"],
    ["douyin", "抖音"],
    ["tiktok", "TikTok Shop"],
    ["amazon", "Amazon"],
    ["temu", "Temu"],
    ["shopee", "Shopee"],
    ["lazada", "Lazada"],
] as const;

export const packageLanguages = [
    ...languages,
    ["it", "意大利语"],
    ["nl", "荷兰语"],
    ["id", "印度尼西亚语"],
    ["ms", "马来语"],
    ["th", "泰语"],
    ["vi", "越南语"],
    ["fil", "菲律宾语"],
    ["hi", "印地语"],
    ["tr", "土耳其语"],
    ["pl", "波兰语"],
    ["sv", "瑞典语"],
    ["da", "丹麦语"],
    ["fi", "芬兰语"],
    ["el", "希腊语"],
    ["he", "希伯来语"],
    ["uk", "乌克兰语"],
    ["ro", "罗马尼亚语"],
    ["cs", "捷克语"],
] as const;

const packageLanguageOptions = options(packageLanguages);

type OutputControlsProps = {
    platform: string;
    onPlatformChange: (value: string) => void;
    mainRatios: string[];
    detailRatios: string[];
    onMainRatiosChange: (ratios: string[]) => void;
    onDetailRatiosChange: (ratios: string[]) => void;
    availableRatios: string[];
    model: ReactNode;
    maxCount?: number;
    showMain?: boolean;
    showDetail?: boolean;
    mainCountLocked?: boolean;
    detailCountLocked?: boolean;
    detailMinimum?: number;
    detailCountMode?: { automatic: boolean; onToggle: () => void };
    detailHint?: string;
};

export function PackageOutputControls({
    platform,
    onPlatformChange,
    mainRatios,
    detailRatios,
    onMainRatiosChange,
    onDetailRatiosChange,
    availableRatios,
    model,
    maxCount = 20,
    showMain = true,
    showDetail = true,
    mainCountLocked = false,
    detailCountLocked = false,
    detailMinimum,
    detailCountMode,
    detailHint,
}: OutputControlsProps) {
    const mainCount = showMain ? mainRatios.length : 0;
    const detailCount = showDetail ? detailRatios.length : 0;
    const savedPlatform = platforms.find(([id]) => id === platform && !packagePlatforms.some(([current]) => current === id));
    const platformOptions = savedPlatform ? [...packagePlatforms, savedPlatform] : packagePlatforms;
    return (
        <div className="sap-output">
            <div className="sap-output-row sap-model-row">
                <strong className="sap-output-label">模型</strong>
                <div className="sap-model">{model}</div>
            </div>
            <div className="sap-output-row">
                <strong className="sap-output-label">平台</strong>
                <div className="sap-platforms" role="group" aria-label="投放平台">
                    {platformOptions.map(([value, label]) => (
                        <button key={value} type="button" className="sap-platform" aria-pressed={platform === value} onClick={() => onPlatformChange(value)}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {showMain ? <PackageOutputRow label="主图" preferredRatio="1:1" ratios={mainRatios} available={availableRatios} maximum={maxCount - detailCount} minimum={detailCount ? 0 : 1} locked={mainCountLocked} onChange={onMainRatiosChange} /> : null}
            {showDetail ? (
                <PackageOutputRow
                    label="详情图"
                    preferredRatio="3:4"
                    ratios={detailRatios}
                    available={availableRatios}
                    maximum={maxCount - mainCount}
                    minimum={detailMinimum ?? (mainCount ? 0 : 1)}
                    locked={detailCountLocked}
                    countMode={detailCountMode}
                    hint={detailHint}
                    onChange={onDetailRatiosChange}
                />
            ) : null}
        </div>
    );
}

function RatioLabel({ label }: { label: string }) {
    const [width, height] = label.split(":").map(Number);
    const shape = width > 0 && height > 0 ? Math.max(width, height) : 0;
    return (
        <span className="sap-ratio-label">
            {shape > 0 ? <i aria-hidden="true" style={{ inlineSize: `${Math.max(5, (width / shape) * 14)}px`, blockSize: `${Math.max(5, (height / shape) * 14)}px` }} /> : null}
            {label}
        </span>
    );
}

function PackageOutputRow({
    label,
    preferredRatio,
    ratios,
    available,
    minimum,
    maximum,
    locked = false,
    countMode,
    hint,
    onChange,
}: {
    label: string;
    preferredRatio: string;
    ratios: string[];
    available: string[];
    minimum: number;
    maximum: number;
    locked?: boolean;
    countMode?: { automatic: boolean; onToggle: () => void };
    hint?: string;
    onChange: (ratios: string[]) => void;
}) {
    const ratioOptions = displayImageSizeChoices(available);
    const nextRatio = available.find((value) => imageSizeLabel(value) === preferredRatio) ?? available[0];
    return (
        <div className="sap-output-row sap-ratio-row">
            <strong className="sap-output-label">{label}</strong>
            <div className="sap-ratios" role="group" aria-label={`${label}张数与比例`}>
                {countMode?.automatic ? (
                    <output className="sap-count" data-locked aria-label={`${label}张数`}>
                        按参考分屏
                    </output>
                ) : (
                    <div className="sap-count" data-locked={locked || undefined}>
                        {!locked ? <Button type="text" size="small" icon={<Minus size={14} />} aria-label={`减少${label}张数`} disabled={ratios.length <= minimum} onClick={() => onChange(ratios.slice(0, -1))} /> : null}
                        <output aria-label={`${label}张数`}>{locked ? `${ratios.length} 张` : ratios.length}</output>
                        {!locked ? <Button type="text" size="small" icon={<Plus size={14} />} aria-label={`增加${label}张数`} disabled={ratios.length >= maximum || !nextRatio} onClick={() => onChange([...ratios, nextRatio])} /> : null}
                    </div>
                )}
                {!countMode?.automatic &&
                    ratios.map((ratio, index) => (
                        <Select<string>
                            key={index}
                            ariaLabel={`${label}第 ${index + 1} 张比例`}
                            className="sap-ratio-select"
                            appearance="field"
                            suffixIcon={null}
                            options={displayImageSizeChoices(available, ratio)}
                            optionRender={(option) => <RatioLabel label={String(option.label)} />}
                            labelRender={(option) => <RatioLabel label={String(option.label ?? imageSizeLabel(ratio))} />}
                            value={ratio}
                            onChange={(value) => onChange(ratios.map((current, position) => (position === index ? value : current)))}
                            disabled={ratioOptions.length < 2}
                            popupMatchSelectWidth={112}
                        />
                    ))}
                {!countMode?.automatic && ratios.length > 1 ? (
                    <Select<string | null>
                        ariaLabel={`统一设置${label}比例`}
                        className="sap-ratio-all"
                        appearance="field"
                        suffixIcon={null}
                        placeholder="全部改为"
                        options={ratioOptions}
                        optionRender={(option) => <RatioLabel label={String(option.label)} />}
                        onChange={(value) => {
                            if (value) onChange(ratios.map(() => value));
                        }}
                        value={null}
                        disabled={ratioOptions.length < 2}
                        popupMatchSelectWidth={112}
                    />
                ) : null}
                {countMode ? (
                    <Button size="small" type="text" onClick={countMode.onToggle}>
                        {countMode.automatic ? "指定张数" : "按参考分屏"}
                    </Button>
                ) : null}
                {hint ? <p className="sap-ratio-hint">{hint}</p> : null}
            </div>
        </div>
    );
}

export function PackageFooterControls({
    language,
    onLanguageChange,
    resolution,
    onResolutionChange,
    resolutions,
}: {
    language: string;
    onLanguageChange: (value: string) => void;
    resolution: string;
    onResolutionChange: (value: string) => void;
    resolutions: string[];
}) {
    return (
        <div className="sap-footer-controls">
            <Select<string>
                ariaLabel="文案语言"
                className="sap-language-select"
                appearance="pill"
                options={packageLanguageOptions}
                showSearch={{ optionFilterProp: ["label", "value"] }}
                value={language}
                optionLabelProp="label"
                labelRender={(option) => (
                    <span className="sap-footer-value">
                        <span>文案</span>
                        <b>{option.label}</b>
                    </span>
                )}
                onChange={onLanguageChange}
                popupMatchSelectWidth={190}
                placement="topLeft"
            />
            <Select<string>
                ariaLabel="分辨率"
                className="sap-resolution-select"
                appearance="pill"
                value={resolution}
                placeholder="分辨率"
                labelRender={(option) => (
                    <span className="sap-footer-value">
                        <span>分辨率</span>
                        <b>{option.label}</b>
                    </span>
                )}
                onChange={onResolutionChange}
                options={resolutions.length ? resolutions.map((value) => ({ label: value === "auto" ? "自动" : value.toUpperCase(), value })) : [{ label: "随模型", value: "auto" }]}
                disabled={resolutions.length < 2}
                popupMatchSelectWidth={128}
                placement="topLeft"
            />
        </div>
    );
}

type ProductField = { key: Exclude<keyof EcommercePackageProduct, "claims">; label: string; placeholder: string; limit: number };

const productGroups: { label: string; fields: ProductField[] }[] = [
    {
        label: "商品概况",
        fields: [
            { key: "productName", label: "商品名称", placeholder: "例如：便携式手持风扇", limit: 60 },
            { key: "category", label: "商品品类", placeholder: "例如：小家电", limit: 60 },
            { key: "brand", label: "品牌", placeholder: "例如：包装上的品牌名", limit: 60 },
        ],
    },
    {
        label: "商品规格",
        fields: [
            { key: "materials", label: "材质 / 成分", placeholder: "例如：ABS 塑料", limit: 200 },
            { key: "specifications", label: "规格参数", placeholder: "例如：5 V / 3 档风速", limit: 300 },
            { key: "packaging", label: "包装清单", placeholder: "例如：主机 × 1、数据线 × 1", limit: 200 },
        ],
    },
    {
        label: "如何呈现",
        fields: [
            { key: "style", label: "视觉风格", placeholder: "例如：留白、低饱和配色", limit: 200 },
            { key: "audience", label: "目标人群", placeholder: "例如：通勤人群、户外爱好者", limit: 200 },
            { key: "scene", label: "适用场景", placeholder: "例如：通勤、露营、办公室", limit: 200 },
        ],
    },
];

export function packageProductFieldCount(product: EcommercePackageProduct) {
    return productGroups.reduce((count, group) => count + group.fields.filter((field) => product[field.key].trim()).length, product.claims.trim() ? 1 : 0);
}

type ProductModalProps = {
    open: boolean;
    product: EcommercePackageProduct;
    outline: EcommercePackageSlot[];
    onComplete: (product: EcommercePackageProduct, outline: EcommercePackageSlot[]) => void;
    onClose: () => void;
    onRecognize: (product: EcommercePackageProduct, outline: EcommercePackageSlot[]) => void;
    recognizing: boolean;
    recognitionCost: number | null;
    recognitionError?: string;
    recognitionComplete?: boolean;
    canRecognize: boolean;
    recognitionBlockedReason?: string;
};

const outlineGroups = [
    ["main", "主图"],
    ["detail", "详情图"],
] as const;

export function PackageProductInfoModal({ open, product, outline, onComplete, onClose, onRecognize, recognizing, recognitionCost, recognitionError, recognitionComplete, canRecognize, recognitionBlockedReason }: ProductModalProps) {
    const [editedProduct, setEditedProduct] = useState(product);
    const [editedOutline, setEditedOutline] = useState(outline);
    const hasOutline = outline.some(({ title, description }) => Boolean(title || description));
    const [showOutline, setShowOutline] = useState(hasOutline);

    useEffect(() => {
        if (open) setEditedProduct(product);
    }, [open, product]);
    useEffect(() => {
        if (!open) return;
        setEditedOutline(outline);
        setShowOutline(hasOutline);
    }, [open, outline, hasOutline]);

    const updateProduct = (key: keyof EcommercePackageProduct, value: string) => setEditedProduct((current) => ({ ...current, [key]: value }));
    const updateOutline = (index: number, key: "title" | "description", value: string) => setEditedOutline((current) => current.map((slot, position) => (position === index ? { ...slot, [key]: value } : slot)));

    return (
        <AppModal open={open} flush centered title="商品信息" width={768} rootClassName="sap-info-dialog ms-scope" footer={null} mask={{ closable: false }} onCancel={onClose} classNames={{ header: "sap-info-dialog-heading" }}>
            <form
                className="sap-info-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!recognizing) onComplete(editedProduct, editedOutline);
                }}
            >
                <div className="sap-info-scroll">
                    <div className="sap-recognition">
                        <div className="sap-recognition-copy">
                            <ScanLine size={18} aria-hidden="true" />
                            <span>
                                <strong>从商品图识别</strong>
                                <small role={recognizing ? "status" : undefined}>
                                    {recognizing ? "电商 Agent 正在读取图片并拟定逐张内容…" : canRecognize ? "提取商品信息，并规划每张图的内容。" : recognitionBlockedReason || "添加商品图后可识别，或直接填写商品信息。"}
                                </small>
                            </span>
                        </div>
                        <Button loading={recognizing} disabled={!canRecognize} onClick={() => onRecognize(editedProduct, editedOutline)}>
                            {recognizing ? "识别中" : recognitionComplete || hasOutline ? "重新识别" : "自动识别"}
                            {recognitionCost !== null ? (
                                <span className="sap-recognition-credits">
                                    <CreditStar />
                                    {formatCommerceCredits(recognitionCost)} 积分
                                </span>
                            ) : null}
                        </Button>
                    </div>
                    {recognitionError ? (
                        <p role="alert" className="sap-info-feedback is-error">
                            {recognitionError}
                        </p>
                    ) : recognitionComplete && !recognizing ? (
                        <p role="status" className="sap-info-feedback">
                            <Check size={14} aria-hidden="true" />
                            识别完成，可以修改商品信息和逐图内容。
                        </p>
                    ) : null}
                    <div className="sap-product-fields">
                        {productGroups.map((group) => (
                            <fieldset key={group.label}>
                                <legend>{group.label}</legend>
                                <div className="sap-field-grid">
                                    {group.fields.map(({ key, label, placeholder, limit }) => (
                                        <label key={key} className="sap-field">
                                            <span>{label}</span>
                                            <Input variant="filled" value={editedProduct[key]} placeholder={placeholder} maxLength={limit} disabled={recognizing} onChange={(event) => updateProduct(key, event.target.value)} />
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        ))}
                        <label className="sap-field">
                            <strong>卖点</strong>
                            <Input.TextArea
                                variant="filled"
                                value={editedProduct.claims}
                                placeholder={"每行填写一个卖点，例如：\n小巧轻便，方便随身携带"}
                                autoSize={{ minRows: 3, maxRows: 5 }}
                                maxLength={1000}
                                disabled={recognizing}
                                onChange={(event) => updateProduct("claims", event.target.value)}
                            />
                        </label>
                    </div>
                    {showOutline ? (
                        <section className="sap-outline" aria-label="逐图内容">
                            <header>
                                <h3>逐图内容</h3>
                                <Button
                                    type="text"
                                    size="small"
                                    disabled={recognizing}
                                    onClick={() => {
                                        setShowOutline(false);
                                        setEditedOutline(editedOutline.map(({ kind, ratio }) => ({ kind, ratio })));
                                    }}
                                >
                                    不用大纲
                                </Button>
                            </header>
                            {outlineGroups.map(([kind, label]) => {
                                const group = editedOutline.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.kind === kind);
                                return group.length ? (
                                    <fieldset key={kind}>
                                        <legend>
                                            {label} <span>{group.length} 张</span>
                                        </legend>
                                        <ol>
                                            {group.map(({ slot, index }, position) => (
                                                <li key={index}>
                                                    <span className="sap-outline-index" aria-hidden="true">
                                                        {String(position + 1).padStart(2, "0")}
                                                    </span>
                                                    <Input
                                                        variant="filled"
                                                        aria-label={`${label}第 ${position + 1} 张标题`}
                                                        placeholder="标题"
                                                        value={slot.title ?? ""}
                                                        maxLength={80}
                                                        disabled={recognizing}
                                                        onChange={(event) => updateOutline(index, "title", event.target.value)}
                                                    />
                                                    <Input
                                                        variant="filled"
                                                        aria-label={`${label}第 ${position + 1} 张内容`}
                                                        placeholder="这张图要表现什么"
                                                        value={slot.description ?? ""}
                                                        maxLength={300}
                                                        disabled={recognizing}
                                                        onChange={(event) => updateOutline(index, "description", event.target.value)}
                                                    />
                                                </li>
                                            ))}
                                        </ol>
                                    </fieldset>
                                ) : null;
                            })}
                        </section>
                    ) : null}
                </div>
                <footer className="sap-info-footer">
                    <span aria-live="polite">已填 {packageProductFieldCount(editedProduct)} / 10 项</span>
                    <Button type="primary" htmlType="submit" disabled={recognizing}>
                        完成
                    </Button>
                </footer>
            </form>
        </AppModal>
    );
}
