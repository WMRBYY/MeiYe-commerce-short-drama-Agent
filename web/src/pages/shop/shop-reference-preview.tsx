import { Modal } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import "./shop-reference-preview.css";

export function ShopReferencePreview({ src, fullSrc = src, name }: { src: string; fullSrc?: string; name: string }) {
    const [open, setOpen] = useState(false);
    const reduced = useReducedMotion();
    if (!src) return null;
    return (
        <>
            <button type="button" className="shop-reference-trigger" aria-label={`预览${name}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
                <img src={src} alt="" draggable={false} />
            </button>
            <Modal open={open} centered width={920} title={name} footer={null} destroyOnHidden rootClassName="shop-reference-modal" className="ms-scope" onCancel={() => setOpen(false)}>
                <motion.img className="shop-reference-image" src={fullSrc} alt={name} initial={reduced ? false : { opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 330, damping: 30 }} />
            </Modal>
        </>
    );
}
