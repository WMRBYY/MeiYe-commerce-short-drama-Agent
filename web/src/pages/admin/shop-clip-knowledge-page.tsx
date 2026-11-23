import { useEffect, useMemo, useState } from "react";
import { Alert, App, Breadcrumb, Button, Input, Space, Table, Tag, Typography } from "antd";
import { ArrowUpRight, BookOpen, FolderTree, RefreshCw, Search } from "lucide-react";
import { Link } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { EmptyState } from "@/components/ui/product/empty-state";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminSegmented, AdminSelect, AdminSwitch } from "./ui/controls";
import ShopClipPricingPanel from "./shop-clip-pricing-panel";
import { getClipKnowledge, getClipKnowledgeCategories, updateClipKnowledge, type ClipKnowledgeCategory, type ClipKnowledgeCategoryPage, type ClipKnowledgeEntry, type ClipKnowledgeStatus } from "@/services/api/clip-knowledge";
import "./shop-clip-knowledge-page.css";

const scopes: Record<string, string> = {
    category: "行业策略",
    family: "细分策略",
    principle: "剪辑原则",
    pacing: "节奏与叙事",
    material: "素材编排",
    transition: "转场",
    sound: "声音",
    subtitle: "字幕与花字",
    component: "组件与排版",
    filter: "滤镜",
    qa: "成片检查",
    source: "来源规则",
};

type View = "knowledge" | "categories" | "sources" | "pricing";

export default function ShopClipKnowledgePage() {
    const { message } = App.useApp();
    const [data, setData] = useState<ClipKnowledgeStatus>();
    const [view, setView] = useState<View>("knowledge");
    const [scope, setScope] = useState("all");
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [refresh, setRefresh] = useState(0);
    const [pending, setPending] = useState("");
    const [editing, setEditing] = useState<ClipKnowledgeEntry>();
    const [draft, setDraft] = useState("");
    const [draftEnabled, setDraftEnabled] = useState(true);
    const [saveError, setSaveError] = useState("");

    useEffect(() => {
        let active = true;
        setLoading(true);
        void getClipKnowledge()
            .then((next) => {
                if (!active) return;
                setData(next);
                setLoadError("");
            })
            .catch((error: unknown) => {
                if (active) setLoadError(error instanceof Error ? error.message : "知识库读取失败，请重试");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [refresh]);

    const entries = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return (data?.entries ?? []).filter((entry) => (scope === "all" || entry.scope === scope) && (!keyword || [entry.name, entry.description, entry.categoryPath ?? "", entry.content].some((text) => text.toLowerCase().includes(keyword))));
    }, [data, scope, query]);

    const openEditor = (entry: ClipKnowledgeEntry) => {
        if (pending) return;
        setEditing(entry);
        setDraft(entry.content);
        setDraftEnabled(entry.enabled);
        setSaveError("");
    };

    const save = async (entry: ClipKnowledgeEntry, content: string, enabled: boolean, close: boolean) => {
        if (pending) return;
        setPending(entry.id);
        setSaveError("");
        try {
            const next = await updateClipKnowledge([{ id: entry.id, content, enabled }]);
            setData(next);
            if (close) setEditing(undefined);
            void message.success(close ? "剪辑知识已保存" : enabled ? "已启用，下次分析时生效" : "已停用，下次分析时生效");
        } catch (error) {
            const text = error instanceof Error ? error.message : "保存失败，请重试";
            if (close) setSaveError(text);
            else void message.error(text);
        } finally {
            setPending("");
        }
    };

    const sourceLinks = (entry: ClipKnowledgeEntry) => entry.sourceIds.map((id) => data?.sources.find((source) => source.id === id)).filter((source) => source !== undefined);
    const taxonomy = data?.coverage.taxonomy;
    return (
        <AdminPageFrame
            title="剪辑知识库"
            description="按视频品类调用剪法、字幕、转场与成片检查规则。"
            scroll
            actions={
                <Button icon={<RefreshCw size={14} />} loading={loading} disabled={!!pending} onClick={() => setRefresh((value) => value + 1)}>
                    刷新
                </Button>
            }
        >
            <div className="clip-kb-page">
                {loadError ? <Alert type="error" showIcon message={loadError} /> : null}
                <div className="clip-kb-summary">
                    <div>
                        <strong>{data?.coverage.rootStrategies ?? "—"}</strong>
                        <span>套行业剪法</span>
                    </div>
                    <div>
                        <strong>{data?.coverage.familyStrategies ?? "—"}</strong>
                        <span>套细分剪法</span>
                    </div>
                    <div>
                        <strong>{taxonomy?.level2 ?? "—"}</strong>
                        <span>个二级品类</span>
                    </div>
                    <div>
                        <strong>{taxonomy?.nodes.toLocaleString() ?? "—"}</strong>
                        <span>个分类节点</span>
                    </div>
                    <Link className="clip-kb-model-link" to={data?.modelConfigurationPath ?? "/admin/video-agent/models"}>
                        配置识别模型 <ArrowUpRight size={14} />
                    </Link>
                </div>
                <div className="clip-kb-toolbar">
                    <AdminSegmented<View>
                        ariaLabel="剪辑知识库视图"
                        value={view}
                        onChange={setView}
                        options={[
                            { value: "knowledge", label: "策略与技巧" },
                            { value: "categories", label: "品类映射" },
                            { value: "sources", label: "开源来源" },
                            { value: "pricing", label: "剪辑计费" },
                        ]}
                    />
                    <span className="clip-kb-muted">{data?.version}</span>
                </div>
                {view === "pricing" ? <ShopClipPricingPanel refresh={refresh} /> : null}
                {view === "knowledge" ? (
                    <>
                        <div className="clip-kb-toolbar">
                            <Input className="clip-kb-search" prefix={<Search size={14} />} placeholder="搜索品类、剪法或字幕技巧" allowClear value={query} onChange={(event) => setQuery(event.target.value)} />
                            <AdminSelect ariaLabel="知识类型" value={scope} onChange={setScope} options={[{ value: "all", label: "全部类型" }, ...Object.entries(scopes).map(([value, label]) => ({ value, label }))]} />
                            <span className="clip-kb-muted">{entries.length} 条规则 · 修改仅用于后续分析</span>
                        </div>
                        <Table<ClipKnowledgeEntry>
                            rowKey="id"
                            size="small"
                            loading={loading}
                            dataSource={entries}
                            pagination={{ pageSize: 15, showSizeChanger: false, hideOnSinglePage: true }}
                            scroll={{ x: 720 }}
                            columns={[
                                {
                                    title: "策略与技巧",
                                    key: "name",
                                    render: (_, entry) => (
                                        <div className="clip-kb-entry">
                                            <button type="button" className="clip-kb-entry-name" disabled={!!pending} onClick={() => openEditor(entry)}>
                                                {entry.name}
                                            </button>
                                            <span>{entry.description}</span>
                                        </div>
                                    ),
                                },
                                {
                                    title: "适用范围",
                                    key: "scope",
                                    width: 210,
                                    render: (_, entry) => (
                                        <div className="clip-kb-entry">
                                            <span>{scopes[entry.scope] ?? entry.scope}</span>
                                            {entry.categoryPath ? <small>{entry.categoryPath}</small> : <small>各品类通用</small>}
                                        </div>
                                    ),
                                },
                                { title: "内容", key: "customized", width: 100, render: (_, entry) => <Tag>{entry.customized ? "已调整" : "内置规则"}</Tag> },
                                {
                                    title: "启用",
                                    key: "enabled",
                                    width: 70,
                                    render: (_, entry) => (
                                        <AdminSwitch
                                            aria-label={`启用${entry.name}`}
                                            size="sm"
                                            checked={entry.enabled}
                                            disabled={!!pending || loading}
                                            loading={pending === entry.id}
                                            onChange={(enabled) => void save(entry, entry.content, enabled, false)}
                                        />
                                    ),
                                },
                                {
                                    title: "操作",
                                    key: "actions",
                                    width: 70,
                                    render: (_, entry) => (
                                        <Button type="link" size="small" disabled={!!pending} onClick={() => openEditor(entry)}>
                                            编辑
                                        </Button>
                                    ),
                                },
                            ]}
                        />
                    </>
                ) : null}
                {view === "categories" ? (
                    <ClipCategoryMapping
                        refresh={data?.updatedAt ?? ""}
                        note={data?.coverage.inheritanceNote ?? "子品类继承最近上级策略。"}
                        onOpenStrategy={(id) => {
                            const entry = data?.entries.find((item) => item.id === id);
                            if (entry) openEditor(entry);
                        }}
                    />
                ) : null}
                {view === "sources" ? (
                    <>
                        <Alert type="info" showIcon message="品类剪法独立编写；开源项目提供技术与流程参考。" description="来源固定到提交版本。未复制商业模板、字体、贴纸或视频素材；有开源链接不代表对应效果已接入。" />
                        <div className="clip-kb-sources">
                            {(data?.sources ?? []).map((source) => (
                                <article key={source.id} className="clip-kb-source">
                                    <div className="clip-kb-source-heading">
                                        <BookOpen size={17} />
                                        <a href={source.repository} target="_blank" rel="noreferrer">
                                            {source.name}
                                        </a>
                                        <Tag>{source.license}</Tag>
                                    </div>
                                    <p>{source.use}</p>
                                    <div className="clip-kb-source-meta">
                                        <a href={`${source.repository}/tree/${source.commit}`} target="_blank" rel="noreferrer">
                                            固定提交 {source.commit.slice(0, 12)}
                                        </a>
                                        <a href={source.licenseUrl} target="_blank" rel="noreferrer">
                                            查看许可证 <ArrowUpRight size={12} />
                                        </a>
                                    </div>
                                </article>
                            ))}
                        </div>
                        <Button
                            className="clip-kb-source-edit"
                            onClick={() => {
                                const entry = data?.entries.find((item) => item.id === "source:policy");
                                if (entry) openEditor(entry);
                            }}
                        >
                            编辑来源使用规则
                        </Button>
                    </>
                ) : null}
            </div>
            <AppModal
                rootClassName="admin-modal-root"
                className="clip-kb-editor"
                width={760}
                open={!!editing}
                title={editing?.name}
                onCancel={() => {
                    if (!pending) setEditing(undefined);
                }}
                closable={!pending}
                maskClosable={!pending}
                keyboard={!pending}
                footer={
                    <div className="clip-kb-editor-footer">
                        <Button disabled={!!pending} onClick={() => setDraft(editing?.defaultContent ?? "")}>
                            恢复内置内容
                        </Button>
                        <Space>
                            <Button disabled={!!pending} onClick={() => setEditing(undefined)}>
                                取消
                            </Button>
                            <Button type="primary" loading={!!pending} disabled={!editing || !draft.trim() || Array.from(draft).length > 6000} onClick={() => editing && void save(editing, draft, draftEnabled, true)}>
                                保存条目
                            </Button>
                        </Space>
                    </div>
                }
            >
                {editing ? (
                    <div className="clip-kb-editor-body">
                        <p className="clip-kb-muted">{editing.description}</p>
                        {editing.categoryPath ? <div className="clip-kb-category-path">{editing.categoryPath}</div> : null}
                        <label className="clip-kb-enable">
                            <span>用于后续剪辑分析</span>
                            <AdminSwitch aria-label="用于后续剪辑分析" checked={draftEnabled} disabled={!!pending} onChange={setDraftEnabled} />
                        </label>
                        <Input.TextArea
                            aria-label="剪辑规则内容"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            autoSize={{ minRows: 12, maxRows: 20 }}
                            showCount
                            count={{ max: 6000, strategy: (value) => Array.from(value).length }}
                            disabled={!!pending}
                        />
                        <span className="clip-kb-muted">写清触发条件、镜头顺序、字幕和禁用情况；可执行效果以已开放的渲染能力为准。</span>
                        {sourceLinks(editing).length ? (
                            <div className="clip-kb-editor-sources">
                                <span>参考来源</span>
                                {sourceLinks(editing).map((source) => (
                                    <a key={source.id} href={`${source.repository}/tree/${source.commit}`} target="_blank" rel="noreferrer">
                                        {source.name}
                                    </a>
                                ))}
                            </div>
                        ) : null}
                        {saveError ? <Alert type="error" showIcon message={saveError} /> : null}
                    </div>
                ) : null}
            </AppModal>
        </AdminPageFrame>
    );
}

function ClipCategoryMapping({ refresh, note, onOpenStrategy }: { refresh: string; note: string; onOpenStrategy: (id: string) => void }) {
    const [data, setData] = useState<ClipKnowledgeCategoryPage>();
    const [parent, setParent] = useState("");
    const [query, setQuery] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        setLoading(true);
        void getClipKnowledgeCategories(parent, query, page)
            .then((next) => {
                if (active) {
                    setData(next);
                    setError("");
                }
            })
            .catch((cause: unknown) => {
                if (active) setError(cause instanceof Error ? cause.message : "品类读取失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [parent, query, page, refresh]);
    const open = (id: string) => {
        setParent(id);
        setQuery("");
        setSearch("");
        setPage(1);
    };
    return (
        <div className="clip-kb-mapping">
            <Alert type="info" showIcon message={note} />
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <div className="clip-kb-toolbar">
                <Input.Search
                    className="clip-kb-search"
                    value={search}
                    allowClear
                    placeholder="搜索分类名称、英文或 ID"
                    onChange={(event) => setSearch(event.target.value)}
                    onSearch={(value) => {
                        setQuery(value);
                        setParent("");
                        setPage(1);
                    }}
                />
                <Button icon={<FolderTree size={14} />} onClick={() => open("")}>
                    全部行业
                </Button>
            </div>
            <Breadcrumb
                items={[
                    {
                        title: (
                            <button type="button" className="clip-kb-link" onClick={() => open("")}>
                                全部行业
                            </button>
                        ),
                    },
                    ...(data?.lineage ?? [])
                        .slice()
                        .reverse()
                        .map((node) => ({
                            title: (
                                <button type="button" className="clip-kb-link" onClick={() => open(node.id)}>
                                    {node.name}
                                </button>
                            ),
                        })),
                ]}
            />
            <Table<ClipKnowledgeCategory>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={data?.items ?? []}
                expandable={{ childrenColumnName: "nestedCategories" }}
                scroll={{ x: 650 }}
                locale={{ emptyText: <EmptyState size="compact" title="没有找到对应品类" description="换一个品类名称或分类 ID 试试" /> }}
                pagination={{ current: page, pageSize: 40, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage, hideOnSinglePage: true }}
                columns={[
                    {
                        title: "品类",
                        key: "name",
                        render: (_, item) => (
                            <div className="clip-kb-entry">
                                {item.children ? (
                                    <button type="button" className="clip-kb-entry-name" onClick={() => open(item.id)}>
                                        {item.name}
                                    </button>
                                ) : (
                                    <Typography.Text strong>{item.name}</Typography.Text>
                                )}
                                <small>{item.path}</small>
                                <small>{item.id}</small>
                            </div>
                        ),
                    },
                    { title: "下级", key: "children", width: 85, render: (_, item) => (item.children ? `${item.children} 个` : "叶级品类") },
                    {
                        title: "实际策略来源",
                        key: "strategy",
                        width: 300,
                        render: (_, item) =>
                            item.strategyId ? (
                                <div className="clip-kb-entry">
                                    <Tag>{item.inherited ? "继承上级" : "本级策略"}</Tag>
                                    <button type="button" className="clip-kb-entry-name" onClick={() => onOpenStrategy(item.strategyId)}>
                                        {item.strategyPath}
                                    </button>
                                    <small>{item.strategyId}</small>
                                </div>
                            ) : (
                                <span className="clip-kb-muted">品类策略已停用，仅使用通用规则</span>
                            ),
                    },
                ]}
            />
        </div>
    );
}
