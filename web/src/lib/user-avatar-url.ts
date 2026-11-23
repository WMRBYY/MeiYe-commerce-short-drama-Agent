// Profile responses use a canonical /api path; deployment routing belongs to
// the configured API base, including its origin and reverse-proxy prefix.
export function resolveUserAvatarURL(candidate: string | undefined, apiBaseURL: string): string {
    if (!candidate) return "";
    if (/^https?:\/\//i.test(candidate)) return candidate;
    const profilePath = /^\/api\/auth\/profile\/avatar\/[a-zA-Z0-9_-]+\?v=[a-zA-Z0-9_-]+$/;
    const adminLogPath = /^\/api\/admin\/api-log-users\/[a-zA-Z0-9_-]+\/avatar\?v=[a-zA-Z0-9_-]+$/;
    if (!profilePath.test(candidate) && !adminLogPath.test(candidate)) return "";
    return `${apiBaseURL.replace(/\/+$/, "")}${candidate.slice("/api".length)}`;
}
