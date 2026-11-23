import { App, Input, Slider } from "antd";
import { Pencil, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal";
import { translate } from "@/i18n";
import { profileAvatarURL } from "@/lib/profile-avatar";
import { updateOwnProfile } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import "./profile-editor.css";

function renderCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, zoom: number, horizontal: number, vertical: number) {
    const side = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
    const x = (image.naturalWidth - side) * (horizontal + 100) / 200;
    const y = (image.naturalHeight - side) * (vertical + 100) / 200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(translate("workspace.profile.processFailed"));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, side, side, 0, 0, canvas.width, canvas.height);
}

export function ProfileEditButton({ className = "", onOpen }: { className?: string; onOpen?: () => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    return <>
        <button type="button" className={`profile-edit-button ${className}`} aria-label={t("workspace.profile.editLabel")} title={t("workspace.profile.title")} onClick={() => { onOpen?.(); setOpen(true); }}><Pencil aria-hidden="true" /></button>
        <ProfileEditor open={open} onClose={() => setOpen(false)} />
    </>;
}

export function ProfileEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const user = useUserStore((state) => state.user);
    const { message } = App.useApp();
    const [nickname, setNickname] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [previewURL, setPreviewURL] = useState("");
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [zoom, setZoom] = useState(1);
    const [horizontal, setHorizontal] = useState(0);
    const [vertical, setVertical] = useState(0);
    const [saving, setSaving] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => { if (open) { setNickname(user?.displayName || ""); setFile(null); setZoom(1); setHorizontal(0); setVertical(0); } }, [open, user?.id]);
    useEffect(() => {
        if (!file) { setPreviewURL(""); setImage(null); return; }
        const objectURL = URL.createObjectURL(file);
        setPreviewURL(objectURL);
        const loaded = new Image();
        loaded.onload = () => setImage(loaded);
        loaded.onerror = () => { setImage(null); message.error(t("workspace.profile.readFailed")); };
        loaded.src = objectURL;
        return () => URL.revokeObjectURL(objectURL);
    }, [file, message]);
    useEffect(() => { if (image && canvasRef.current) renderCrop(canvasRef.current, image, zoom, horizontal, vertical); }, [image, zoom, horizontal, vertical]);

    const selectFile = (selected?: File) => {
        if (!selected) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 4 * 1024 * 1024) {
            message.error(t("workspace.profile.invalidFile"));
            return;
        }
        setImage(null); setFile(selected); setZoom(1); setHorizontal(0); setVertical(0);
    };
    const save = async () => {
        if (!user || saving) return;
        const changedName = nickname.trim() !== user.displayName ? nickname.trim() : undefined;
        if (!changedName && !file) { onClose(); return; }
        if (file && !image) { message.error(t("workspace.profile.imageLoading")); return; }
        setSaving(true);
        try {
            let avatar: Blob | undefined;
            if (image) {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 512;
                renderCrop(canvas, image, zoom, horizontal, vertical);
                avatar = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t("workspace.profile.compressFailed"))), "image/jpeg", 0.85));
            }
            const updated = await updateOwnProfile(changedName, avatar);
            if (useUserStore.getState().user?.id === updated.id) useUserStore.getState().setUser(updated);
            message.success(t("workspace.profile.saved"));
            onClose();
        } catch (error) { message.error(error instanceof Error ? error.message : t("workspace.profile.saveFailed")); }
        finally { setSaving(false); }
    };

    return <AppModal open={open} title={t("workspace.profile.title")} width={420} okText={t("common.save")} okButtonProps={{ disabled: !user || saving }} confirmLoading={saving} onOk={() => void save()} onCancel={onClose}>
        <div className="profile-editor-body">
            <div className="profile-editor-preview">
                {previewURL && image ? <canvas ref={canvasRef} width={176} height={176} aria-label={t("workspace.profile.cropPreview")} /> : profileAvatarURL(user?.avatarUrl) ? <img src={profileAvatarURL(user?.avatarUrl)} alt={t("workspace.profile.currentAvatar")} /> : <span className="profile-editor-placeholder" aria-label={t("workspace.profile.defaultAvatar")}>{(user?.displayName || user?.username || t("workspace.profile.avatarFallback")).slice(0, 1)}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} aria-label={t("workspace.profile.uploadFile")} />
            <button type="button" className="profile-editor-upload" onClick={() => fileRef.current?.click()}><Upload aria-hidden="true" />{t("workspace.profile.upload")}</button>
            <p className="profile-editor-hint">{t("workspace.profile.uploadHint")}</p>
            {image ? <div className="profile-editor-crop" aria-label={t("workspace.profile.cropRange")}>
                <label>{t("workspace.profile.zoom")}<Slider min={1} max={3} step={0.05} value={zoom} onChange={setZoom} /></label>
                <label>{t("workspace.profile.horizontal")}<Slider min={-100} max={100} value={horizontal} onChange={setHorizontal} /></label>
                <label>{t("workspace.profile.vertical")}<Slider min={-100} max={100} value={vertical} onChange={setVertical} /></label>
            </div> : null}
            <label className="profile-editor-name">{t("workspace.profile.nickname")}<Input maxLength={32} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={t("workspace.profile.nicknamePlaceholder")} showCount /></label>
        </div>
    </AppModal>;
}
