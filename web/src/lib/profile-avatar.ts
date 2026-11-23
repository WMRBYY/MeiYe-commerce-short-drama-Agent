export function profileAvatarURL(value?: string) {
    const url = value?.trim() || "";
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/api\/profile\/avatars\/[a-zA-Z0-9-]+\/[a-f0-9]{32}\.jpg$/.test(url)) return url;
    return "";
}
