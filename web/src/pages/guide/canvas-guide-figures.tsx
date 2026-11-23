import type { ReactNode } from "react";
import {
    ArrowRightLeft,
    BriefcaseBusiness,
    ChevronDown,
    Clapperboard,
    CloudCheck,
    CloudDownload,
    Compass,
    Eraser,
    EyeOff,
    Focus,
    FolderOpen,
    FolderTree,
    Hand,
    HelpCircle,
    History,
    Home,
    Image as ImageIcon,
    Images,
    Layers3,
    LayoutTemplate,
    ListChecks,
    Menu,
    Minus,
    MousePointer2,
    Music2,
    Palette,
    PanelLeftOpen,
    PanelsTopLeft,
    Pencil,
    Plus,
    Redo2,
    Search,
    Send,
    Settings2,
    Share2,
    Sparkles,
    Table2,
    Type,
    Undo2,
    UserRound,
    Video,
    WandSparkles,
    Workflow,
    BookOpen,
} from "lucide-react";

/** 文档插图：用界面元素的简化复刻代替截图，跟随真实图标和文案，不依赖线上数据。 */

function Badge({ n, className = "" }: { n: number; className?: string }) {
    return <span className={`cg-badge ${className}`}>{n}</span>;
}

export function FigureFrame({ children, caption, tall = false }: { children: ReactNode; caption?: string; tall?: boolean }) {
    return (
        <figure className="cg-figure">
            <div className={`cg-figure-stage${tall ? " is-tall" : ""}`}>{children}</div>
            {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>
    );
}

function RailItem({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
    return (
        <span className={`cg-rail-item${active ? " is-active" : ""}`}>
            {icon}
            <span>{label}</span>
        </span>
    );
}

export function MockRail({ active }: { active?: string }) {
    const items = [
        { label: "主页", icon: <Home /> },
        { label: "节点", icon: <Layers3 /> },
        { label: "素材库", icon: <Images /> },
        { label: "任务", icon: <ListChecks /> },
        { label: "历史", icon: <History /> },
    ];
    return (
        <div className="cg-rail">
            {items.map((item) => <RailItem key={item.label} icon={item.icon} label={item.label} active={item.label === active} />)}
            <span className="cg-rail-gap" />
            <RailItem icon={<PanelLeftOpen />} label="展开" />
        </div>
    );
}

export function MockTopLeft() {
    return (
        <div className="cg-pill">
            <Menu />
            <strong>我的第一个画布</strong>
            <Pencil className="is-dim" />
            <CloudCheck className="is-ok" />
        </div>
    );
}

export function MockTopCenter() {
    return (
        <div className="cg-pill is-tabs">
            <span className="is-on"><Workflow />画布</span>
            <span><FolderTree />资产</span>
        </div>
    );
}

export function MockTopRight() {
    return (
        <div className="cg-pill">
            <Search />
            <span className="cg-pill-text"><CloudDownload />导入第三方画布</span>
            <span className="cg-pill-text is-credit">◆ 1,280</span>
            <Focus />
            <Share2 />
        </div>
    );
}

type DockItem = { icon: ReactNode; label: string; on?: boolean } | "sep";

function Dock({ items, labels = false, className = "" }: { items: DockItem[]; labels?: boolean; className?: string }) {
    return (
        <div className={`cg-dock ${className}`}>
            {items.map((item, index) =>
                item === "sep" ? (
                    <span key={`sep-${index}`} className="cg-dock-sep" />
                ) : (
                    <span key={item.label} className={`cg-dock-item${item.on ? " is-on" : ""}`}>
                        {item.icon}
                        {labels ? <em>{item.label}</em> : null}
                    </span>
                ),
            )}
        </div>
    );
}

export const MAIN_DOCK_ITEMS: DockItem[] = [
    { icon: <MousePointer2 />, label: "框选", on: true },
    { icon: <Hand />, label: "抓手" },
    "sep",
    { icon: <Undo2 />, label: "撤销" },
    { icon: <Redo2 />, label: "重做" },
    "sep",
    { icon: <Plus />, label: "添加节点" },
    { icon: <BriefcaseBusiness />, label: "工具箱" },
    { icon: <FolderOpen />, label: "素材库" },
    { icon: <PanelsTopLeft />, label: "工作区" },
    "sep",
    { icon: <Palette />, label: "外观" },
    { icon: <Settings2 />, label: "工具栏设置" },
    { icon: <Eraser />, label: "清空画布" },
];

export const ZOOM_DOCK_ITEMS: DockItem[] = [
    { icon: <Compass />, label: "小地图" },
    { icon: <Focus />, label: "适应画布" },
    { icon: <LayoutTemplate />, label: "自动整理" },
    { icon: <EyeOff />, label: "隐藏连线" },
    "sep",
    { icon: <Minus />, label: "缩小" },
    { icon: <span className="cg-zoom-text">100%</span>, label: "精确缩放" },
    { icon: <Plus />, label: "放大" },
    "sep",
    { icon: <HelpCircle />, label: "快捷键" },
    { icon: <BookOpen />, label: "使用说明" },
];

export function MockMainDock({ labels = false }: { labels?: boolean }) {
    return <Dock items={MAIN_DOCK_ITEMS} labels={labels} />;
}

export function MockZoomDock({ labels = false }: { labels?: boolean }) {
    return <Dock items={ZOOM_DOCK_ITEMS} labels={labels} />;
}

function NodeCard({ kind, icon, title, children, className = "", ports = "both" }: { kind: string; icon: ReactNode; title: string; children?: ReactNode; className?: string; ports?: "both" | "in" | "out" }) {
    return (
        <div className={`cg-node ${className}`}>
            <div className="cg-node-head">
                {icon}
                <span>{kind}</span>
                <em>{title}</em>
            </div>
            <div className="cg-node-body">{children}</div>
            {ports !== "out" ? <span className="cg-port is-in" /> : null}
            {ports !== "in" ? <span className="cg-port is-out" /> : null}
        </div>
    );
}

function ImagePlaceholder({ tone = "violet" }: { tone?: "violet" | "amber" | "teal" }) {
    return (
        <div className={`cg-media is-${tone}`}>
            <span className="cg-media-sun" />
            <span className="cg-media-hill" />
            <span className="cg-media-hill is-back" />
        </div>
    );
}

/** 整体界面示意：编号对应正文的说明列表。 */
export function MockOverview() {
    return (
        <div className="cg-overview">
            <div className="cg-grid-bg" />
            <div className="cg-ov-rail"><MockRail active="节点" /><Badge n={1} className="is-right" /></div>
            <div className="cg-ov-top-left"><MockTopLeft /><Badge n={2} /></div>
            <div className="cg-ov-top-center"><MockTopCenter /><Badge n={3} /></div>
            <div className="cg-ov-top-right"><MockTopRight /><Badge n={4} /></div>
            <div className="cg-ov-nodes">
                <NodeCard kind="文本" icon={<Type />} title="产品卖点" className="is-small">
                    <p className="cg-lines"><i /><i /><i className="is-short" /></p>
                </NodeCard>
                <svg className="cg-wire" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="M0 20 C 40 20, 60 20, 100 20" /></svg>
                <NodeCard kind="图片" icon={<ImageIcon />} title="主图" className="is-small">
                    <ImagePlaceholder />
                </NodeCard>
                <Badge n={5} className="is-float" />
            </div>
            <div className="cg-ov-zoom"><MockZoomDock /><Badge n={6} /></div>
            <div className="cg-ov-dock"><MockMainDock /><Badge n={7} /></div>
            <div className="cg-ov-agent"><span className="cg-agent-orb"><Sparkles /></span><Badge n={8} /></div>
        </div>
    );
}

export function MockQuickStart() {
    const steps = [
        { icon: <Plus />, title: "添加节点", text: "点「+」或双击空白处" },
        { icon: <Pencil />, title: "写下提示词", text: "描述你想要的画面" },
        { icon: <Sparkles />, title: "点击生成", text: "结果直接出现在节点里" },
    ];
    return (
        <div className="cg-steps">
            {steps.map((step, index) => (
                <div key={step.title} className="cg-step">
                    <span className="cg-step-icon">{step.icon}</span>
                    <span className="cg-step-n">0{index + 1}</span>
                    <strong>{step.title}</strong>
                    <span>{step.text}</span>
                </div>
            ))}
        </div>
    );
}

export function MockRailPanel() {
    return (
        <div className="cg-rail-panel">
            <MockRail active="素材库" />
            <div className="cg-side-panel">
                <div className="cg-side-head">素材库<span>×</span></div>
                <div className="cg-side-search"><Search />搜索名称/标签</div>
                <div className="cg-chip-row"><span className="is-on">全部</span><span>图片</span><span>视频</span><span>音频</span><span>文本</span></div>
                <div className="cg-thumb-grid">
                    <ImagePlaceholder tone="violet" />
                    <ImagePlaceholder tone="amber" />
                    <ImagePlaceholder tone="teal" />
                    <ImagePlaceholder tone="amber" />
                    <ImagePlaceholder tone="teal" />
                    <ImagePlaceholder tone="violet" />
                </div>
            </div>
        </div>
    );
}

export function MockTopBar() {
    return (
        <div className="cg-topbar">
            <div className="cg-topbar-cell"><MockTopLeft /><Badge n={1} /></div>
            <div className="cg-topbar-cell"><MockTopCenter /><Badge n={2} /></div>
            <div className="cg-topbar-cell"><MockTopRight /><Badge n={3} /></div>
        </div>
    );
}

export function MockAddMenu() {
    const items = [
        { icon: <Type />, label: "文本" },
        { icon: <ImageIcon />, label: "图片" },
        { icon: <Video />, label: "视频" },
        { icon: <Music2 />, label: "音频" },
        { icon: <Clapperboard />, label: "分镜脚本", tag: "核心" },
        { icon: <UserRound />, label: "角色卡" },
        { icon: <Table2 />, label: "批量创作表" },
        { icon: <WandSparkles />, label: "一键复刻" },
        { icon: <ArrowRightLeft />, label: "转换", tag: "本地" },
    ];
    return (
        <div className="cg-addmenu-wrap">
            <div className="cg-menu">
                <div className="cg-menu-title">添加节点</div>
                {items.map((item) => (
                    <div key={item.label} className={`cg-menu-item${item.label === "图片" ? " is-hover" : ""}`}>
                        {item.icon}
                        <span>{item.label}</span>
                        {item.tag ? <em>{item.tag}</em> : null}
                    </div>
                ))}
            </div>
            <div className="cg-addmenu-dock">
                <Dock items={[{ icon: <MousePointer2 />, label: "框选" }, { icon: <Plus />, label: "添加节点", on: true }, { icon: <BriefcaseBusiness />, label: "工具箱" }, { icon: <FolderOpen />, label: "素材库" }]} />
            </div>
        </div>
    );
}

export function MockConnection() {
    return (
        <div className="cg-connect">
            <NodeCard kind="图片" icon={<ImageIcon />} title="参考图" ports="out">
                <ImagePlaceholder tone="amber" />
            </NodeCard>
            <svg className="cg-connect-wire" viewBox="0 0 160 120" preserveAspectRatio="none">
                <path d="M0 60 C 70 60, 90 60, 160 60" />
                <circle r="3.5"><animateMotion dur="2.4s" repeatCount="indefinite" path="M0 60 C 70 60, 90 60, 160 60" /></circle>
            </svg>
            <NodeCard kind="视频" icon={<Video />} title="商品展示" ports="in">
                <div className="cg-media is-video"><span className="cg-play" /></div>
            </NodeCard>
            <span className="cg-connect-hint is-a">拖动右侧圆点</span>
            <span className="cg-connect-hint is-b">放到另一个节点上</span>
        </div>
    );
}

export function MockNextStepMenu() {
    const items = [
        ["文本生成", "引用当前内容，生成或改写文本"],
        ["图片生成", "结合提示词和参考图，生成新的画面"],
        ["视频生成", "结合提示词与参考素材，生成动态视频"],
        ["分镜脚本", "根据剧情拆解镜头，编排分镜脚本"],
    ];
    return (
        <div className="cg-nextstep">
            <NodeCard kind="文本" icon={<Type />} title="故事梗概" className="is-small" ports="out">
                <p className="cg-lines"><i /><i /><i className="is-short" /></p>
            </NodeCard>
            <div className="cg-menu is-wide">
                <div className="cg-menu-title">创建下一步</div>
                {items.map(([label, desc], index) => (
                    <div key={label} className={`cg-menu-item is-two${index === 1 ? " is-hover" : ""}`}>
                        <span>{label}</span>
                        <small>{desc}</small>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function MockMention() {
    return (
        <div className="cg-mention">
            <div className="cg-mention-input">把 <span className="cg-mention-tag">@主图</span> 里的小象放进卧室场景，暖色光<span className="cg-caret" /></div>
            <div className="cg-menu is-floating">
                <div className="cg-menu-search"><Search />搜索节点、素材或技能</div>
                <div className="cg-menu-group">画布节点</div>
                <div className="cg-menu-item is-hover"><ImageIcon /><span>主图</span></div>
                <div className="cg-menu-item"><Type /><span>产品卖点</span></div>
                <div className="cg-menu-group">素材库</div>
                <div className="cg-menu-item"><Images /><span>品牌 Logo</span></div>
            </div>
        </div>
    );
}

export function MockPromptPanel() {
    return (
        <div className="cg-prompt">
            <div className="cg-prompt-head"><ImageIcon /><strong>图片生成</strong><span className="cg-prompt-tools"><WandSparkles />润色</span></div>
            <div className="cg-prompt-input">一只灰色毛绒小象坐在奶油色沙发上，柔和自然光，产品摄影，干净背景</div>
            <div className="cg-prompt-meta">
                <span className="cg-model"><Sparkles />选择模型<ChevronDown /></span>
                <span className="cg-muted">已连接 1 个素材</span>
                <span className="cg-muted">参数 <ChevronDown /></span>
            </div>
            <div className="cg-prompt-foot">
                <span className="cg-btn-primary">消耗 8 积分，生成</span>
            </div>
            <Badge n={1} className="is-p1" />
            <Badge n={2} className="is-p2" />
            <Badge n={3} className="is-p3" />
            <Badge n={4} className="is-p4" />
        </div>
    );
}

export function MockScriptNode() {
    const rows = [
        ["1", "1.2", "第一帧：玩偶双手遮脸，0.3 秒内张开，露出眼睛"],
        ["2", "1.8", "小手从右下入画，轻拍玩偶肚子，接触后停住"],
        ["3", "1.4", "手贴胸口按压一次，玩偶头部与嘴部出现动作"],
        ["4", "3.8", "轻推小象转向镜头，暖光扫过毛绒，画面定格"],
    ];
    return (
        <div className="cg-script">
            <div className="cg-script-head"><Clapperboard /><strong>分镜脚本</strong><em>15 秒电商广告 · 4 镜</em></div>
            <div className="cg-script-flow">
                <span className="is-on">分镜</span><i /><span>分镜图（可选）</span><i /><span>视频</span><i /><span>合并成片</span>
            </div>
            <div className="cg-script-table">
                <div className="cg-script-row is-head"><span>序号</span><span>时长</span><span>视频提示词</span></div>
                {rows.map(([n, d, p]) => (
                    <div key={n} className="cg-script-row"><span>{n}</span><span>{d} 秒</span><span>{p}</span></div>
                ))}
                <div className="cg-script-add"><Plus />添加行</div>
            </div>
            <div className="cg-script-input">
                <span>输入剧本或剧情，以及总时长等要求，自动拆分为镜头</span>
                <Send />
            </div>
        </div>
    );
}

export function MockToolbox() {
    const tools = ["图片移除背景", "图片分辨率提高", "PSD 分层", "视频替换背景", "视频分辨率提升", "图像扩张"];
    return (
        <div className="cg-toolbox">
            <div className="cg-side-head">工具箱<span className="cg-seg"><b className="is-on">预设</b><b>个人</b></span></div>
            <div className="cg-toolbox-grid">
                {tools.map((tool, index) => (
                    <div key={tool} className={`cg-tool${index === 0 ? " is-hover" : ""}`}>
                        <span className={`cg-tool-art is-${["violet", "amber", "teal"][index % 3]}`} />
                        <span>{tool}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function MockAssetView() {
    return (
        <div className="cg-assets">
            <div className="cg-assets-tree">
                <div className="cg-side-search"><Search />搜索资产</div>
                <span className="is-on"><FolderTree />全部资产</span>
                <span><ImageIcon />图片</span>
                <span><Video />视频</span>
                <span><Music2 />音频</span>
            </div>
            <div className="cg-assets-grid">
                <ImagePlaceholder tone="violet" />
                <ImagePlaceholder tone="amber" />
                <div className="cg-media is-video"><span className="cg-play" /></div>
                <ImagePlaceholder tone="teal" />
                <ImagePlaceholder tone="amber" />
                <ImagePlaceholder tone="violet" />
            </div>
        </div>
    );
}

export function MockAgent() {
    return (
        <div className="cg-agent">
            <div className="cg-agent-panel">
                <div className="cg-side-head">Agent 工作台<span>×</span></div>
                <div className="cg-chat is-user">帮我把画布里的商品图做成 9 镜的 15 秒广告分镜</div>
                <div className="cg-chat">好的，我先读取 <b>@主图</b> 和 <b>@产品卖点</b>，再生成分镜脚本节点，开始前会请你确认。</div>
                <div className="cg-agent-input">输入操作指导；用 @ 引用画布节点，用 / 引用 Skills</div>
            </div>
            <span className="cg-agent-orb is-big"><Sparkles /></span>
        </div>
    );
}

export function MockShare() {
    return (
        <div className="cg-share">
            <div className="cg-side-head">分享画布<span>×</span></div>
            <div className="cg-chip-row"><span className="is-on">长期有效</span><span>7 天有效</span><span>30 天有效</span></div>
            <div className="cg-share-link">https://service-28ac86dd.example.invalid/share/canvas/••••••</div>
            <span className="cg-btn-primary">创建并复制链接</span>
        </div>
    );
}
