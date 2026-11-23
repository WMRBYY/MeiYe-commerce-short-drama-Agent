import { App, Dropdown, Tooltip } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Ellipsis, History, MessageSquareText, PenSquare, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { MeiyeConfirmDialog } from "@/components/ui/meiye-confirm-dialog";
import { cn } from "@/lib/utils";
import {
    CREATION_CONVERSATIONS_CHANGED_EVENT,
    deleteStoredCreationConversation,
    loadCreationConversations,
    patchStoredCreationConversation,
    requestCreationConversation,
} from "@/services/creation-conversation-store";
import { resolveResourceVariantUrl } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";
import "./workspace-sidebar-conversations.css";

type SidebarConversation = {
    id: string;
    title: string;
    updatedAt: string;
    pinned?: boolean;
    messages: Array<{ id: string; role: "user" | "assistant"; resultStorageKeys?: string[]; resultUrls?: string[] }>;
};

const COLLAPSE_KEY = "meiye:sidebar-conversations-collapsed";

function conversationThumbnail(conversation: SidebarConversation) {
    for (let index = conversation.messages.length - 1; index >= 0; index--) {
        const message = conversation.messages[index];
        if (message.role !== "assistant") continue;
        const key = message.resultStorageKeys?.find(Boolean);
        if (key) return resolveResourceVariantUrl(key, "thumbnail-small");
        const url = message.resultUrls?.find((item) => item && !item.startsWith("blob:"));
        if (url) return url;
    }
    return "";
}

function timestamp(value: string) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
}

/** 侧栏「对话」：首页创作对话的历史，置顶、重命名、删除；点击带页面过渡进入创作页。 */
export function WorkspaceSidebarConversations({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
    const { t } = useTranslation();
    const userId = useUserStore((state) => state.user?.id || null);
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [searchParams] = useSearchParams();
    const { message } = App.useApp();
    const reducedMotion = useReducedMotion();
    const [items, setItems] = useState<SidebarConversation[]>([]);
    const [open, setOpen] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) !== "1"; } catch { return true; } });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftTitle, setDraftTitle] = useState("");
    const [menuId, setMenuId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<SidebarConversation | null>(null);
    const loadSeq = useRef(0);

    // 当前打开的对话由地址决定，与「创作」首页互斥高亮。
    const activeId = pathname === "/" ? searchParams.get("conversation") || "" : "";

    const reload = useCallback(() => {
        if (!userId) { setItems([]); return; }
        const seq = ++loadSeq.current;
        void loadCreationConversations<SidebarConversation>().then((stored) => {
            if (seq === loadSeq.current) setItems(stored || []);
        }).catch(() => undefined);
    }, [userId]);

    useEffect(() => {
        reload();
        window.addEventListener(CREATION_CONVERSATIONS_CHANGED_EVENT, reload);
        return () => window.removeEventListener(CREATION_CONVERSATIONS_CHANGED_EVENT, reload);
    }, [reload]);

    const visible = useMemo(() => items
        .filter((item) => item.messages?.length)
        .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || timestamp(right.updatedAt) - timestamp(left.updatedAt)), [items]);

    const toggleOpen = () => setOpen((current) => {
        const next = !current;
        try { localStorage.setItem(COLLAPSE_KEY, next ? "0" : "1"); } catch { /* 偏好存储不可用时仍可本次切换 */ }
        return next;
    });

    const goToCreate = (search: string) => {
        onNavigate();
        navigate(`/${search}`, { viewTransition: !reducedMotion });
    };
    const openConversation = (id: string) => {
        if (activeId === id) return;
        goToCreate(`?conversation=${encodeURIComponent(id)}`);
    };
    // 新建对话：进入一段空白对话（对话视图的空状态），不是回到创作首页。
    const newConversation = () => goToCreate("?conversation=new");
    const openHistory = () => {
        const params = new URLSearchParams(pathname === "/" ? searchParams : undefined);
        params.set("history", "conversations");
        goToCreate(`?${params}`);
    };

    const commitRename = async (conversation: SidebarConversation) => {
        const title = draftTitle.trim().slice(0, 120);
        setEditingId(null);
        if (!title || title === conversation.title.trim()) return;
        setItems((current) => current.map((item) => item.id === conversation.id ? { ...item, title } : item));
        if (requestCreationConversation({ type: "rename", id: conversation.id, title })) return;
        try { await patchStoredCreationConversation(conversation.id, { title }); } catch (error) { message.error(error instanceof Error ? error.message : t("workspace.conversations.renameFailed")); reload(); }
    };
    const togglePin = async (conversation: SidebarConversation) => {
        const pinned = !conversation.pinned;
        setItems((current) => current.map((item) => item.id === conversation.id ? { ...item, pinned } : item));
        if (requestCreationConversation({ type: "pin", id: conversation.id, pinned })) return;
        try { await patchStoredCreationConversation(conversation.id, { pinned }); } catch (error) { message.error(error instanceof Error ? error.message : t("workspace.conversations.pinFailed")); reload(); }
    };
    const confirmDelete = async () => {
        if (!deleting) return;
        const id = deleting.id;
        try {
            if (!requestCreationConversation({ type: "delete", id })) await deleteStoredCreationConversation(id);
            setItems((current) => current.filter((item) => item.id !== id));
            message.success(t("workspace.conversations.deleted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("workspace.conversations.deleteFailed"));
            throw error;
        }
    };

    if (!userId || collapsed) return null;

    return (
        <section className="workspace-conversations" aria-label={t("workspace.conversations.title")}>
            <header className="workspace-conversations-header">
                <button type="button" className="workspace-conversations-toggle" aria-expanded={open} onClick={toggleOpen}>
                    <span>{t("workspace.conversations.title")}</span>
                    <ChevronDown className={cn("workspace-conversations-chevron", !open && "is-collapsed")} aria-hidden="true" />
                </button>
                <div className="flex items-center gap-1">
                    <Tooltip title={t("create.history.title")} placement="right" mouseEnterDelay={0.2}>
                        <button type="button" className="workspace-conversations-new" aria-label={t("create.history.title")} onClick={openHistory}><History aria-hidden="true" /></button>
                    </Tooltip>
                    <Tooltip title={t("workspace.conversations.newConversation")} placement="right" mouseEnterDelay={0.2}>
                        <button type="button" className="workspace-conversations-new" aria-label={t("workspace.conversations.newConversation")} onClick={newConversation}><PenSquare aria-hidden="true" /></button>
                    </Tooltip>
                </div>
            </header>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div
                        key="list"
                        className="workspace-conversations-body"
                        initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {visible.length ? (
                            <motion.ul layout={!reducedMotion} layoutScroll className="workspace-conversations-list">
                                <AnimatePresence initial={false}>
                                    {visible.map((conversation) => {
                                        const thumb = conversationThumbnail(conversation);
                                        const editing = editingId === conversation.id;
                                        return (
                                            <motion.li
                                                key={conversation.id}
                                                layout={!reducedMotion ? "position" : false}
                                                initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -12, height: 0, marginTop: 0 }}
                                                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                                                className={cn("workspace-conversation", activeId === conversation.id && "is-active", menuId === conversation.id && "is-menu-open")}
                                            >
                                                {editing ? (
                                                    <div className="workspace-conversation-row is-editing">
                                                        <span className="workspace-conversation-thumb">{thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" /> : <MessageSquareText aria-hidden="true" />}</span>
                                                        <input
                                                            autoFocus
                                                            aria-label={t("workspace.conversations.nameLabel")}
                                                            value={draftTitle}
                                                            maxLength={120}
                                                            onChange={(event) => setDraftTitle(event.target.value)}
                                                            onFocus={(event) => event.currentTarget.select()}
                                                            onBlur={() => void commitRename(conversation)}
                                                            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { setEditingId(null); } }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <button type="button" className="workspace-conversation-row" title={conversation.title} onClick={() => openConversation(conversation.id)}>
                                                        <span className="workspace-conversation-thumb">{thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" /> : <MessageSquareText aria-hidden="true" />}</span>
                                                        <span className="workspace-conversation-title">{conversation.title.trim() || t("workspace.conversations.untitled")}</span>
                                                        {conversation.pinned ? <Pin className="workspace-conversation-pin" aria-label={t("workspace.conversations.pinned")} /> : null}
                                                    </button>
                                                )}
                                                {!editing ? (
                                                    <Dropdown
                                                        trigger={["click"]}
                                                        placement="rightTop"
                                                        align={{ offset: [10, -6] }}
                                                        rootClassName="workspace-conversation-menu"
                                                        open={menuId === conversation.id}
                                                        onOpenChange={(next) => setMenuId(next ? conversation.id : null)}
                                                        menu={{
                                                            items: [
                                                                { key: "pin", icon: conversation.pinned ? <PinOff /> : <Pin />, label: conversation.pinned ? t("workspace.conversations.unpin") : t("workspace.conversations.pin") },
                                                                { key: "rename", icon: <Pencil />, label: t("workspace.conversations.rename") },
                                                                { key: "delete", icon: <Trash2 />, label: t("common.delete"), danger: true },
                                                            ],
                                                            onClick: ({ key, domEvent }) => {
                                                                domEvent.stopPropagation();
                                                                setMenuId(null);
                                                                if (key === "pin") void togglePin(conversation);
                                                                else if (key === "rename") { setDraftTitle(conversation.title); setEditingId(conversation.id); }
                                                                else setDeleting(conversation);
                                                            },
                                                        }}
                                                    >
                                                        <button type="button" className="workspace-conversation-more" aria-label={t("workspace.conversations.moreActions", { title: conversation.title })} onClick={(event) => event.stopPropagation()}><Ellipsis aria-hidden="true" /></button>
                                                    </Dropdown>
                                                ) : null}
                                            </motion.li>
                                        );
                                    })}
                                </AnimatePresence>
                            </motion.ul>
                        ) : (
                            <p className="workspace-conversations-empty">{t("workspace.conversations.empty")}</p>
                        )}
                    </motion.div>
                ) : null}
            </AnimatePresence>
            <MeiyeConfirmDialog
                open={Boolean(deleting)}
                title={t("workspace.conversations.deleteTitle")}
                description={t("workspace.conversations.deleteDescription", { title: (deleting?.title.trim() || t("workspace.conversations.untitled")).slice(0, 40) })}
                details={[t("workspace.conversations.deleteDetailPermanent"), t("workspace.conversations.deleteDetailAssets")]}
                confirmText={t("workspace.conversations.deleteConfirm")}
                onConfirm={confirmDelete}
                onClose={() => setDeleting(null)}
            />
        </section>
    );
}
