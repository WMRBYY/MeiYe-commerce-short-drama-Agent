export type ImageModel = {
    id: string;
    name: string;
    category: string;
    style: string;
    atlas: string;
    image?: string;
    thumbnail?: string;
    gender: "male" | "female" | "other";
    age: "child" | "adult" | "young" | "middle" | "senior";
    column: number;
    row: number;
};
export const IMAGE_MODEL_LIMIT = 9;
export const IMAGE_MODEL_CATEGORIES = [
    { id: "modern", label: "现代写实", style: "写实摄影" },
    { id: "child", label: "写实儿童", style: "写实摄影" },
    { id: "young", label: "写实青年", style: "写实摄影" },
    { id: "middle", label: "写实中年", style: "写实摄影" },
    { id: "senior", label: "写实老年", style: "写实摄影" },
    { id: "wuxia", label: "武林侠客", style: "古装电影" },
    { id: "xianxia", label: "东方仙幻", style: "仙幻电影" },
    { id: "fantasy", label: "西方奇幻", style: "奇幻电影" },
    { id: "beasts", label: "魔兽异族", style: "魔兽幻想" },
    { id: "scifi", label: "科幻未来", style: "科幻电影" },
    { id: "anime", label: "动漫二次元", style: "赛璐璐动画" },
    { id: "clay", label: "黏土童话", style: "手工定格" },
] as const;
// Deployment owners may populate this catalog with their own licensed images.
export const IMAGE_MODELS: ImageModel[] = [];
export function matchesImageModel(model: ImageModel, query: string, gender = "", age = "", category = "") {
    const label = IMAGE_MODEL_CATEGORIES.find((item) => item.id === model.category)?.label || "";
    const text = `${model.name} ${label} ${model.style}`.toLowerCase();
    return (!gender || model.gender === gender) && (!age || model.age === age) && (!category || model.category === category) && (!query.trim() || text.includes(query.trim().toLowerCase()));
}
