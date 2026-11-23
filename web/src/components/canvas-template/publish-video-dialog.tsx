// Copyright (c) 2026 meiyeai. Licensed under the MIT License.
import { App, Button, Input, Select, Switch, Upload } from "antd";
import { useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { CANVAS_TEMPLATE_CATEGORIES, submitCanvasTemplate, type CanvasTemplateCategory } from "@/services/api/canvas-templates";

/** Publish an ordinary work. This form carries no private workflow or remix state. */
export function PublishVideoDialog({ onClose, onPublished }: { source?: unknown; onClose: () => void; onPublished?: () => void }) {
    const { message } = App.useApp();
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState<CanvasTemplateCategory>("ecommerce");
    const [videoId, setVideoId] = useState("");
    const [coverId, setCoverId] = useState("");
    const [allowDownload, setAllowDownload] = useState(true);
    const [busy, setBusy] = useState(false);
    const upload = async (file: File, kind: "video" | "image") => {
        setBusy(true);
        try {
            if (!file.type.startsWith(`${kind}/`)) throw new Error("文件类型不正确");
            const resource = await uploadResourceFile(file, kind, { fileName: file.name, ...(kind === "video" ? { purpose: "template-video" } : {}) });
            if (kind === "video") setVideoId(resource.id);
            else setCoverId(resource.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败，请重试");
        } finally {
            setBusy(false);
        }
        return false;
    };
    const publish = async () => {
        setBusy(true);
        try {
            await submitCanvasTemplate({ canvasId: "", title: title.trim(), description: description.trim(), category, tags: [], videoResourceId: videoId, coverResourceId: coverId, allowDownload });
            message.success("已提交作品审核");
            onPublished?.();
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提交失败，内容已保留");
        } finally {
            setBusy(false);
        }
    };
    return (
        <AppModal open title="发布作品" onCancel={busy ? undefined : onClose} onOk={() => void publish()} okText="提交审核" confirmLoading={busy} okButtonProps={{ disabled: !title.trim() || !videoId || !coverId }}>
            <div className="flex flex-col gap-4">
                <Input aria-label="作品名称" placeholder="作品名称" maxLength={40} value={title} onChange={(event) => setTitle(event.target.value)} />
                <Input.TextArea aria-label="作品介绍" placeholder="作品介绍" value={description} onChange={(event) => setDescription(event.target.value)} />
                <Select aria-label="作品分类" value={category} onChange={setCategory} options={CANVAS_TEMPLATE_CATEGORIES.map((item) => ({ value: item.key, label: item.label }))} />
                <Upload accept="video/*" showUploadList={false} disabled={busy} beforeUpload={(file) => upload(file, "video")}>
                    <Button loading={busy}>{videoId ? "替换视频" : "上传视频"}</Button>
                </Upload>
                {videoId ? <video controls src={resourceFileUrl(videoId)} className="max-h-64 w-full" /> : null}
                <Upload accept="image/*" showUploadList={false} disabled={busy} beforeUpload={(file) => upload(file, "image")}>
                    <Button loading={busy}>{coverId ? "替换封面" : "上传封面"}</Button>
                </Upload>
                {coverId ? <img src={resourceFileUrl(coverId)} alt="作品封面" className="max-h-40 object-contain" /> : null}
                <label className="flex items-center gap-2">
                    <Switch checked={allowDownload} onChange={setAllowDownload} />
                    允许下载作品
                </label>
            </div>
        </AppModal>
    );
}
