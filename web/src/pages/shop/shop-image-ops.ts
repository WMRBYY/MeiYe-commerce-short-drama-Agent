import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";

/** 对照台在浏览器里完成的图片加工：裁剪、加噪点、局部重绘的标注图。 */

const MAX_SIDE = 4096;

export async function loadBitmap(resourceId: string) {
    const blob = await getResourceBlob(resourceStorageKey(resourceId), "browser-process");
    if (!blob) throw new Error("读取原图失败，请稍后重试");
    return createImageBitmap(blob);
}

function canvasOf(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持图片处理");
    context.imageSmoothingQuality = "high";
    return { canvas, context };
}

export function canvasBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("导出图片失败"))), type, quality));
}

/** rect 为相对整张图的比例 [0,1]。 */
export async function cropImage(resourceId: string, rect: { x: number; y: number; w: number; h: number }) {
    const bitmap = await loadBitmap(resourceId);
    try {
        const sx = Math.round(rect.x * bitmap.width);
        const sy = Math.round(rect.y * bitmap.height);
        const sw = Math.max(1, Math.round(rect.w * bitmap.width));
        const sh = Math.max(1, Math.round(rect.h * bitmap.height));
        const { canvas, context } = canvasOf(sw, sh);
        context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        return { blob: await canvasBlob(canvas), width: sw, height: sh };
    } finally {
        bitmap.close();
    }
}

/** 加一层细腻的单色胶片颗粒，让 AI 图更像相机实拍。amount 为 0–1。 */
export async function noiseImage(resourceId: string, amount = 0.07) {
    const bitmap = await loadBitmap(resourceId);
    try {
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const { canvas, context } = canvasOf(bitmap.width * scale, bitmap.height * scale);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = image.data;
        const strength = 255 * amount;
        for (let index = 0; index < data.length; index += 4) {
            // 三个均匀分布相加近似高斯分布，颗粒更自然。
            const grain = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2 * strength;
            data[index] = Math.max(0, Math.min(255, data[index] + grain));
            data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + grain));
            data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + grain));
        }
        context.putImageData(image, 0, 0);
        return { blob: await canvasBlob(canvas, "image/jpeg", 0.95), width: canvas.width, height: canvas.height };
    } finally {
        bitmap.close();
    }
}

/**
 * 局部重绘的标注图：原图上叠半透明红色涂抹区域与用户画的涂鸦线条。
 * 模型对遮罩通道的支持不一，用一张看得见标记的参考图最稳妥。
 */
export async function annotateImage(resourceId: string, mask: HTMLCanvasElement | null, doodle: HTMLCanvasElement | null) {
    const bitmap = await loadBitmap(resourceId);
    try {
        const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
        const { canvas, context } = canvasOf(bitmap.width * scale, bitmap.height * scale);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (mask) {
            const tinted = canvasOf(canvas.width, canvas.height);
            tinted.context.drawImage(mask, 0, 0, canvas.width, canvas.height);
            tinted.context.globalCompositeOperation = "source-in";
            tinted.context.fillStyle = "#ff1f1f";
            tinted.context.fillRect(0, 0, canvas.width, canvas.height);
            context.globalAlpha = 0.55;
            context.drawImage(tinted.canvas, 0, 0);
            context.globalAlpha = 1;
        }
        if (doodle) context.drawImage(doodle, 0, 0, canvas.width, canvas.height);
        return { blob: await canvasBlob(canvas, "image/jpeg", 0.93), width: canvas.width, height: canvas.height };
    } finally {
        bitmap.close();
    }
}

/** 画布上是否画过东西（抽样检查透明度）。 */
export function canvasPainted(canvas: HTMLCanvasElement | null) {
    if (!canvas) return false;
    const context = canvas.getContext("2d");
    if (!context) return false;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < data.length; index += 64) if (data[index] > 8) return true;
    return false;
}
