import type { ApiCallLog } from "@/services/api/auth";

export type LogView = "troubleshoot" | "billing" | "content" | "all";

export function normalizeLogView(value: string | null): LogView {
    return value === "billing" || value === "content" || value === "all" ? value : "troubleshoot";
}

// 后台请求日志的媒体接口支持缩略图档位；外链不能追加参数，原样返回。
export function adminLogMediaThumbnailUrl(url: string) {
    if (!url.startsWith("/api/admin/api-logs/")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}variant=thumbnail`;
}

export function logStatus(log: Pick<ApiCallLog, "status" | "providerStatus" | "taskStatus">) {
    // A successful business task can contain failed route attempts. Show the
    // request's own failure before applying the parent task's final status.
    if (log.status === "failed") return { label: "失败", tone: "error" as const };
    if (log.taskStatus === "succeeded") return { label: "成功", tone: "success" as const };
    if (log.taskStatus === "failed" || log.taskStatus === "cancelled") return { label: "失败", tone: "error" as const };
    if (log.taskStatus === "queued" || log.taskStatus === "running") return { label: "处理中", tone: "warning" as const };
    const providerStatus = log.providerStatus?.toLowerCase();
    if (["failed", "cancelled", "canceled", "expired"].includes(providerStatus || "")) return { label: "失败", tone: "error" as const };
    if (["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "")) return { label: "处理中", tone: "warning" as const };
    return { label: "成功", tone: "success" as const };
}

export function logBillingLabel(log: Pick<ApiCallLog, "billable" | "billingAvailable" | "billingStatus">) {
    if (!log.billable) return "不计费";
    if (!log.billingAvailable) return "未扣积分";
    const labels = { settled: "已结算", refunded: "已退回", uncertain: "待核对", running: "运行中", reserved: "已预授权" };
    return log.billingStatus ? labels[log.billingStatus] : "已预授权";
}

// 人工查询上游只针对失败的视频生成：任务已成功或仍在运行时不开放入口，避免误触发结算。
// 任务记录缺失时以调用结果为准，后端仍会校验任务归属并拒绝不可恢复的记录。
export function videoRecoveryAvailable(log: Pick<ApiCallLog, "capability" | "taskId" | "taskStatus" | "status">) {
    if (log.capability !== "video" || !log.taskId) return false;
    return log.taskStatus === "failed" || (log.status === "failed" && !log.taskStatus);
}
