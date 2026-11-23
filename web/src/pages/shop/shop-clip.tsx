import { App, Button, Progress, Select } from "antd";
import { Captions, Check, Download, Film, Layers, LoaderCircle, Plus, RefreshCw, Scissors, Shuffle } from "lucide-react";
import { useRef, useState } from "react";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { resourceFileUrl } from "@/services/api/resources";
import { downloadBrowserMedia } from "@/services/browser-download";
import { useUserStore } from "@/stores/use-user-store";
import type { ClipMode, ClipProject } from "@/services/api/video-edit";
import { ResizablePanes } from "./resizable-panes";
import { CLIP_TOOLS, clipRunning, clipStatusLabel } from "./clip/clip-model";
import { ClipComposer, type ClipComposerHandle } from "./clip/clip-composer";
import { ClipPlanEditor } from "./clip/clip-plan-editor";
import { ClipSubject } from "./clip/clip-subject";
import { useVideoEdit } from "./clip/use-video-edit";
import "./shop-clip.css";

const TOOL_ICONS = { koubo: Scissors, mix: Shuffle, subtitle: Captions, behind: Layers };

export default function ShopClip() {
    const scope = useUserStore((state) => state.user?.id || "");
    return scope ? <ClipWorkspace key={scope} scope={scope} /> : null;
}

function ClipWorkspace({ scope }: { scope: string }) {
    const { modal } = App.useApp();
    const state = useVideoEdit(scope);
    const composer = useRef<ClipComposerHandle>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [mobileTab, setMobileTab] = useState<"create" | "history">("create");
    const [filter, setFilter] = useState<"all" | "running" | "done">("all");
    const [downloading, setDownloading] = useState("");
    const tool = CLIP_TOOLS.find((item) => item.id === state.mode)!;
    const Icon = TOOL_ICONS[state.mode];
    const current = state.selected;
    const running = clipRunning(current);
    const editable = !state.blocked && (!current || current.status === "ready");
    const ready = current?.status === "ready";
    const completed = current?.status === "succeeded";
    const failed = current?.status === "failed" || current?.status === "cancelled";
    const previewId = completed && current.outputResourceId ? current.outputResourceId : state.source?.resourceId;
    const filtered = state.projects.filter((project) => filter === "all" || (filter === "running" ? clipRunning(project) : project.status === "succeeded"));
    const download = async (project: ClipProject) => {
        if (!project.outputResourceId || downloading) return;
        setDownloading(project.id);
        try {
            await downloadBrowserMedia({ storageKey: `resource:${project.outputResourceId}`, fileName: `${project.title || "剪辑成片"}.mp4` });
        } catch (e) {
            state.setError(`下载未完成：${e instanceof Error ? e.message : "请再次下载。"}`);
        } finally {
            setDownloading("");
        }
    };
    const change = async (next: () => void) => {
        if (state.busy || state.upload) return;
        if (ready && state.dirty) {
            if (state.planError) {
                state.setError(`切换前请先修正校对内容：${state.planError}`);
                return;
            }
            if (!(await state.save())) return;
        }
        next();
    };
    const choose = (mode: ClipMode) => {
        void change(() => {
            state.chooseMode(mode);
            setMobileTab("create");
        });
    };
    const select = (project: ClipProject) => {
        void change(() => {
            state.select(project);
            setMobileTab("create");
        });
    };
    const submit = () => {
        if (ready) void state.render();
        else if (failed && current) void state.retry(current);
        else void state.analyze();
    };

    return (
        <div className="scl-shell ms-scope" data-mobile-tab={mobileTab}>
            <div className="scl-mobile-tabs">
                <Button type={mobileTab === "create" ? "primary" : "text"} onClick={() => setMobileTab("create")}>
                    剪辑
                </Button>
                <Button type={mobileTab === "history" ? "primary" : "text"} onClick={() => setMobileTab("history")}>
                    生成历史
                </Button>
            </div>
            <ResizablePanes
                storageKey="shop-clip"
                className="sp-page scl-page"
                defaults={{ left: 248, right: 360 }}
                leftLimits={{ min: 200, max: 420 }}
                rightLimits={{ min: 260, max: Number.POSITIVE_INFINITY }}
                centerMin={400}
                left={
                    <nav className="scl-nav" aria-label="视频剪辑功能">
                        <h1>视频剪辑</h1>
                        {CLIP_TOOLS.map((item) => {
                            const ToolIcon = TOOL_ICONS[item.id];
                            return (
                                <button key={item.id} type="button" className="scl-tool" aria-pressed={state.mode === item.id} disabled={state.blocked} onClick={() => choose(item.id)}>
                                    <span className="scl-tool-icon">
                                        <ToolIcon size={18} />
                                    </span>
                                    <span>
                                        <strong>{item.title}</strong>
                                        <small>{item.description}</small>
                                    </span>
                                </button>
                            );
                        })}
                        <p className="scl-nav-note">上传已有视频，剪成可发布的作品。</p>
                    </nav>
                }
                center={
                    <main className="scl-center" aria-label={tool.title}>
                        <header className="scl-center-head">
                            <span>{tool.title}</span>
                            {current && (
                                <AntTooltip title="重新读取项目">
                                    <Button
                                        type="text"
                                        aria-label="重新读取项目"
                                        disabled={state.busy || Boolean(state.upload)}
                                        icon={<RefreshCw size={14} />}
                                        onClick={() => {
                                            if (state.dirty) modal.confirm({ title: "重新读取项目？", content: "未保存的校对会被服务器上的版本替换。", okText: "重新读取", cancelText: "保留修改", onOk: () => state.reload() });
                                            else void state.reload();
                                        }}
                                    />
                                </AntTooltip>
                            )}
                            <Button type="text" icon={<Plus size={15} />} disabled={state.busy || Boolean(state.upload)} onClick={() => void change(state.startNew)}>
                                新建
                            </Button>
                        </header>
                        <div className="scl-stage">
                            {previewId ? (
                                <>
                                    {state.mode === "behind" && !completed && state.source ? (
                                        <ClipSubject source={state.source} startMs={state.trimStartMs} box={state.subjectBox} onChange={state.setSubjectBox} disabled={!editable} />
                                    ) : (
                                        <div className="scl-preview" data-editing={ready || undefined}>
                                            <video
                                                ref={video}
                                                key={`${previewId}:${completed ? 0 : state.trimStartMs}`}
                                                src={resourceFileUrl(previewId)}
                                                controls
                                                playsInline
                                                preload="metadata"
                                                onLoadedMetadata={(event) => {
                                                    if (!completed) event.currentTarget.currentTime = state.trimStartMs / 1000;
                                                }}
                                                onError={() => state.setError("视频预览读取失败，可以重新获取历史或重新上传素材。")}
                                            />
                                            <span>{completed ? "剪辑成片" : "原视频 · 生成后查看字幕与剪辑效果"}</span>
                                        </div>
                                    )}
                                    {running && current && (
                                        <div className="scl-progress" role="status">
                                            <LoaderCircle size={20} className="scl-spin" />
                                            <strong>{current.stage || clipStatusLabel(current)}</strong>
                                            <Progress percent={Math.max(0, Math.min(100, current.progress || 0))} showInfo={false} />
                                            <Button size="small" disabled={state.busy} onClick={() => void state.cancel(current)}>
                                                取消任务
                                            </Button>
                                        </div>
                                    )}
                                    {current?.plan.director && (
                                        <section className="scl-direction" aria-label="剪辑思路">
                                            <div>
                                                <strong>剪辑思路</strong>
                                                {current.plan.director.categoryPath && <span>{current.plan.director.categoryPath}</span>}
                                            </div>
                                            <p>{current.plan.director.summary}</p>
                                            {current.plan.director.evidence?.length > 0 && (
                                                <details>
                                                    <summary>查看内容依据</summary>
                                                    <ul>
                                                        {current.plan.director.evidence.map((item, index) => (
                                                            <li key={`${index}:${item}`}>{item}</li>
                                                        ))}
                                                    </ul>
                                                </details>
                                            )}
                                        </section>
                                    )}
                                    {state.plan && ready && (
                                        <ClipPlanEditor
                                            key={`${current?.id}:${state.editorRevision}`}
                                            plan={state.plan}
                                            mode={state.mode}
                                            materials={state.materials}
                                            disabled={!editable}
                                            onChange={state.patchPlan}
                                            canUndoCaptions={state.canUndoCaptions}
                                            canRedoCaptions={state.canRedoCaptions}
                                            onUndoCaptions={state.undoCaptions}
                                            onRedoCaptions={state.redoCaptions}
                                            onCaptionEditEnd={state.endCaptionEdit}
                                            onSeek={(seconds) => {
                                                if (video.current) {
                                                    video.current.currentTime = seconds + state.trimStartMs / 1000;
                                                    void video.current.play().catch(() => undefined);
                                                }
                                            }}
                                        />
                                    )}
                                    {completed && current && (
                                        <div className="scl-complete">
                                            <Check size={16} />
                                            <span>成片已保存</span>
                                            <Button icon={<Download size={15} />} loading={downloading === current.id} onClick={() => void download(current)}>
                                                下载视频
                                            </Button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="scl-empty-stage">
                                    <span className="scl-empty-icon">
                                        <Icon size={28} />
                                    </span>
                                    <span className="scl-empty-kicker">把素材里的亮点，剪成作品</span>
                                    <h2>{tool.title}</h2>
                                    <p>
                                        {state.mode === "mix"
                                            ? "让口播引导画面，用合适的素材与转场，让商品故事更完整。"
                                            : state.mode === "behind"
                                              ? "用人物与大字构建画面层次，让重要的一句话被看见。"
                                              : state.mode === "subtitle"
                                                ? "把每一句表达变成清晰字幕，让内容在静音时也能被理解。"
                                                : "留下有价值的表达，用字幕、花字与画面节奏，让亮点自然被看见。"}
                                    </p>
                                    <ol>
                                        <li>
                                            <button type="button" onClick={() => composer.current?.openMedia()}>
                                                <span>1</span>选取表达素材
                                            </button>
                                        </li>
                                        <li>
                                            <button type="button" onClick={() => composer.current?.openTemplates()}>
                                                <span>2</span>
                                                {state.mode === "behind" ? "选择人物视频" : "找到剪辑风格"}
                                            </button>
                                        </li>
                                        <li>
                                            <button type="button" onClick={() => composer.current?.focusTitle()}>
                                                <span>3</span>为成片命名，开始创作
                                            </button>
                                        </li>
                                    </ol>
                                </div>
                            )}
                        </div>
                        <ClipComposer ref={composer} state={state} onSubmit={submit} />
                    </main>
                }
                right={
                    <aside className="scl-history" aria-label="生成历史">
                        <header className="scl-history-head">
                            <h2>生成历史</h2>
                            <AntTooltip title="重新获取历史">
                                <Button type="text" aria-label="重新获取历史" icon={<RefreshCw size={15} />} loading={state.loading} onClick={() => void state.refresh()} />
                            </AntTooltip>
                        </header>
                        <div className="scl-history-filter">
                            <Select
                                aria-label="筛选生成历史"
                                value={filter}
                                options={[
                                    { value: "all", label: "全部作品" },
                                    { value: "running", label: "生成中" },
                                    { value: "done", label: "已完成" },
                                ]}
                                onChange={setFilter}
                            />
                        </div>
                        <div className="scl-history-scroll">
                            {state.busy && !current && (
                                <div className="scl-history-empty" role="status">
                                    <LoaderCircle className="scl-spin" size={22} />
                                    <strong>正在提交素材</strong>
                                </div>
                            )}
                            {state.historyError && (
                                <p className="scl-error" role="alert">
                                    {state.historyError}
                                </p>
                            )}
                            {state.loading ? (
                                <p className="scl-muted">正在读取剪辑历史…</p>
                            ) : !filtered.length ? (
                                <div className="scl-history-empty">
                                    <Film size={24} />
                                    <strong>{filter === "all" ? "还没有剪辑成片" : "没有符合条件的作品"}</strong>
                                    <p>{filter === "all" ? "选好素材与风格，为作品命名，第一条成片会出现在这里。" : "切换为全部作品查看历史。"}</p>
                                </div>
                            ) : (
                                <div className="scl-history-grid">
                                    {filtered.map((project) => (
                                        <article className="scl-history-item" key={project.id} data-selected={current?.id === project.id || undefined}>
                                            {project.outputResourceId && project.status === "succeeded" && <video src={resourceFileUrl(project.outputResourceId)} controls playsInline preload="metadata" />}
                                            <button type="button" className="scl-history-open" disabled={state.busy || Boolean(state.upload)} onClick={() => select(project)}>
                                                <strong>{project.title || CLIP_TOOLS.find((item) => item.id === project.mode)?.title || "剪辑作品"}</strong>
                                                <span>
                                                    {clipStatusLabel(project)} · {new Date(project.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                            </button>
                                            {clipRunning(project) && (
                                                <>
                                                    <p className="scl-muted">{project.stage || "正在处理素材…"}</p>
                                                    <Progress percent={Math.max(0, Math.min(100, project.progress || 0))} showInfo={false} />
                                                </>
                                            )}
                                            {project.error && <p className="scl-error">{project.error}</p>}
                                            <div className="scl-history-actions">
                                                {clipRunning(project) ? (
                                                    <Button type="text" size="small" disabled={state.busy} onClick={() => void state.cancel(project)}>
                                                        取消任务
                                                    </Button>
                                                ) : project.status === "succeeded" ? (
                                                    <Button type="text" size="small" icon={<Download size={14} />} loading={downloading === project.id} onClick={() => void download(project)}>
                                                        下载视频
                                                    </Button>
                                                ) : project.status === "ready" ? (
                                                    <Button type="text" size="small" disabled={state.busy || Boolean(state.upload)} onClick={() => select(project)}>
                                                        继续校对
                                                    </Button>
                                                ) : (
                                                    <AntTooltip title={state.retryAvailability(project) || undefined}>
                                                        <span>
                                                            <Button type="text" size="small" disabled={state.busy || Boolean(state.upload) || Boolean(state.retryAvailability(project))} onClick={() => select(project)}>
                                                                查看并重试
                                                            </Button>
                                                        </span>
                                                    </AntTooltip>
                                                )}
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </div>
                    </aside>
                }
            />
        </div>
    );
}
