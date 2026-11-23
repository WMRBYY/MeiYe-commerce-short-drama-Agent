import { http } from "./request";

export type ClipPricing = {
    creditsPerClip: number;
    defaultCredits: number;
    maxCredits: number;
    configured: boolean;
    updatedAt: string;
};

const base = "/admin/shop-clips/pricing";

export const getClipPricing = () => http.get<ClipPricing>(base);
export const updateClipPricing = (creditsPerClip: number) => http.put<ClipPricing>(base, { creditsPerClip });
