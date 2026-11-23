import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./meiye-confirm-dialog.css";

type MeiyeConfirmDialogProps = {
    open: boolean;
    title: string;
    description: ReactNode;
    /** 列在描述下方的要点，例如会被删除的内容。 */
    details?: string[];
    confirmText: string;
    cancelText?: string;
    icon?: ReactNode;
    onConfirm: () => Promise<void> | void;
    onClose: () => void;
};

/** 危险操作确认弹窗：背景模糊淡入，卡片带弹性缩放进出；确认中禁止重复提交和关闭。 */
export function MeiyeConfirmDialog({ open, title, description, details, confirmText, cancelText = "取消", icon, onConfirm, onClose }: MeiyeConfirmDialogProps) {
    const reducedMotion = useReducedMotion();
    const [pending, setPending] = useState(false);
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) { setPending(false); return; }
        const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 60);
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
        window.addEventListener("keydown", onKey);
        return () => { window.clearTimeout(focusTimer); window.removeEventListener("keydown", onKey); };
    }, [open, pending, onClose]);

    const confirm = async () => {
        if (pending) return;
        setPending(true);
        try {
            await onConfirm();
            onClose();
        } catch {
            // 调用方负责提示错误；弹窗保留，用户可以重试或取消。
        } finally {
            setPending(false);
        }
    };

    if (typeof document === "undefined") return null;
    return createPortal(
        <AnimatePresence>
            {open ? (
                <motion.div
                    key="meiye-confirm"
                    className="meiye-confirm-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                    onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}
                >
                    <motion.div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="meiye-confirm-title"
                        className="meiye-confirm-card"
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 18, filter: "blur(6px)" }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8, filter: "blur(4px)" }}
                        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32, mass: 0.8 }}
                    >
                        <motion.span
                            className="meiye-confirm-icon"
                            aria-hidden="true"
                            initial={reducedMotion ? false : { scale: 0.4, rotate: -18 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: "spring", stiffness: 520, damping: 18, delay: reducedMotion ? 0 : 0.06 }}
                        >
                            {icon ?? <Trash2 />}
                        </motion.span>
                        <h2 id="meiye-confirm-title">{title}</h2>
                        <div className="meiye-confirm-description">{description}</div>
                        {details?.length ? <ul className="meiye-confirm-details">{details.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                        <footer>
                            <button ref={cancelRef} type="button" className="meiye-confirm-cancel" disabled={pending} onClick={onClose}>{cancelText}</button>
                            <button type="button" className="meiye-confirm-danger" disabled={pending} aria-busy={pending} onClick={() => void confirm()}>
                                {pending ? <LoaderCircle className="meiye-confirm-spin" aria-hidden="true" /> : null}{confirmText}
                            </button>
                        </footer>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>,
        document.body,
    );
}
