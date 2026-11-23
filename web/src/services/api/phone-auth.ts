import { http } from "./request";
import { invalidateAuthSessionCache, type LocalUser } from "./auth";

export const startPhoneAuth = (phone: string) =>
    http.post<{ ticket: string; expiresIn: number; retryAfter: number }>("/auth/phone/start", { phone });

export async function completePhoneAuth(input: { phone: string; ticket: string; code: string }) {
    const result = await http.post<{ user: LocalUser }>("/auth/phone/confirm", input);
    invalidateAuthSessionCache();
    return result;
}
