import { http } from "@/services/api/request";
import type { AccountFileStorageUsage } from "@/services/api/resources";

export type UserStorageGrant = {
    id: string;
    userId: string;
    source: "payment" | "admin" | string;
    paymentOrderId?: string;
    productId?: string;
    productName?: string;
    bytes: number;
    durationDays: number;
    startsAt: string;
    /** 为空表示永久有效。 */
    expiresAt?: string;
    revokedAt?: string;
    revokedBy?: string;
    revokeReason?: string;
    note?: string;
    createdBy?: string;
    createdAt: string;
};

export type AdminUserStorage = {
    usage: AccountFileStorageUsage;
    grants: UserStorageGrant[];
};

export function listMyStorageGrants() {
    return http.get<{ grants: UserStorageGrant[] }>("/resources/storage-grants");
}

export function getAdminUserStorage(userId: string) {
    return http.get<AdminUserStorage>(`/admin/users/${encodeURIComponent(userId)}/storage`);
}

export function grantAdminUserStorage(userId: string, input: { bytes: number; durationDays: number; note?: string }) {
    return http.post<{ grant: UserStorageGrant }>(`/admin/users/${encodeURIComponent(userId)}/storage-grants`, input);
}

export function revokeAdminStorageGrant(grantId: string, reason: string) {
    return http.post<{ grant: UserStorageGrant }>(`/admin/storage-grants/${encodeURIComponent(grantId)}/revoke`, { reason });
}

export function storageGrantActive(grant: UserStorageGrant, now = Date.now()) {
    if (grant.revokedAt) return false;
    if (new Date(grant.startsAt).getTime() > now) return false;
    return !grant.expiresAt || new Date(grant.expiresAt).getTime() > now;
}

export type UserStorageQuotaOverride = {
    userId: string;
    username: string;
    displayName: string;
    /** 管理员为该用户单独设置的基础容量（不含赠送和购买的扩容）。 */
    baseBytes: number;
    usedBytes: number;
    totalBytes: number;
    note?: string;
    updatedBy?: string;
    updatedAt: string;
};
export type AdminStorageQuotaOverview = {
    defaultStoredFileGB: number;
    maxDefaultGB: number;
    overrides: UserStorageQuotaOverride[];
};
export function getAdminStorageQuota() {
    return http.get<AdminStorageQuotaOverview>("/admin/storage-quota");
}
export function updateAdminDefaultStorageQuota(storedFileGB: number) {
    return http.put<AdminStorageQuotaOverview>("/admin/storage-quota/default", { storedFileGB });
}
/** baseBytes 为 null 表示恢复使用全站默认容量。 */
export function setAdminUserStorageQuota(userId: string, baseBytes: number | null, note?: string) {
    return http.put<AdminUserStorage>(`/admin/users/${encodeURIComponent(userId)}/storage-quota`, { baseBytes, note });
}
