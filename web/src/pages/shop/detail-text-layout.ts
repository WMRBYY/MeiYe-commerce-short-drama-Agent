import type { EcommerceImageTextDetection, EcommerceImageTextRegion } from "@/services/api/ecommerce-text";

/** Percentages belong to the intrinsic image wrapper, never the scroll viewport. */
export function detailTextBoxStyle(region: EcommerceImageTextRegion, image: Pick<EcommerceImageTextDetection, "width" | "height">) {
    const { x, y, width, height } = region.box;
    if (![x, y, width, height, image.width, image.height].every(Number.isFinite) || image.width <= 0 || image.height <= 0 || width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > image.width || y + height > image.height) return null;
    return { left: `${(x / image.width) * 100}%`, top: `${(y / image.height) * 100}%`, width: `${(width / image.width) * 100}%`, height: `${(height / image.height) * 100}%` };
}

export function detailTextEditInstruction(detection: EcommerceImageTextDetection, values: Record<string, string>) {
    const changes = detection.regions.filter((region) => values[region.id] !== undefined && values[region.id] !== region.text);
    if (!changes.length) throw new Error("请先修改或清空一行文字");
    return `原图尺寸 ${detection.width} × ${detection.height} 像素，左上角为坐标原点。仅执行以下文字修改，其余文字与画面保持不变。新文字沿原文字基线排版，匹配原字形；优先保持原字号，过长时仅在原文字区域内适度缩小。空文本表示彻底擦除该行并还原背景。\n${changes
        .map((region) => {
            const { x, y, width, height } = region.box;
            const replacement = values[region.id];
            return JSON.stringify({
                region: { x, y, width, height },
                original: region.text,
                action: replacement.trim() ? "replace" : "erase",
                replacement: replacement.trim() ? replacement : "",
                ...(region.fontFamily ? { matchFont: region.fontFamily } : {}),
            });
        })
        .join("\n")}`;
}
