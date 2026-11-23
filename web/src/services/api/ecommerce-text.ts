import { http } from "./request";

/** Boxes use decoded source-image pixels, never viewport or thumbnail coordinates. */
export type EcommerceImageTextRegion = {
    id: string;
    text: string;
    box: { x: number; y: number; width: number; height: number };
    confidence: number;
    fontFamily?: string;
    fontSize?: number;
};

export type EcommerceImageTextDetection = {
    resourceId: string;
    width: number;
    height: number;
    regions: EcommerceImageTextRegion[];
};

export function detectEcommerceImageText(resourceId: string, signal?: AbortSignal) {
    if (!resourceId.trim()) throw new Error("图片尚未保存，暂时无法识别文字");
    return http.post<EcommerceImageTextDetection>("/ecommerce/detail/text-detection", { resourceId }, { signal, timeout: 120_000 });
}
