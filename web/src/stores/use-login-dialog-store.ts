import { create } from "zustand";

type LoginDialogState = {
    open: boolean;
    next: string;
    show: (next?: string) => void;
    close: () => void;
};

export function safeLoginNext(value?: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/";
    try {
        const origin = "https://meiye-login.invalid";
        const destination = new URL(value, origin);
        const path = decodeURIComponent(destination.pathname);
        if (destination.origin !== origin || path.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(path) || /^\/(?:login|register)(?:\/|$)/i.test(path)) return "/";
        return destination.pathname + destination.search + destination.hash;
    } catch {
        return "/";
    }
}

export const useLoginDialogStore = create<LoginDialogState>((set) => ({
    open: false,
    next: "/",
    show: (next) => set({ open: true, next: safeLoginNext(next) }),
    close: () => set({ open: false }),
}));
