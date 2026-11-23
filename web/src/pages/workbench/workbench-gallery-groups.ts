/** 按浏览器本地日历分组，跨月、跨年和夏令时切换仍使用实际日期。 */
export function groupGalleryBatchesByDay<T extends { createdAt: string }>(items: T[], now = new Date()) {
    const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const today = dayKey(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = dayKey(yesterdayDate);
    const groups = new Map<string, { key: string; label: string; items: T[] }>();
    for (const item of items) {
        const date = new Date(item.createdAt);
        const valid = Number.isFinite(date.getTime());
        const key = valid ? dayKey(date) : "unknown";
        const label = !valid ? "较早记录" : key === today ? "今天" : key === yesterday ? "昨天" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
        const group = groups.get(key) || { key, label, items: [] };
        group.items.push(item);
        groups.set(key, group);
    }
    return [...groups.values()];
}
