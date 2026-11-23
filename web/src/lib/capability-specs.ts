// Capability-spec helpers shared by the channel model editor projection and
// the image parameter tests. Moved out of the removed 前台模型 admin page.
import type { CapabilityImageSize, CapabilitySpec, OptionConstraint } from "@/services/api/logical-models";
import type { ChannelModel } from "@/services/api/wallet";
import { STANDARD_IMAGE_SIZE_VALUES } from "@/lib/model-capabilities";
import { imageSizePresets } from "@/lib/image-size-presets";
import { imageParameterConstraints, imageParametersForSpec, type ImageParameter } from "@/lib/image-parameters";

export type CapabilityKind = CapabilitySpec["capability"];


const inputDefinitions: Record<CapabilityKind, Array<{ name: string; label: string; unit: string }>> = {
    text: [
        { name: "image", label: "参考图片", unit: "张" },
        { name: "video", label: "参考视频", unit: "个" },
    ],
    image: [
        { name: "image", label: "参考图片", unit: "张" },
        { name: "mask", label: "蒙版", unit: "张" },
    ],
    video: [
        { name: "image", label: "参考图片", unit: "张" },
        { name: "video", label: "参考视频", unit: "个" },
        { name: "audio", label: "参考音频", unit: "个" },
    ],
    audio: [],
};

const optionDefinitions: Record<CapabilityKind, Array<{ name: string; label: string; unit?: string }>> = {
    text: [],
    image: [
        { name: "size", label: "画面尺寸或比例" },
        { name: "quality", label: "生成质量" },
        { name: "transparentBackground", label: "透明背景" },
        { name: "count", label: "输出数量", unit: "张" },
    ],
    video: [
        { name: "size", label: "画面比例" },
        { name: "videoSeconds", label: "视频时长", unit: "秒" },
        { name: "vquality", label: "输出分辨率" },
        { name: "videoGenerateAudio", label: "同步生成音频" },
        { name: "videoWatermark", label: "输出水印" },
    ],
    audio: [
        { name: "audioVoice", label: "音色" },
        { name: "audioFormat", label: "音频格式" },
        { name: "audioSpeed", label: "语速", unit: "倍" },
        { name: "audioInstructions", label: "朗读指令" },
    ],
};

function definitionsFor(capability: CapabilityKind, specs: CapabilitySpec[] = []): Array<{ name: string; label: string; unit?: string }> {
    if (capability !== "image" || !specs.some((spec) => spec.imageParameters)) return optionDefinitions[capability];
    return [...new Map(specs.flatMap((spec) => spec.imageParameters || []).map((p) => [p.name, { name: p.name, label: p.label }])).values()];
}

export function capabilityLabel(value: CapabilityKind) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频" }[value];
}

export function emptyCapabilitySpec(capability: CapabilityKind): CapabilitySpec {
    return { version: 1, capability, operations: [], inputs: {}, options: {} };
}

function imageSizeOptionValues(values: string[], allowCustom: boolean) {
    const concreteValues = Array.from(new Set(values.map((value) => String(normalizeScalar(value)).trim()).filter((value) => value && value !== "*")));
    const result = concreteValues.length || !allowCustom ? concreteValues : [...STANDARD_IMAGE_SIZE_VALUES];
    if (allowCustom) result.push("*");
    return result;
}

export function capabilitySpecFromChannelModel(item?: ChannelModel): CapabilitySpec | null {
    if (!item?.capability) return null;
    const capability = item.capability;
    if (capability === "text") {
        const text = item.capabilityConfig?.text;
        if (!text) return null;
        return {
            version: 1,
            capability,
            inputs: compactInputs({
                image: { min: 0, max: text.references.maxImages },
                video: { min: 0, max: text.references.maxVideos },
            }),
            options: {},
        };
    }
    if (capability === "image") {
        const image = item.capabilityConfig?.image;
        if (!image) return null;
        if (image.parameters)
            return {
                version: 1,
                capability,
                inputs: compactInputs({ image: { min: 0, max: image.references.maxImages }, mask: { min: 0, max: image.references.maskSupported ? 1 : 0 } }),
                imageParameters: image.parameters.map(({ binding: _binding, models: _models, encoding: _encoding, ...p }) => p),
                options: imageParameterConstraints(image.parameters),
                imageSize: image.size.parameter === "none" ? undefined : { parameter: image.size.parameter, allowCustom: image.size.allowCustom, presets: imageSizePresets(image) },
            };
        return {
            version: 1,
            capability,
            inputs: compactInputs({
                image: { min: 0, max: image.references.maxImages },
                mask: { min: 0, max: image.references.maskSupported ? 1 : 0 },
            }),
            options: compactOptions({
                size: image.size.parameter === "none" ? undefined : { values: imageSizeOptionValues(image.size.values, image.size.allowCustom) },
                quality: image.quality.supported ? { values: image.quality.values } : undefined,
                transparentBackground: { values: image.transparentBackground.supported ? [false, true] : [false] },
                count: { min: 1, max: image.maxOutputs, step: 1 },
            }),
            imageSize: image.size.parameter === "none" ? undefined : { parameter: image.size.parameter, allowCustom: image.size.allowCustom, presets: image.size.presets },
        };
    }
    if (capability === "video") {
        const video = item.capabilityConfig?.video;
        if (!video) return null;
        const duration: OptionConstraint = video.duration.selection === "enum" ? { values: video.duration.values || [] } : { min: video.duration.min, max: video.duration.max, step: video.duration.step };
        return {
            version: 1,
            capability,
            operations: video.operations,
            inputs: compactInputs({
                image: { min: video.references.minImages, max: video.references.maxImages },
                video: { min: 0, max: video.references.maxVideos },
                audio: { min: 0, max: video.references.maxAudios },
            }),
            options: compactOptions({
                videoSeconds: duration,
                size: { values: video.ratios },
                vquality: video.resolutions.length ? { values: video.resolutions } : undefined,
                videoGenerateAudio: { values: video.generateAudio.supported ? [false, true] : [false] },
                videoWatermark: { values: video.watermark.supported ? [false, true] : [false] },
            }),
        };
    }
    return emptyCapabilitySpec("audio");
}

export function mergeCapabilitySpecs(capability: CapabilityKind, specs: CapabilitySpec[]) {
    const matching = specs.filter((item) => item.capability === capability);
    if (matching.length === 0) return emptyCapabilitySpec(capability);
    const result = emptyCapabilitySpec(capability);
    result.operations = Array.from(new Set(matching.flatMap((item) => item.operations || [])));
    for (const definition of inputDefinitions[capability]) {
        const declared = matching.some((item) => item.inputs?.[definition.name]);
        if (declared) {
            const constraints = matching.map((item) => item.inputs?.[definition.name] || { min: 0, max: 0 });
            result.inputs![definition.name] = widestCoveredInputRange(constraints);
        }
    }
    for (const definition of definitionsFor(capability, matching)) {
        const constraints = matching.map((item) => item.options?.[definition.name]).filter(Boolean) as OptionConstraint[];
        if (constraints.length === 0) continue;
        if (constraints.some(isWildcardConstraint)) {
            const values = uniqueScalars(constraints.flatMap((item) => item.values || []));
            result.options![definition.name] = { values: definition.name === "size" ? imageSizeOptionValues(values.map(String), true) : values };
            continue;
        }
        if (constraints.every((item) => item.values)) {
            const values = uniqueScalars(constraints.flatMap((item) => item.values || []));
            result.options![definition.name] = { values: definition.name === "size" ? imageSizeOptionValues(values.map(String), values.includes("*")) : values };
            continue;
        }
        const minimums = constraints.map((item) => item.min).filter((value): value is number => typeof value === "number");
        const maximums = constraints.map((item) => item.max).filter((value): value is number => typeof value === "number");
        const steps = constraints.map((item) => item.step).filter((value): value is number => typeof value === "number" && value > 0);
        if (minimums.length && maximums.length) {
            const candidate = { min: Math.min(...minimums), max: Math.max(...maximums), step: steps.length ? Math.min(...steps) : undefined };
            if (optionConstraintCovered(candidate, definition.name, matching)) {
                result.options![definition.name] = candidate;
                continue;
            }
        }
        const enumValues = uniqueScalars(constraints.flatMap((item) => item.values || []));
        if (enumValues.length && optionConstraintCovered({ values: enumValues }, definition.name, matching)) {
            result.options![definition.name] = { values: enumValues };
            continue;
        }
        result.options![definition.name] = preferredSourceConstraint(constraints);
    }
    result.imageSize = mergeImageSize(matching);
    if (capability === "image" && matching.some((spec) => spec.imageParameters)) {
        const fields = new Map<string, ImageParameter>();
        const conflicts = new Set<string>();
        for (const field of matching.flatMap((spec) => spec.imageParameters || []).filter((p) => p.enabled !== false)) {
            const previous = fields.get(field.name);
            if (previous && previous.type !== field.type) conflicts.add(field.name);
            fields.set(field.name, previous ? { ...previous, pricing: Boolean(previous.pricing && field.pricing) } : field);
        }
        for (const name of conflicts) {
            fields.delete(name);
            delete result.options![name];
        }
        result.imageParameters = [...fields.values()];
        result.imageParameters = imageParametersForSpec(result);
    }
    return result;
}

function mergeImageSize(specs: CapabilitySpec[]): CapabilityImageSize | undefined {
    const parts = specs.map((item) => item.imageSize).filter((item): item is CapabilityImageSize => Boolean(item));
    if (!parts.length) return undefined;
    const parameters = [...new Set(parts.map((item) => item.parameter).filter((value): value is NonNullable<CapabilityImageSize["parameter"]> => Boolean(value)))];
    const presets = [...new Map(parts.flatMap((item) => item.presets || []).map((preset) => [`${preset.tier}:${preset.ratio}:${preset.size}`, preset])).values()];
    return {
        parameter: parameters.includes("aspect_ratio") ? "aspect_ratio" : parameters[0],
        allowCustom: parts.some((item) => item.allowCustom),
        presets,
    };
}

/**
 * 旧版本把“允许自定义”保存成只有 `*` 的能力范围。
 * 管理端编辑时用当前供应线路的标准值补回展示范围，保存后即可完成数据修复。
 */
export function normalizeCapabilitySpecForSources(value: CapabilitySpec | undefined, sourceSpecs: CapabilitySpec[]) {
    if (!value) return value;
    const source = mergeCapabilitySpecs(value.capability, sourceSpecs);
    if (value.capability === "image" && source.imageParameters) {
        const options = Object.fromEntries(
            Object.entries(source.options || {}).flatMap(([name, available]) => {
                const selected = value.options?.[name];
                if (!selected && value.imageParameters?.some((p) => p.name === name)) return [];
                if (!selected) return [[name, available]];
                if (selected.values && available.values && !isWildcardConstraint(available)) {
                    const values = selected.values.filter((v) => available.values!.some((a) => scalarKey(a) === scalarKey(v)));
                    return values.length ? [[name, { values }]] : [];
                }
                return [[name, optionConstraintCovered(selected, name, sourceSpecs) ? selected : available]];
            }),
        );
        const next = { ...value, options, imageSize: source.imageSize, imageParameters: source.imageParameters };
        return { ...next, imageParameters: imageParametersForSpec(next) };
    }
    const options = { ...(value.options || {}) };
    for (const [name, constraint] of Object.entries(options)) {
        const sourceConstraint = source.options?.[name];
        if (!sourceConstraint || !isWildcardConstraint(constraint) || !sourceConstraint.values) continue;
        options[name] = { values: uniqueScalars([...(sourceConstraint.values || []), ...(constraint.values || [])]) };
    }
    return { ...value, options, imageSize: value.imageSize?.presets?.length ? value.imageSize : source.imageSize || value.imageSize };
}


function uniqueScalars(values: unknown[]) {
    const byKey = new Map(values.map((value) => [scalarKey(value), value]));
    return Array.from(byKey.values());
}

function widestCoveredInputRange(constraints: Array<{ min: number; max: number }>) {
    const sorted = [...constraints].sort((left, right) => left.min - right.min || left.max - right.max);
    const merged: Array<{ min: number; max: number }> = [];
    for (const constraint of sorted) {
        const previous = merged.at(-1);
        if (previous && constraint.min <= previous.max + 1) previous.max = Math.max(previous.max, constraint.max);
        else merged.push({ ...constraint });
    }
    return merged.reduce((best, current) => {
        const bestSize = best.max - best.min;
        const currentSize = current.max - current.min;
        return currentSize > bestSize || (currentSize === bestSize && current.min < best.min) ? current : best;
    });
}

function preferredSourceConstraint(constraints: OptionConstraint[]) {
    return constraints.reduce((best, current) => (constraintBreadth(current) > constraintBreadth(best) ? current : best));
}

function constraintBreadth(constraint: OptionConstraint) {
    if (constraint.values) return constraint.values.length;
    if (constraint.min === undefined || constraint.max === undefined) return 0;
    if (!constraint.step) return constraint.max - constraint.min + 1;
    return Math.floor((constraint.max - constraint.min) / constraint.step + 1e-9) + 1;
}

function scalarKey(value: unknown) {
    const normalized = normalizeScalar(value);
    return `${typeof normalized}:${String(normalized)}`;
}

function scalarLabel(value: unknown) {
    const normalized = normalizeScalar(value);
    if (normalized === true) return "支持";
    if (normalized === false) return "不启用";
    if (normalized === "*") return "自定义";
    return String(normalized);
}

function normalizeScalar(value: unknown) {
    if (typeof value === "string" && value.startsWith("string:")) return value.slice("string:".length);
    return value;
}

function inputLabel(capability: CapabilityKind, name: string) {
    return inputDefinitions[capability].find((item) => item.name === name)?.label || name;
}

function optionLabel(capability: CapabilityKind, name: string) {
    return optionDefinitions[capability].find((item) => item.name === name)?.label || name;
}

function constraintSummary(constraint: OptionConstraint, unit = "") {
    if (constraint.values) return `线路支持 ${constraint.values.map(scalarLabel).join("、")}`;
    return `线路支持 ${constraint.min}-${constraint.max}${unit}${constraint.step ? `，步进 ${constraint.step}` : ""}`;
}

function constraintIncludes(constraint: OptionConstraint, value: unknown) {
    if (isWildcardConstraint(constraint)) return true;
    if (constraint.values) return constraint.values.some((item) => scalarKey(item) === scalarKey(value));
    if (typeof value !== "number") return false;
    if ((constraint.min !== undefined && value < constraint.min - 1e-9) || (constraint.max !== undefined && value > constraint.max + 1e-9)) return false;
    if (!constraint.step || constraint.min === undefined) return true;
    return approximatelyInteger((value - constraint.min) / constraint.step);
}

function inputConstraintCovered(candidate: { min: number; max: number }, name: string, sourceSpecs: CapabilitySpec[]) {
    let next = candidate.min;
    while (next <= candidate.max) {
        let coveredUntil = next - 1;
        for (const spec of sourceSpecs) {
            const constraint = spec.inputs?.[name] || { min: 0, max: 0 };
            if (constraint.min <= next && constraint.max >= next && constraint.max > coveredUntil) coveredUntil = constraint.max;
        }
        if (coveredUntil < next) return false;
        next = coveredUntil + 1;
    }
    return true;
}

function optionConstraintCovered(candidate: OptionConstraint, name: string, sourceSpecs: CapabilitySpec[]) {
    const constraints = sourceSpecs.map((item) => item.options?.[name]).filter((item): item is OptionConstraint => Boolean(item));
    if (!constraints.length) return false;
    if (constraints.some(isWildcardConstraint)) return true;
    if (candidate.values) return candidate.values.every((value) => optionValueSupported(value, constraints));
    if (candidate.min === undefined || candidate.max === undefined) return false;
    if (Math.abs(candidate.max - candidate.min) < 1e-9) return optionValueSupported(candidate.min, constraints);
    if (candidate.step === undefined) return continuousOptionRangeCovered(candidate.min, candidate.max, constraints);
    if (candidate.step <= 0) return false;
    const count = Math.floor((candidate.max - candidate.min) / candidate.step + 1e-9) + 1;
    if (count <= 10_000) {
        for (let index = 0; index < count; index += 1) {
            if (!optionValueSupported(candidate.min + index * candidate.step, constraints)) return false;
        }
        return true;
    }
    const candidateMin = candidate.min;
    const candidateMax = candidate.max;
    const candidateStep = candidate.step;
    return constraints.some((constraint) => {
        if (constraint.min === undefined || constraint.max === undefined || constraint.min > candidateMin || constraint.max < candidateMax) return false;
        if (!constraint.step) return true;
        return approximatelyInteger((candidateMin - constraint.min) / constraint.step) && approximatelyInteger(candidateStep / constraint.step);
    });
}

function optionValueSupported(value: unknown, constraints: OptionConstraint[]) {
    return constraints.some((constraint) => constraintIncludes(constraint, value));
}

function continuousOptionRangeCovered(minimum: number, maximum: number, constraints: OptionConstraint[]) {
    const ranges = constraints
        .filter((constraint) => constraint.min !== undefined && constraint.max !== undefined && constraint.step === undefined)
        .map((constraint) => ({ min: constraint.min!, max: constraint.max! }))
        .sort((left, right) => left.min - right.min);
    let coveredUntil = minimum;
    let started = false;
    for (const range of ranges) {
        if (range.max < minimum - 1e-9) continue;
        if (!started) {
            if (range.min > minimum + 1e-9) return false;
            coveredUntil = Math.max(coveredUntil, range.max);
            started = true;
        } else if (range.min <= coveredUntil + 1e-9) {
            coveredUntil = Math.max(coveredUntil, range.max);
        } else {
            break;
        }
        if (coveredUntil >= maximum - 1e-9) return true;
    }
    return false;
}

function isWildcardConstraint(constraint: OptionConstraint) {
    return constraint.values?.some((value) => normalizeScalar(value) === "*") || false;
}

function approximatelyInteger(value: number) {
    return Math.abs(value - Math.round(value)) < 1e-9;
}

function compactInputs(values: Record<string, { min: number; max: number }>) {
    return Object.fromEntries(Object.entries(values).filter(([, constraint]) => constraint.max > 0 || constraint.min > 0));
}

function compactOptions(values: Record<string, OptionConstraint | undefined>) {
    return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, OptionConstraint] => Boolean(entry[1])));
}

