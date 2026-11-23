import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { App, Button, Input, Pagination, Popover, Segmented, Select, Spin, Tag } from "antd";
import { EmptyState } from "@/components/ui/product/empty-state";
import { CheckCircle2, Clock3, Flag, LoaderCircle, RefreshCw, Search, ShieldOff, Undo2, Workflow, X, XCircle } from "lucide-react";

import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { TemplateAuthorAvatar } from "@/components/canvas-template/template-author-avatar";
import { TemplateCanvasViewer } from "@/components/canvas-template/template-canvas-viewer";
import "./template-reviews.css";
import {
    CANVAS_TEMPLATE_CATEGORIES,
    CANVAS_TEMPLATE_REPORT_REASONS,
    canvasTemplateCategoryLabel,
    canvasTemplateMediaUrl,
    formatTemplateBytes,
    formatTemplateDuration,
    getAdminCanvasTemplate,
    listAdminCanvasTemplates,
    reviewAdminCanvasTemplate,
    templateQualityLabel,
    type CanvasTemplate,
    type CanvasTemplateList,
    type CanvasTemplateProject,
    type CanvasTemplateReport,
    type CanvasTemplateStatus,
} from "@/services/api/canvas-templates";

type StatusFilter = CanvasTemplateStatus | "all";

const STATUS_META: Record<CanvasTemplateStatus, { label: string; color: string }> = {
    pending: { label: "待审核", color: "orange" },
    approved: { label: "已上架", color: "green" },
    rejected: { label: "未通过", color: "red" },
    offline: { label: "已下架", color: "default" },
};

const REJECT_PRESETS = ["画面质量较低", "成片与画布工程不一致", "工程文件不完整", "内容涉嫌侵权", "分类与内容不符"];

function formatTime(value?: string) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
}

function reportReasonLabel(reason: string) {
    return CANVAS_TEMPLATE_REPORT_REASONS.find((item) => item.key === reason)?.label || reason;
}

export default function TemplateReviewsPage() {
    const { message } = App.useApp();
    const [status, setStatus] = useState<StatusFilter>("pending");
    const [category, setCategory] = useState<string | undefined>();
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(24);
    const [data, setData] = useState<CanvasTemplateList | null>(null);
    const [loading, setLoading] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        listAdminCanvasTemplates({ status, category, q: query, page, pageSize }, controller.signal)
            .then(setData)
            .catch((error) => {
                if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "读取模版列表失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [category, message, page, pageSize, query, reloadToken, status]);

    const reload = useCallback(() => setReloadToken((value) => value + 1), []);
    const counts = data?.counts || {};
    const allCount = Object.values(counts).reduce((sum, value) => sum + (value || 0), 0);

    return (
        <AdminPageFrame
            title="模版审核"
            description="审核用户上传的画布模版与电商视频，通过后展示在首页作品区。"
            scroll
            actions={
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={reload}>
                    刷新
                </Button>
            }
        >
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Segmented<StatusFilter>
                    value={status}
                    className="bg-muted/40"
                    onChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                    options={[
                        { label: `待审核 ${counts.pending || 0}`, value: "pending" },
                        { label: `已上架 ${counts.approved || 0}`, value: "approved" },
                        { label: `未通过 ${counts.rejected || 0}`, value: "rejected" },
                        { label: `已下架 ${counts.offline || 0}`, value: "offline" },
                        { label: `全部 ${allCount}`, value: "all" },
                    ]}
                />
                <Select
                    allowClear
                    value={category}
                    placeholder="全部分类"
                    className="w-36"
                    options={CANVAS_TEMPLATE_CATEGORIES.map((item) => ({ label: item.label, value: item.key }))}
                    onChange={(value) => {
                        setCategory(value);
                        setPage(1);
                    }}
                />
                <Input
                    allowClear
                    value={keyword}
                    className="w-72"
                    prefix={<Search className="size-3.5 opacity-60" />}
                    placeholder="搜索标题、简介、标签、作者或用户 ID"
                    onChange={(event) => {
                        setKeyword(event.target.value);
                        if (!event.target.value) {
                            setQuery("");
                            setPage(1);
                        }
                    }}
                    onPressEnter={() => {
                        setQuery(keyword.trim());
                        setPage(1);
                    }}
                />
            </div>

            <Spin spinning={loading}>
                {data?.items.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
                        {data.items.map((item) => (
                            <TemplateReviewCard key={item.id} template={item} onOpen={() => setOpenId(item.id)} />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-xl border border-border/70 bg-card py-10">
                        <EmptyState title={loading ? "正在读取…" : status === "pending" ? "暂无待审核的模版" : "没有符合条件的模版"} description="用户从画布上传模版，或从首页、电商视频上传作品后，会出现在这里。" />
                    </div>
                )}
            </Spin>

            {data && data.total > pageSize ? (
                <div className="mt-5 flex justify-end">
                    <Pagination
                        current={page}
                        pageSize={pageSize}
                        total={data.total}
                        showSizeChanger
                        pageSizeOptions={["24", "48", "96"]}
                        onChange={(nextPage, nextSize) => {
                            setPage(nextPage);
                            setPageSize(nextSize);
                        }}
                    />
                </div>
            ) : null}

            {openId ? <TemplateReviewOverlay id={openId} onClose={() => setOpenId(null)} onReviewed={reload} /> : null}
        </AdminPageFrame>
    );
}

function TemplateReviewCard({ template, onOpen }: { template: CanvasTemplate; onOpen: () => void }) {
    const meta = STATUS_META[template.status];
    return (
        <button type="button" className="group overflow-hidden rounded-xl border border-border/70 bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg" onClick={onOpen}>
            <div className="relative aspect-video overflow-hidden bg-black">
                <img src={canvasTemplateMediaUrl(template.coverThumbUrl)} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                <Tag color={meta.color} className="!absolute left-2 top-2 m-0 text-xs">
                    {meta.label}
                </Tag>
                {template.reportCount ? (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-red-500/90 px-1.5 py-0.5 text-[11px] text-white">
                        <Flag className="size-3" />
                        {template.reportCount}
                    </span>
                ) : null}
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-white">{formatTemplateDuration(template.videoDurationMs)}</span>
            </div>
            <div className="space-y-2 p-3">
                <div className="truncate text-sm font-semibold" title={template.title}>
                    {template.title}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <TemplateAuthorAvatar name={template.author.displayName} url={template.author.avatarUrl} size={20} />
                    <span className="min-w-0 flex-1 truncate">{template.author.displayName}</span>
                    <Tag className="m-0 text-[11px]">{canvasTemplateCategoryLabel(template.category)}</Tag>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                        <Workflow className="size-3" />
                        {template.ecommerce ? "电商视频" : `${template.nodeCount} 节点`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-3" />
                        {formatTime(template.createdAt)}
                    </span>
                </div>
            </div>
        </button>
    );
}

type ReviewDetail = { template: CanvasTemplate; project: CanvasTemplateProject; reports: CanvasTemplateReport[] };

/** 审核大弹窗。画布视口会忽略 antd Modal 内的滚轮和拖动，所以这里用自定义全屏层。 */
function TemplateReviewOverlay({ id, onClose, onReviewed }: { id: string; onClose: () => void; onReviewed: () => void }) {
    const { message } = App.useApp();
    const [detail, setDetail] = useState<ReviewDetail | null>(null);
    const [error, setError] = useState("");
    const [acting, setActing] = useState<"" | "approve" | "reject" | "offline">("");

    useEffect(() => {
        const controller = new AbortController();
        setDetail(null);
        setError("");
        getAdminCanvasTemplate(id, controller.signal)
            .then(setDetail)
            .catch((reason) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "读取模版失败");
            });
        return () => controller.abort();
    }, [id]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || document.querySelector(".ant-popover:not(.ant-popover-hidden)")) return;
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            document.body.style.overflow = overflow;
        };
    }, [onClose]);

    const review = async (action: "approve" | "reject" | "offline", note = "") => {
        setActing(action);
        try {
            const { template } = await reviewAdminCanvasTemplate(id, { action, note });
            setDetail((current) => (current ? { ...current, template } : current));
            message.success(action === "approve" ? "已通过，作品已展示在首页作品区" : action === "reject" ? "已驳回，作者会看到不通过原因" : "已下架，首页不再展示该作品");
            onReviewed();
            return true;
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "审核操作失败");
            return false;
        } finally {
            setActing("");
        }
    };

    const template = detail?.template;
    const container = document.getElementById("admin-root") || document.body;

    return createPortal(
        <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <section aria-label="模版审核详情" className="absolute inset-[2vh_1.5vw] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121212] text-white shadow-2xl">
                <header className="trv-header flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4">
                    {template ? (
                        <>
                            <Tag color={STATUS_META[template.status].color} className="m-0">
                                {STATUS_META[template.status].label}
                            </Tag>
                            <h2 className="min-w-0 truncate text-base font-semibold">{template.title}</h2>
                            <span className="hidden min-w-0 items-center gap-1.5 truncate text-xs text-white/55 md:inline-flex">
                                <TemplateAuthorAvatar name={template.author.displayName} url={template.author.avatarUrl} size={18} />
                                {template.author.displayName}
                                {template.author.username ? <span className="text-white/35">（{template.author.username}）</span> : null}
                            </span>
                            <div className="ml-auto flex shrink-0 items-center gap-2">
                                {template.status !== "approved" ? (
                                    <Button type="primary" icon={<CheckCircle2 className="size-4" />} loading={acting === "approve"} disabled={Boolean(acting)} onClick={() => void review("approve")}>
                                        {template.status === "pending" ? "通过并上架" : "重新上架"}
                                    </Button>
                                ) : null}
                                {template.status === "pending" ? (
                                    <ReviewNotePopover title="不通过原因（作者可见）" required presets={REJECT_PRESETS} okText="确认不通过" loading={acting === "reject"} onConfirm={(note) => review("reject", note)}>
                                        <Button danger icon={<XCircle className="size-4" />} disabled={Boolean(acting)}>
                                            不通过
                                        </Button>
                                    </ReviewNotePopover>
                                ) : null}
                                {template.status === "approved" ? (
                                    <ReviewNotePopover title="下架说明（选填，作者可见）" presets={["收到举报，内容待核实", "作品质量不符合首页标准"]} okText="确认下架" loading={acting === "offline"} onConfirm={(note) => review("offline", note)}>
                                        <Button danger icon={<ShieldOff className="size-4" />} disabled={Boolean(acting)}>
                                            下架
                                        </Button>
                                    </ReviewNotePopover>
                                ) : null}
                                <button type="button" className="grid size-9 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="关闭" onClick={onClose}>
                                    <X className="size-5" />
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <span className="text-sm text-white/60">{error || "正在读取模版…"}</span>
                            <button type="button" className="ml-auto grid size-9 place-items-center rounded-lg text-white/70 transition hover:bg-white/10" aria-label="关闭" onClick={onClose}>
                                <X className="size-5" />
                            </button>
                        </>
                    )}
                </header>
                <div className="trv-body flex min-h-0 flex-1">
                    <aside className="trv-info w-[380px] shrink-0 overflow-y-auto border-r border-white/10 p-4">
                        {template ? (
                            <TemplateReviewInfo template={template} reports={detail?.reports || []} />
                        ) : (
                            <div className="grid h-40 place-items-center text-white/50">{error ? <Undo2 className="size-5" /> : <LoaderCircle className="size-5 animate-spin" />}</div>
                        )}
                    </aside>
                    <div className="relative min-w-0 flex-1">
                        {detail ? (
                            template?.ecommerce ? (
                                <EcommerceReviewPreview template={template} />
                            ) : detail.project.nodes?.length ? (
                                <TemplateCanvasViewer project={detail.project} />
                            ) : (
                                <div className="grid h-full place-items-center text-sm text-white/50">该模版的画布没有节点</div>
                            )
                        ) : (
                            <div className="grid h-full place-items-center text-sm text-white/50">{error || <LoaderCircle className="size-6 animate-spin" />}</div>
                        )}
                        {detail && !template?.ecommerce ? <div className="pointer-events-none absolute right-4 top-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs text-white/60">完整画布工程 · 只读 · 点击节点查看提示词</div> : null}
                    </div>
                </div>
            </section>
        </div>,
        container,
    );
}

function EcommerceReviewPreview({ template }: { template: CanvasTemplate }) {
    const metadata = template.ecommerce!;
    return (
        <section className="trv-ecommerce" aria-label="电商视频审核预览">
            <div className="trv-videos">
                {metadata.referenceVideoResourceId ? (
                    <div>
                        <h3>参考视频</h3>
                        <video src={canvasTemplateMediaUrl(metadata.referenceVideoResourceId)} controls playsInline preload="metadata" />
                    </div>
                ) : null}
                <div>
                    <h3>生成结果</h3>
                    <video src={canvasTemplateMediaUrl(template.videoUrl)} poster={canvasTemplateMediaUrl(template.coverUrl)} controls playsInline preload="metadata" />
                </div>
            </div>
            {metadata.referenceResourceIds.length ? (
                <>
                    <h3>参考图片</h3>
                    <div className="trv-images">
                        {metadata.referenceResourceIds.map((url, index) => (
                            <img key={url} src={canvasTemplateMediaUrl(url)} alt={`参考图 ${index + 1}`} />
                        ))}
                    </div>
                </>
            ) : null}
            <h3>生成模型</h3>
            <p>{metadata.model}</p>
            <h3>生成提示词</h3>
            <p className="trv-prompt">{metadata.prompt}</p>
        </section>
    );
}

function TemplateReviewInfo({ template, reports }: { template: CanvasTemplate; reports: CanvasTemplateReport[] }) {
    const rows: [string, string][] = [
        ["作品分类", canvasTemplateCategoryLabel(template.category)],
        ["成片时长", formatTemplateDuration(template.videoDurationMs)],
        ["分辨率", template.videoWidth ? `${template.videoWidth}×${template.videoHeight}（${templateQualityLabel(template.videoWidth, template.videoHeight)}）` : "-"],
        ["文件大小", template.videoBytes ? formatTemplateBytes(template.videoBytes) : "-"],
        ["允许下载", template.allowDownload ? "允许" : "不允许"],
        [template.ecommerce ? "作品类型" : "画布工程", template.ecommerce ? "电商视频" : `${template.nodeCount} 个节点 · ${template.connectionCount} 条连线`],
        ["点赞", String(template.likeCount)],
        ["投稿时间", formatTime(template.createdAt)],
        ["上架时间", formatTime(template.publishedAt)],
        ["审核时间", formatTime(template.reviewedAt)],
    ];
    return (
        <div className="space-y-4">
            {!template.ecommerce ? (
                <video key={template.id} src={canvasTemplateMediaUrl(template.videoUrl)} poster={canvasTemplateMediaUrl(template.coverUrl)} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-black object-contain" />
            ) : null}
            <div>
                <div className="mb-1.5 text-xs text-white/45">封面</div>
                <img src={canvasTemplateMediaUrl(template.coverUrl)} alt="封面" className="aspect-video w-40 rounded-lg object-cover" />
            </div>
            {template.description ? (
                <div>
                    <div className="mb-1 text-xs text-white/45">作品简介</div>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-white/80">{template.description}</p>
                </div>
            ) : null}
            {template.tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {template.tags.map((tag) => (
                        <span key={tag} className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/75">
                            #{tag}
                        </span>
                    ))}
                </div>
            ) : null}
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
                {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                        <dt className="text-white/45">{label}</dt>
                        <dd className="m-0 min-w-0 break-words text-white/85">{value}</dd>
                    </div>
                ))}
            </dl>
            {template.reviewNote ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-[13px]">
                    <div className="mb-1 text-xs text-white/45">审核说明</div>
                    <div className="whitespace-pre-wrap text-white/80">{template.reviewNote}</div>
                </div>
            ) : null}
            <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs text-white/45">
                    <Flag className="size-3.5" />
                    举报记录（{reports.length}）
                </div>
                {reports.length ? (
                    <ul className="m-0 list-none space-y-2 p-0">
                        {reports.map((report, index) => (
                            <li key={`${report.createdAt}-${index}`} className="rounded-lg bg-white/[0.04] px-3 py-2 text-[13px]">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-red-300">{reportReasonLabel(report.reason)}</span>
                                    <span className="text-[11px] text-white/40">{formatTime(report.createdAt)}</span>
                                </div>
                                {report.detail ? <div className="mt-1 whitespace-pre-wrap text-white/70">{report.detail}</div> : null}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-xs text-white/35">暂无举报</div>
                )}
            </div>
        </div>
    );
}

function ReviewNotePopover({
    title,
    presets,
    required = false,
    okText,
    loading,
    onConfirm,
    children,
}: {
    title: string;
    presets: string[];
    required?: boolean;
    okText: string;
    loading: boolean;
    onConfirm: (note: string) => Promise<boolean>;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState("");
    const confirm = async () => {
        if (required && !note.trim()) return;
        if (await onConfirm(note.trim())) {
            setOpen(false);
            setNote("");
        }
    };
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottomRight"
            zIndex={1100}
            title={title}
            content={
                <div className="w-80 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                        {presets.map((preset) => (
                            <button key={preset} type="button" className="rounded-full border border-border px-2 py-0.5 text-xs transition hover:border-primary hover:text-primary" onClick={() => setNote(preset)}>
                                {preset}
                            </button>
                        ))}
                    </div>
                    <Input.TextArea value={note} maxLength={300} showCount autoSize={{ minRows: 3, maxRows: 5 }} placeholder={required ? "请填写原因，作者会看到这条说明" : "选填"} onChange={(event) => setNote(event.target.value)} />
                    <div className="flex justify-end gap-2 pt-1">
                        <Button size="small" onClick={() => setOpen(false)}>
                            取消
                        </Button>
                        <Button size="small" type="primary" danger loading={loading} disabled={required && !note.trim()} onClick={() => void confirm()}>
                            {okText}
                        </Button>
                    </div>
                </div>
            }
        >
            {children}
        </Popover>
    );
}
