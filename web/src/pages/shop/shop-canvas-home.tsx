import { useEffect, useMemo, useState } from "react";
import { App, Button, Input } from "antd";
import { ShopCanvasGlyph } from "./shop-canvas-glyph";
import { useNavigate } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { useUserStore } from "@/stores/use-user-store";
import { readShopCanvasProjects, saveShopCanvasProjects } from "./shop-canvas-projects";
import { useShopScope } from "./shop-context";
import { copyWorkflowProject, readShopWorkflows, SYSTEM_WORKFLOWS, type ShopWorkflow } from "./shop-canvas-workflows";
import { ShopWorkflowGraph, ShopWorkflowPreview } from "./shop-workflow-preview";
import { ShopCanvasProjectCard } from "./shop-canvas-project-card";
import "./shop-canvas-home.css";

export default function ShopCanvasHome() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id || "guest");
    const [projects, setProjects] = useState(() => readShopCanvasProjects(userId));
    const [creating, setCreating] = useState(false);
    const [draft, setDraft] = useState("");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("全部");
    const [view, setView] = useState<"grid" | "list">("grid");
    const scope = useShopScope();
    const [templates, setTemplates] = useState<ShopWorkflow[]>([]);
    const [preview, setPreview] = useState<ShopWorkflow | null>(null);
    const [copying, setCopying] = useState(false);
    useEffect(() => {
        let alive = true;
        setProjects(readShopCanvasProjects(userId));
        void readShopWorkflows(scope)
            .then((value) => {
                if (alive) setTemplates(value);
            })
            .catch(() => message.error("工作流读取失败，请重试"));
        return () => {
            alive = false;
        };
    }, [scope, userId]);
    const copy = async () => {
        if (!preview || copying) return;
        setCopying(true);
        try {
            const project = await copyWorkflowProject(scope, userId, preview);
            navigate(`/shop/canvas/${project.id}`);
        } catch {
            message.error("复制失败，请检查浏览器存储空间后重试");
        } finally {
            setCopying(false);
        }
    };
    const visible = useMemo(() => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [projects]);
    const visibleWorkflows = SYSTEM_WORKFLOWS.filter((workflow) => (category === "全部" || workflow.category === category) && `${workflow.name} ${workflow.description}`.toLowerCase().includes(query.trim().toLowerCase()));
    const create = () => {
        const project = { id: crypto.randomUUID(), name: draft.trim() || "未命名画布", updatedAt: new Date().toISOString() };
        try {
            saveShopCanvasProjects(userId, [project, ...projects]);
            navigate(`/shop/canvas/${project.id}`);
        } catch {
            message.error("画布创建失败，请检查浏览器存储空间后重试");
        }
    };
    return (
        <main className="sp-canvas-home ms-scope" aria-label="电商画布项目">
            <section className="sp-canvas-home-content">
                <header className="sp-canvas-home-heading">
                    <div>
                        <h1>项目</h1>
                        <span>{projects.length} 个 · 当前账号的本机项目</span>
                    </div>
                    <div role="group" aria-label="排列方式">
                        <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} title="网格排列">
                            <ShopCanvasGlyph name="grid" size={18} />
                        </button>
                        <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} title="列表排列">
                            <ShopCanvasGlyph name="list" size={18} />
                        </button>
                    </div>
                </header>
                <div className={`sp-canvas-projects is-${view}`}>
                    <button
                        type="button"
                        className="sp-canvas-project sp-canvas-create"
                        onClick={() => {
                            setDraft("");
                            setCreating(true);
                        }}
                    >
                        <span className="sp-canvas-project-preview">
                            <ShopCanvasGlyph name="nodes" size={30} />
                        </span>
                        <strong>新建项目</strong>
                    </button>
                    {visible.map((project) => (
                        <ShopCanvasProjectCard key={`${userId}:${project.id}`} project={project} scope={scope} userId={userId} onOpen={() => navigate(`/shop/canvas/${project.id}`)} onChange={() => setProjects(readShopCanvasProjects(userId))} />
                    ))}
                </div>
                <section className="sp-canvas-workflows">
                    <div>
                        <h2>画布工作流推荐</h2>
                        <p>查看制作链路，复制后替换素材即可开始创作。</p>
                    </div>
                    <label>
                        <ShopCanvasGlyph name="search" size={18} />
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作流" aria-label="搜索工作流" />
                    </label>
                    <div className="sp-workflow-filters" role="group" aria-label="工作流分类">
                        {["全部", "商品", "服饰", "视频"].map((value) => (
                            <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>
                                {value}
                            </button>
                        ))}
                    </div>
                    <div className="sp-workflow-cards">
                        {visibleWorkflows.map((workflow) => (
                            <button key={workflow.id} className="sp-workflow-card" onClick={() => setPreview(workflow)}>
                                <div>
                                    {workflow.cover ? <img src={workflow.cover} alt={workflow.name} loading="lazy" /> : <ShopWorkflowGraph workflow={workflow} />}
                                    <span>
                                        查看制作链路 <ShopCanvasGlyph name="arrow-up-right" size={17} />
                                    </span>
                                </div>
                                <strong>{workflow.name}</strong>
                                <small>{workflow.description}</small>
                                {workflow.limitation ? <small className="sp-workflow-limit">{workflow.limitation}</small> : null}
                            </button>
                        ))}
                    </div>
                    {!visibleWorkflows.length ? <p className="sp-canvas-workflow-empty">没有匹配的工作流，试试其他关键词或分类。</p> : null}
                    {templates.length ? (
                        <>
                            <div>
                                <h2>我的工作流</h2>
                                <p>当前账号保存在本机的制作流程</p>
                            </div>
                            <div className="sp-workflow-cards">
                                {templates.map((workflow) => (
                                    <button key={workflow.id} className="sp-workflow-card" onClick={() => setPreview(workflow)}>
                                        <div>
                                            <ShopWorkflowGraph workflow={workflow} />
                                            <span>
                                                查看制作链路 <ShopCanvasGlyph name="arrow-up-right" size={17} />
                                            </span>
                                        </div>
                                        <strong>{workflow.name}</strong>
                                        <small>{workflow.nodes.length} 个节点 · 可复制编辑</small>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : null}
                </section>
            </section>
            <AppModal open={creating} onCancel={() => setCreating(false)} title="新建画布" footer={null} destroyOnHidden className="sp-canvas-project-modal ms-scope">
                <form
                    className="sp-canvas-create-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        create();
                    }}
                >
                    <label htmlFor="shop-canvas-project-name">画布名称（可留空，默认「未命名画布」）</label>
                    <Input id="shop-canvas-project-name" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="未命名画布" autoFocus maxLength={80} />
                    <div>
                        <Button onClick={() => setCreating(false)}>取消</Button>
                        <Button type="primary" htmlType="submit">
                            创建
                        </Button>
                    </div>
                </form>
            </AppModal>
            <ShopWorkflowPreview workflow={preview} onClose={() => setPreview(null)} onCopy={() => void copy()} busy={copying} />
        </main>
    );
}
