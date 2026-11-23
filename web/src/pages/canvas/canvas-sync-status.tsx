import { CloudCheck, CloudOff, LoaderCircle } from "lucide-react";
import { App, Button, Popover } from "antd";
import { useState } from "react";
import { saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { syncRecoveryCopies } from "@/lib/canvas/sync-recovery";
import { getActiveUserScope } from "@/lib/user-scope";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import "./canvas-sync-status.css";

export function CanvasSyncStatus({ projectId }: { projectId: string }) {
    const { message } = App.useApp();
    const [retrying, setRetrying] = useState(false);
    const progress = useSyncProgressStore((state) => state.syncingProjects[projectId]);
    const missingFromCloud = progress?.errorKind === "missing";
    const failed = progress?.localPhase === "error" || progress?.phase === "error" || progress?.phase === "conflict" || Boolean(progress?.errorKind && progress.phase !== "done");
    const saving = !failed && (progress?.phase === "pending" || progress?.phase === "saving" || progress?.phase === "uploading" || progress?.phase === "reconciling" || progress?.localPhase === "pending");
    const tone = failed ? "error" : saving ? "pending" : progress?.phase === "done" ? "done" : "idle";
    const label = failed ? "画布保存未完成" : saving ? "正在同步画布" : progress?.phase === "done" ? "已同步" : "尚未同步";
    const detail = failed ? progress?.localError || progress?.draftError || progress?.message : saving ? progress?.message : undefined;
    const indicator = (
        <span className={`canvas-sync-status-trigger canvas-sync-status-trigger--${tone} inline-flex size-8 items-center justify-center rounded-full`} role="status" aria-label={label} title={detail ? `${label}：${detail}` : label}>
            {failed ? <CloudOff className="size-4" style={{ color: "var(--color-error, #ef4444)" }} /> : saving ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <CloudCheck className="size-4" />}
        </span>
    );
    if (!failed) return indicator;
    const exportDraft = () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        const copies = syncRecoveryCopies(getActiveUserScope());
        const url = URL.createObjectURL(new Blob([JSON.stringify({ project, recoveryCopies: copies, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `canvas-recovery-${projectId}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };
    return <Popover trigger="click" title="画布同步需要处理" content={<div style={{ maxWidth: 320 }}>
        <p>{detail}</p>
        <p>{missingFromCloud ? "可导出草稿，保留当前画布内容。" : "重试会读取云端最新版本并按字段合并，冲突解决前会保留两个版本。"}</p>
        {progress?.errorKind === "resources" ? <p>如主素材已缺失，请在对应节点重新上传或从素材库选择原素材，再重试同步。不会重新提交生成任务。</p> : null}
        {!missingFromCloud ? <Button loading={retrying} onClick={async () => {
            setRetrying(true);
            try { await saveRemoteUserDataNow(projectId); } catch (error) { message.warning(error instanceof Error ? error.message : "同步尚未完成"); } finally { setRetrying(false); }
        }}>重试同步</Button> : null}
        <Button onClick={exportDraft}>导出本地草稿与恢复副本</Button>
    </div>}><button type="button" aria-label="处理画布同步问题" className="canvas-sync-status-trigger">{indicator}</button></Popover>;
}
