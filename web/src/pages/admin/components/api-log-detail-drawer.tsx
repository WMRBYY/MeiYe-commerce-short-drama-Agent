import { useEffect, useState, type ReactNode } from "react";
import { Alert, App, Button, Input, Skeleton, Tabs, Typography } from "antd";
import { saveAs } from "file-saver";
import { AdminEmpty, AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import { AdminDrawer, AdminModal } from "@/pages/admin/ui/overlays";
import { Activity, ChevronLeft, ChevronRight, Clipboard, Download, HardDriveUpload, Image as ImageIcon, Link2, Music, Play, RefreshCw, Save, Video } from "lucide-react";
import { MediaPreview } from "@/components/media-preview";
import { formatCredits } from "@/constant/credits";
import { getAdminApiLog, queryAdminApiLogTask, recoverAdminApiLogTaskMedia, recoverAdminApiLogVideoByURL, type ApiCallLog, type ApiCallLogMediaItem, type ApiCallLogReferenceItem } from "@/services/api/auth";
import { adminLogMediaThumbnailUrl, logStatus, videoRecoveryAvailable } from "../logs/log-view";
import { ApiLogUser } from "./api-log-user";
import { ApiLogGenerationContent } from "./api-log-generation-content";

export function ApiLogDetailDrawer({ logId, onClose, onLogUpdated }: { logId: string | null; onClose: () => void; onLogUpdated?: (log: ApiCallLog) => void }) {
    const { message, modal } = App.useApp();
    const [log, setLog] = useState<ApiCallLog | null>(null);
    const [loading, setLoading] = useState(false);
    const [querying, setQuerying] = useState(false);
    const [providerRequestId, setProviderRequestId] = useState("");
    const [videoURL, setVideoURL] = useState("");
    const [resultText, setResultText] = useState("");

    const refresh = async (id: string) => {
        const refreshed = await getAdminApiLog(id);
        setLog(refreshed.log);
        setProviderRequestId(refreshed.log.providerRequestId || "");
        onLogUpdated?.(refreshed.log);
        return refreshed.log;
    };

    useEffect(() => {
        if (!logId) return;
        let active = true;
        setLoading(true);
        setLog(null);
        setResultText("");
        setVideoURL("");
        void getAdminApiLog(logId)
            .then((result) => {
                if (!active) return;
                setLog(result.log);
                setProviderRequestId(result.log.providerRequestId || "");
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取请求详情失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [logId, message]);

    const runQuery = async () => {
        if (!log) return;
        setQuerying(true);
        setResultText("");
        try {
            const result = await queryAdminApiLogTask(log.id, providerRequestId.trim() || undefined);
            await refresh(log.id);
            if (result.recovered) {
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                setResultText(result.billingSettled ? "查询成功，视频已转存并完成结算。" : "视频已转存，计费状态待核对。");
                message.success("视频任务恢复成功");
            } else {
                setResultText(`上游仍在生成中${result.providerStatus ? `（${result.providerStatus}）` : ""}，暂不扣费。`);
            }
        } catch (error) {
            setResultText(error instanceof Error ? error.message : "查询上游任务失败");
        } finally {
            setQuerying(false);
        }
    };

    const runURLRecovery = async () => {
        if (!log || !videoURL.trim()) return;
        setQuerying(true);
        setResultText("");
        try {
            const result = await recoverAdminApiLogVideoByURL(log.id, videoURL.trim(), providerRequestId.trim() || undefined);
            await refresh(log.id);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            setResultText(result.billingSettled ? "视频已转存并完成结算。" : "视频已转存，计费状态待核对。");
            message.success("视频转存成功");
        } catch (error) {
            setResultText(error instanceof Error ? error.message : "视频转存失败");
        } finally {
            setQuerying(false);
        }
    };

    const runMediaRecovery = async (refundedBilling?: "charge" | "waive") => {
        if (!log) return;
        setQuerying(true);
        setResultText("");
        try {
            await recoverAdminApiLogTaskMedia(log.id, refundedBilling);
            await refresh(log.id);
            setResultText("已重新排队保存作品。对象存储仍不可用时会先保存到服务器，稍后自动同步。");
            message.success("已重新排队保存作品");
        } catch (error) {
            setResultText(error instanceof Error ? error.message : "恢复作品保存失败");
        } finally {
            setQuerying(false);
        }
    };

    const confirmMediaRecovery = (refundedBilling?: "charge" | "waive") => {
        if (!log) return;
        if (!refundedBilling) {
            void runMediaRecovery();
            return;
        }
        const charge = refundedBilling === "charge";
        modal.confirm({
            title: charge ? "恢复作品并补扣积分？" : "恢复作品并免除扣费？",
            content: charge ? `原订单已退回 ${formatCredits(log.billingReservedMicrocredits)} 积分预授权。作品保存成功后会从用户可用余额补扣，余额不足时会变为负数。` : "原订单保持已退回状态，作品保存成功后不再扣费。",
            okText: charge ? "恢复并补扣" : "恢复，不扣费",
            cancelText: "取消",
            onOk: () => runMediaRecovery(refundedBilling),
        });
    };

    const title = log ? (
        <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-500/12 text-blue-500">
                <Activity className="size-[18px]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">请求日志详情</div>
                <div className="mt-0.5 truncate text-xs font-normal text-foreground/50">
                    {capabilityText(log.capability)} · {log.model || "未识别模型"} · {formatTime(log.startedAt || log.createdAt)}
                </div>
            </div>
        </div>
    ) : (
        "请求日志详情"
    );

    return (
        <AdminDrawer title={title} open={Boolean(logId)} onClose={onClose} size="min(1120px, 66vw)" className="api-log-detail-drawer-panel" rootClassName="api-log-detail-drawer">
            {loading ? (
                <Skeleton active paragraph={{ rows: 10 }} />
            ) : log ? (
                <LogDetail
                    log={log}
                    providerRequestId={providerRequestId}
                    videoURL={videoURL}
                    resultText={resultText}
                    querying={querying}
                    onProviderRequestIdChange={setProviderRequestId}
                    onVideoURLChange={setVideoURL}
                    onQuery={runQuery}
                    onRecoverURL={runURLRecovery}
                    onRecoverMedia={confirmMediaRecovery}
                />
            ) : (
                <AdminEmpty size="compact" title="没有请求详情" />
            )}
        </AdminDrawer>
    );
}

type LogDetailProps = {
    log: ApiCallLog;
    providerRequestId: string;
    videoURL: string;
    resultText: string;
    querying: boolean;
    onProviderRequestIdChange: (value: string) => void;
    onVideoURLChange: (value: string) => void;
    onQuery: () => void;
    onRecoverURL: () => void;
    onRecoverMedia: (refundedBilling?: "charge" | "waive") => void;
};

function LogDetail({ log, providerRequestId, videoURL, resultText, querying, onProviderRequestIdChange, onVideoURLChange, onQuery, onRecoverURL, onRecoverMedia }: LogDetailProps) {
    const status = logStatus(log);
    const mediaRecoverable = log.taskStatus === "failed" && Boolean(log.mediaStage) && log.mediaStage !== "completed";
    const refunded = log.billingStatus === "refunded";

    return (
        <div className="api-log-detail-body">
            <section className="api-log-detail-section">
                <div className="api-log-detail-section-heading">
                    <div>
                        <div className="api-log-detail-eyebrow">REQUEST OVERVIEW</div>
                        <h2>请求概览</h2>
                    </div>
                    <AdminStatusBadge label={status.label} tone={status.tone} />
                </div>
                <div className="api-log-detail-summary-grid">
                    <InfoItem label="能力类型" value={capabilityText(log.capability)} />
                    <InfoItem label="请求阶段" value={requestKindText(log.requestKind)} />
                    <InfoItem label="模型 / 渠道" value={`${log.model || "未识别模型"} / ${log.channelName || "未记录渠道"}`} />
                    <InfoItem label="用户" value={<ApiLogUser log={log} showAccount />} />
                    <InfoItem label="本次请求状态" value={status.label} />
                    <InfoItem label="业务任务最终状态" value={mediaDeliveryText(log)} />
                    <InfoItem label="计费" value={billingText(log)} />
                    {log.routeAttemptId ? <InfoItem label="本次上游成本" value={log.costAvailable ? `${(log.estimatedCostMicros / 1_000_000).toFixed(6)} ${log.currency || "币种未记录"}` : "供应商账单待核对"} /> : null}
                    <InfoItem label="请求 ID" value={<CopyValue value={log.id} />} />
                    <InfoItem label="任务 ID" value={log.taskId ? <CopyValue value={log.taskId} /> : "未记录"} />
                    <InfoItem label="Attempt ID" value={log.routeAttemptId ? <CopyValue value={log.routeAttemptId} /> : "直连请求"} />
                    {log.routeAttemptId && log.errorCode ? <InfoItem label="故障切换触发原因" value={log.errorCode} /> : null}
                    <InfoItem label="供应商任务 ID" value={log.providerRequestId ? <CopyValue value={log.providerRequestId} /> : "未记录"} />
                    <InfoItem label="耗时" value={<span className="tabular-nums">{formatDuration(log.durationMs)}</span>} />
                    <InfoItem label="HTTP 状态" value={log.statusCode || "未记录"} />
                    <InfoItem
                        label="请求地址"
                        value={
                            <span className="break-all font-mono text-xs">
                                {log.method} {log.path || "未记录"}
                            </span>
                        }
                    />
                    <InfoItem label="上游渠道 URL" value={<span className="break-all font-mono text-xs">{log.upstreamUrl || "未记录"}</span>} />
                </div>
                {log.error || log.errorCode ? (
                    <div className="api-log-detail-error">
                        <div className="text-xs font-semibold text-red-500">{log.errorCode || `HTTP ${log.statusCode || "失败"}`}</div>
                        <div className="mt-1 text-sm text-foreground/70">{log.error || "上游未返回错误详情"}</div>
                    </div>
                ) : null}
            </section>

            <GeneratedContentSection log={log} />

            {mediaRecoverable ? (
                <section className="api-log-detail-section api-log-recovery-section">
                    <div className="api-log-detail-section-heading">
                        <div className="flex items-center gap-2">
                            <div className="grid size-8 place-items-center rounded-md bg-amber-500/12 text-amber-500">
                                <HardDriveUpload className="size-4" aria-hidden="true" />
                            </div>
                            <div>
                                <div className="api-log-detail-eyebrow">MEDIA DELIVERY</div>
                                <h2>作品保存恢复</h2>
                            </div>
                        </div>
                        <span className="text-xs text-foreground/45">作品已生成，不会重新生成</span>
                    </div>
                    <div className="api-log-recovery-body">
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>重新保存作品</span>
                                <small>{refunded ? "原订单已退回，请选择恢复后是否补扣" : "保存成功后按原订单结算"}</small>
                            </div>
                            {refunded ? (
                                <>
                                    <Button icon={<Save className="size-3.5" />} loading={querying} onClick={() => onRecoverMedia("waive")}>
                                        恢复，不扣费
                                    </Button>
                                    <Button type="primary" icon={<Save className="size-3.5" />} loading={querying} onClick={() => onRecoverMedia("charge")}>
                                        恢复并补扣
                                    </Button>
                                </>
                            ) : (
                                <Button type="primary" icon={<Save className="size-3.5" />} loading={querying} onClick={() => onRecoverMedia()}>
                                    重新保存
                                </Button>
                            )}
                        </div>
                        {resultText ? <Alert className="api-log-recovery-result" type={resultText.includes("失败") || resultText.includes("错误") || resultText.includes("请") ? "error" : "success"} showIcon message={resultText} /> : null}
                    </div>
                </section>
            ) : null}

            {videoRecoveryAvailable(log) ? (
                <section className="api-log-detail-section api-log-recovery-section">
                    <div className="api-log-detail-section-heading">
                        <div className="flex items-center gap-2.5">
                            <div className="grid size-8 place-items-center rounded-md bg-violet-500/12 text-violet-500">
                                <Video className="size-4" aria-hidden="true" />
                            </div>
                            <div>
                                <div className="api-log-detail-eyebrow">VIDEO RECOVERY</div>
                                <h2>视频任务恢复</h2>
                            </div>
                        </div>
                        <span className="text-xs text-foreground/45">失败任务可用</span>
                    </div>
                    <div className="api-log-recovery-body">
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>供应商任务 ID</span>
                                <small>默认使用当前记录，可手动覆盖</small>
                            </div>
                            <Input className="api-log-recovery-input" value={providerRequestId} onChange={(event) => onProviderRequestIdChange(event.target.value)} placeholder="输入供应商任务 ID" />
                            <Button type="primary" icon={<RefreshCw className="size-3.5" />} loading={querying} onClick={onQuery}>
                                查询上游任务
                            </Button>
                        </div>
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>视频 URL 转存</span>
                                <small>仅支持公网 HTTP / HTTPS 视频地址</small>
                            </div>
                            <Input className="api-log-recovery-input" prefix={<Link2 className="size-4 text-foreground/35" />} value={videoURL} onChange={(event) => onVideoURLChange(event.target.value)} placeholder="https://example.com/video.mp4" />
                            <Button icon={<Save className="size-3.5" />} loading={querying} disabled={!videoURL.trim()} onClick={onRecoverURL}>
                                转存并回写
                            </Button>
                        </div>
                        {resultText ? <Alert className="api-log-recovery-result" type={resultText.includes("失败") || resultText.includes("错误") ? "error" : resultText.includes("生成中") ? "warning" : "success"} showIcon message={resultText} /> : null}
                    </div>
                </section>
            ) : null}

            {log.capability === "video" ? <ApiLogGenerationContent key={log.id} logId={log.id} content={log.generationContent} /> : null}

            <section className="api-log-detail-section api-log-payload-section">
                <div className="api-log-detail-section-heading">
                    <div>
                        <div className="api-log-detail-eyebrow">RAW PAYLOAD</div>
                        <h2>请求报文</h2>
                    </div>
                    <span className="text-xs text-foreground/45">{log.requestBody || log.responseBody ? "可复制原始内容" : "暂无报文"}</span>
                </div>
                <Tabs
                    items={[
                        { key: "request", label: "请求", children: <PayloadPanel value={log.requestBody} empty="该请求未记录请求报文" /> },
                        { key: "response", label: "响应", children: <PayloadPanel value={log.responseBody} empty="该请求未记录响应报文" /> },
                    ]}
                />
            </section>
        </div>
    );
}

// 旧版后端只返回首件缩略图（mediaPreviewUrl），这里兼容为单件列表。
function logMediaItems(log: ApiCallLog): ApiCallLogMediaItem[] {
    if (log.mediaItems?.length) return log.mediaItems;
    if (log.mediaPreviewUrl && (log.mediaPreviewKind === "image" || log.mediaPreviewKind === "video")) return [{ url: log.mediaPreviewUrl, kind: log.mediaPreviewKind }];
    return [];
}

// 生成内容：提示词全文与本次任务的全部作品，供管理员识别用户生成的内容。
function GeneratedContentSection({ log }: { log: ApiCallLog }) {
    const items = logMediaItems(log);
    const references = log.referenceItems || [];
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const [referencePreview, setReferencePreview] = useState<ApiCallLogReferenceItem | null>(null);
    if (!log.taskPrompt && items.length === 0 && references.length === 0) return null;
    const preview = previewIndex === null ? null : items[previewIndex] || null;
    const summary = items.length > 0 ? `共 ${items.length} 件作品` : log.status === "failed" ? "本次请求失败，没有作品" : "暂无可预览作品";

    return (
        <section className="api-log-detail-section">
            <div className="api-log-detail-section-heading">
                <div className="flex items-center gap-2.5">
                    <div className="grid size-8 place-items-center rounded-md bg-emerald-500/12 text-emerald-500">
                        <ImageIcon className="size-4" aria-hidden="true" />
                    </div>
                    <div>
                        <div className="api-log-detail-eyebrow">GENERATED CONTENT</div>
                        <h2>生成内容</h2>
                    </div>
                </div>
                <span className="text-xs text-foreground/45">{summary}</span>
            </div>
            <div className="api-log-content-body">
                <div className="api-log-content-block">
                    <div className="api-log-content-label">
                        <span>提示词</span>
                        {log.taskPrompt ? (
                            <Typography.Text copyable={{ text: log.taskPrompt, tooltips: ["复制提示词", "已复制"] }}>
                                <Clipboard className="mr-1 inline size-3.5" />复制提示词
                            </Typography.Text>
                        ) : null}
                    </div>
                    {log.taskPrompt ? (
                        <pre className="api-log-prompt">
                            <PromptWithReferences prompt={log.taskPrompt} references={references} onOpen={setReferencePreview} />
                        </pre>
                    ) : (
                        <div className="api-log-content-empty">该任务没有记录提示词</div>
                    )}
                </div>
                <div className="api-log-content-block">
                    <div className="api-log-content-label">
                        <span>参考素材</span>
                        {references.length > 0 ? <span className="text-[11px] font-normal text-foreground/45">共 {references.length} 件，编号对应提示词里的 @视频N / @图片N / @音频N</span> : null}
                    </div>
                    {references.length > 0 ? (
                        <div className="api-log-media-grid">
                            {references.map((item, index) => (
                                <ApiLogReferenceTile key={`${index}:${item.url}`} item={item} onOpen={() => setReferencePreview(item)} />
                            ))}
                        </div>
                    ) : (
                        <div className="api-log-content-empty">该任务没有带参考素材（纯文字生成）</div>
                    )}
                </div>
                {items.length > 0 ? (
                    <div className="api-log-content-block">
                        <div className="api-log-content-label">
                            <span>生成作品</span>
                        </div>
                        <div className="api-log-media-grid">
                            {items.map((item, index) => (
                                <ApiLogMediaTile key={`${index}:${item.url}`} item={item} index={index} onOpen={() => setPreviewIndex(index)} />
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
            <AdminModal
                title={referencePreview ? `参考素材 · @${referencePreview.label}${referencePreview.note ? `（${referencePreview.note}）` : ""}` : "参考素材"}
                open={Boolean(referencePreview)}
                width={880}
                footer={null}
                onCancel={() => setReferencePreview(null)}
            >
                {referencePreview ? (
                    referencePreview.kind === "audio" ? (
                        <audio key={referencePreview.url} src={referencePreview.url} controls className="w-full" />
                    ) : (
                        <MediaPreview
                            key={referencePreview.url}
                            src={referencePreview.url}
                            kind={referencePreview.kind}
                            alt={referencePreview.label}
                            controls={referencePreview.kind === "video"}
                            className="max-h-[72vh] w-full bg-black object-contain"
                            fallbackClassName="min-h-[360px] rounded-lg bg-black/90 text-white/55"
                        />
                    )
                ) : null}
            </AdminModal>
            <AdminModal
                title={preview ? `生成作品 ${(previewIndex ?? 0) + 1} / ${items.length}` : "作品预览"}
                open={Boolean(preview)}
                width={880}
                onCancel={() => setPreviewIndex(null)}
                footer={
                    preview && previewIndex !== null ? (
                        <div className="flex flex-wrap justify-end gap-2">
                            {items.length > 1 ? (
                                <>
                                    <Button icon={<ChevronLeft className="size-4" />} disabled={previewIndex === 0} onClick={() => setPreviewIndex(previewIndex - 1)}>
                                        上一件
                                    </Button>
                                    <Button icon={<ChevronRight className="size-4" />} disabled={previewIndex >= items.length - 1} onClick={() => setPreviewIndex(previewIndex + 1)}>
                                        下一件
                                    </Button>
                                </>
                            ) : null}
                            <Button icon={<Download className="size-4" />} onClick={() => saveAs(preview.url, `api-call-${log.id}-${previewIndex + 1}.${preview.kind === "video" ? "mp4" : "png"}`)}>
                                下载原文件
                            </Button>
                        </div>
                    ) : null
                }
            >
                {preview ? (
                    <MediaPreview
                        key={preview.url}
                        src={preview.url}
                        kind={preview.kind}
                        alt={`生成作品 ${(previewIndex ?? 0) + 1}`}
                        controls={preview.kind === "video"}
                        className="max-h-[72vh] w-full bg-black object-contain"
                        fallbackClassName="min-h-[360px] rounded-lg bg-black/90 text-white/55"
                    />
                ) : null}
            </AdminModal>
        </section>
    );
}

// 图片先读缩略图档位，缩略图不存在时回退原图；视频直接用原地址显示首帧。
function ApiLogMediaTile({ item, index, onOpen }: { item: ApiCallLogMediaItem; index: number; onOpen: () => void }) {
    const [src, setSrc] = useState(() => (item.kind === "image" ? adminLogMediaThumbnailUrl(item.url) : item.url));
    const [unavailable, setUnavailable] = useState(false);
    const label = unavailable ? "预览不可用，素材可能已删除" : `查看第 ${index + 1} 件${item.kind === "video" ? "视频" : "图片"}`;
    return (
        <button type="button" className="api-log-media-tile group" title={label} aria-label={label} disabled={unavailable} onClick={onOpen}>
            <MediaPreview
                src={src}
                kind={item.kind}
                alt={`生成作品 ${index + 1}`}
                loading="lazy"
                className="size-full object-contain"
                fallbackClassName="text-white/55"
                fallbackLabel="预览不可用"
                onUnavailable={() => (src !== item.url ? setSrc(item.url) : setUnavailable(true))}
            />
            {item.kind === "video" && !unavailable ? (
                <span className="pointer-events-none absolute inset-0 grid place-items-center text-white">
                    <Play className="size-5 fill-current" aria-hidden="true" />
                </span>
            ) : null}
            <span className="api-log-media-tile-index">{index + 1}</span>
        </button>
    );
}

const referenceTokenPattern = /@(图片|视频|音频)(\d+)/g;

// 提示词里的 @图片N / @视频N / @音频N 显示成带缩略图的标签，点开看原素材；任务里没有对应素材的编号标红：上游收不到这个引用。
function PromptWithReferences({ prompt, references, onOpen }: { prompt: string; references: ApiCallLogReferenceItem[]; onOpen: (item: ApiCallLogReferenceItem) => void }) {
    const byLabel = new Map(references.map((item) => [item.label, item]));
    const parts: ReactNode[] = [];
    let last = 0;
    for (const match of prompt.matchAll(referenceTokenPattern)) {
        const start = match.index ?? 0;
        if (start > last) parts.push(prompt.slice(last, start));
        const label = `${match[1]}${match[2]}`;
        const item = byLabel.get(label);
        parts.push(
            item ? (
                <button key={start} type="button" className="api-log-ref-chip" title={item.note ? `${label}：${item.note}` : label} onClick={() => onOpen(item)}>
                    <ReferenceThumb item={item} />
                    <span>@{label}</span>
                </button>
            ) : (
                <span key={start} className="api-log-ref-chip" data-missing="" title={`任务里没有${label}这件素材，上游收不到这个引用`}>
                    @{label} 未传
                </span>
            ),
        );
        last = start + match[0].length;
    }
    if (last < prompt.length) parts.push(prompt.slice(last));
    return <>{parts}</>;
}

function ReferenceThumb({ item }: { item: ApiCallLogReferenceItem }) {
    const [failed, setFailed] = useState(false);
    if (item.kind === "image" && !failed) return <img src={adminLogMediaThumbnailUrl(item.url)} alt="" loading="lazy" onError={() => setFailed(true)} />;
    const Icon = item.kind === "video" ? Video : item.kind === "audio" ? Music : ImageIcon;
    return (
        <span className="api-log-ref-chip-icon">
            <Icon className="size-3" aria-hidden="true" />
        </span>
    );
}

// 参考素材缩略图：底部写编号（@图片1）和用途（商品图片01、元素：香蕉……）。
function ApiLogReferenceTile({ item, onOpen }: { item: ApiCallLogReferenceItem; onOpen: () => void }) {
    const [src, setSrc] = useState(() => (item.kind === "image" ? adminLogMediaThumbnailUrl(item.url) : item.url));
    const [unavailable, setUnavailable] = useState(false);
    const title = item.note ? `@${item.label}：${item.note}` : `@${item.label}`;
    return (
        <button type="button" className="api-log-media-tile" title={unavailable ? "预览不可用，素材可能已删除" : title} aria-label={title} disabled={unavailable} onClick={onOpen}>
            {item.kind === "audio" ? (
                <span className="grid size-full place-items-center text-white/70">
                    <Music className="size-6" aria-hidden="true" />
                </span>
            ) : (
                <MediaPreview
                    src={src}
                    kind={item.kind}
                    alt={item.label}
                    loading="lazy"
                    className="size-full object-contain"
                    fallbackClassName="text-white/55"
                    fallbackLabel="预览不可用"
                    onUnavailable={() => (src !== item.url ? setSrc(item.url) : setUnavailable(true))}
                />
            )}
            {item.kind === "video" && !unavailable ? (
                <span className="pointer-events-none absolute inset-0 grid place-items-center text-white">
                    <Play className="size-5 fill-current" aria-hidden="true" />
                </span>
            ) : null}
            <span className="api-log-ref-caption">
                <strong>@{item.label}</strong>
                {item.note ? <span>{item.note}</span> : null}
            </span>
        </button>
    );
}

function InfoItem({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
    return (
        <div className="api-log-detail-info-item">
            <div className="api-log-detail-info-label">{label}</div>
            <div className="api-log-detail-info-value">{value}</div>
            {detail ? <div className="api-log-detail-info-detail">{detail}</div> : null}
        </div>
    );
}

function CopyValue({ value }: { value: string }) {
    return (
        <Typography.Text className="api-log-copy-value" copyable={{ text: value, tooltips: ["复制", "已复制"] }}>
            <code>{value}</code>
        </Typography.Text>
    );
}

function PayloadPanel({ value, empty }: { value?: string; empty: string }) {
    if (!value) return <AdminEmpty size="compact" title={empty} />;
    return (
        <div className="api-log-payload-wrap">
            <div className="api-log-payload-actions">
                <Typography.Text copyable={{ text: value, tooltips: ["复制报文", "已复制"] }}>
                    <Clipboard className="mr-1 inline size-3.5" />
                    复制报文
                </Typography.Text>
            </div>
            <pre className="api-log-payload">{value}</pre>
        </div>
    );
}

function billingText(log: ApiCallLog) {
    if (!log.billable) return "不计费";
    if (!log.billingAvailable) return "未扣积分";
    const labels = { settled: "已结算", refunded: "已退回", uncertain: "待核对", running: "运行中", reserved: "已预授权" } as const;
    const settled = log.billingSettledMicrocredits !== undefined ? `实收 ${formatCredits(log.billingSettledMicrocredits)}` : "未结算";
    return `预授权 ${formatCredits(log.billingReservedMicrocredits)} · ${settled} 积分 · ${labels[log.billingStatus || "reserved"]}`;
}

function mediaDeliveryText(log: ApiCallLog) {
    if (log.taskStatus === "succeeded") return log.mediaStage === "completed" ? "已保存并登记" : "任务成功";
    if (log.taskStatus === "failed") return "任务失败";
    return log.taskStatus || "未记录";
}

function requestKindText(value: ApiCallLog["requestKind"]) {
    const labels: Partial<Record<ApiCallLog["requestKind"], string>> = {
        create: "模型生成",
        poll: "状态查询",
        download: "结果下载",
        upload: "上传 OSS",
        local_save: "保存文件",
        local_fallback: "本地兜底保存",
        offload: "同步 OSS",
        register: "登记素材",
        repair: "结果修复",
    };
    return labels[value] || "上游请求";
}

function capabilityText(value: string) {
    return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[value] || "未知";
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
    return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1_000)} 秒`;
}
