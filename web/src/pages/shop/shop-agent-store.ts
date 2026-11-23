import { create } from "zustand";

/** 电商面板状态独立于创作 / 短剧 Agent；切模式不覆盖其他助手会话。 */
export const useShopAgentStore = create<{
    open: boolean;
    prompt: string;
    drafts: Record<string, string>;
    setDraft: (scope: string, draft: string) => void;
    setOpen: (open: boolean) => void;
    prepare: (prompt: string) => void;
}>()((set) => ({ open: false, prompt: "", drafts: {}, setDraft: (scope, draft) => set((state) => ({ drafts: { ...state.drafts, [scope]: draft } })), setOpen: (open) => set({ open }), prepare: (prompt) => set({ prompt, open: true }) }));
