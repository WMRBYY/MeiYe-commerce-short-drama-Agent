import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Bot, Image, Film, Layers3, ScanFace, ShoppingBag, WandSparkles, X, Workflow, FileText } from "lucide-react";
import { Tooltip } from "antd";
import { useNavigate } from "react-router";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { setShopFunction } from "./shop-context";
import { updateChatDraft } from "./shop-edits";
import { SHOP_CANVAS_IMAGE_PROMPTS } from "./shop-canvas-catalog";
import { SHOP_IMAGE_FUNCTIONS } from "./shop-functions";
import { ToolIcon } from "@/components/mode/mode-icons";
import { ShopCanvasAssistant } from "./shop-canvas-assistant";
import { useShopAgentStore } from "./shop-agent-store";
import "./shop-agent.css";

const WORKFLOWS = [
    { name: "商品主图", prompt: "帮我策划商品主图：请先询问商品、平台、受众和核心卖点。", to: "/shop/image", icon: Image },
    { name: "详情页", prompt: "帮我策划详情页：先确认商品事实，再整理卖点顺序和分屏方案。", to: "/shop/detail", icon: Layers3 },
    { name: "模特换装", prompt: "帮我策划模特换装：先确认商品款式、模特素材和目标风格。", to: "/shop/image", icon: ScanFace },
    { name: "画布工作流", prompt: "帮我规划电商画布工作流：从素材、文本到图片和视频，列出节点和素材连接关系。", to: "/shop/canvas", icon: Workflow },
];

export function ShopAgentHost({ active, canvas = false }: { active: boolean; canvas?: boolean }) {
    const userId = useUserStore((s) => s.user?.id);
    const config = useEffectiveConfig();
    const { open, setOpen, prepare } = useShopAgentStore();
    const navigate = useNavigate();
    const reduced = useReducedMotion();
    const openTool = (item: (typeof SHOP_IMAGE_FUNCTIONS)[number]) => {
        if (item.fn) setShopFunction(item.fn);
        else if (item.key !== "inpaint") {
            setShopFunction("chat");
            updateChatDraft((d) => ({ ...d, text: SHOP_CANVAS_IMAGE_PROMPTS[item.key] || "优化参考商品图中的人物面部细节，保持人物身份与商品事实一致。" }));
        }
        navigate("/shop/image");
    };
    if (!userId) return null;
    return (
        <div className="shop-agent-host ms-scope" hidden={!active} data-canvas-no-zoom>
            {!canvas && !open ? (
                <Tooltip title="电商 Agent · 商品策划、图片、视频与详情页" placement="left">
                    <motion.button className="shop-agent-launcher" onClick={() => setOpen(true)} aria-label="打开电商 Agent" whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: 0.96 }}>
                        <ShoppingBag size={21} />
                        <span>电商 Agent</span>
                        <WandSparkles size={15} />
                    </motion.button>
                </Tooltip>
            ) : null}
            <AnimatePresence>
                {open ? (
                    <motion.aside
                        className="shop-agent-panel"
                        aria-label="电商 Agent"
                        data-canvas-wheel-scroll
                        initial={reduced ? false : { opacity: 0, x: 24, scale: 0.98 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    >
                        <header>
                            <span className="shop-agent-mark">
                                <ShoppingBag size={22} />
                            </span>
                            <div>
                                <strong>电商 Agent</strong>
                                <small>从商品洞察到视觉成片</small>
                            </div>
                            <Tooltip title="收起电商 Agent">
                                <button onClick={() => setOpen(false)} aria-label="收起电商 Agent">
                                    <X size={18} />
                                </button>
                            </Tooltip>
                        </header>
                        <div className="shop-agent-body" data-canvas-wheel-scroll>
                            <div className="shop-agent-intro">
                                <span>你的商品创意搭档</span>
                                <h2>让卖点成为画面。</h2>
                                <p>告诉我商品、平台和目标。一起梳理策略，再进入对应工具完成创作。</p>
                            </div>
                            <div className="shop-agent-workflows">
                                {WORKFLOWS.map(({ name, prompt, to, icon: Icon }) => (
                                    <div key={name}>
                                        <Tooltip title={`与电商 Agent 一起策划${name}`}>
                                            <button onClick={() => prepare(prompt)}>
                                                <Icon size={18} />
                                                <span>{name}</span>
                                            </button>
                                        </Tooltip>
                                        <Tooltip title={`打开${name}工作区`}>
                                            <button
                                                aria-label={`打开${name}工作区`}
                                                onClick={() => {
                                                    if (name === "模特换装") setShopFunction("outfit");
                                                    navigate(to);
                                                }}
                                            >
                                                <ArrowUpRight size={14} />
                                            </button>
                                        </Tooltip>
                                    </div>
                                ))}
                            </div>
                            <ShopCanvasAssistant scope={userId} config={config} />
                            <details className="shop-agent-toolbox">
                                <summary>
                                    <Bot size={16} />
                                    电商工具箱 · 全部功能
                                </summary>
                                <div>
                                    {SHOP_IMAGE_FUNCTIONS.map((item) => (
                                        <Tooltip key={item.key} title={item.key === "inpaint" ? "进入商品图片后选择图片，涂抹重绘区域" : `打开${item.label}工具`}>
                                            <button onClick={() => openTool(item)}>
                                                <ToolIcon name={item.icon} className="size-4" />
                                                {item.label}
                                            </button>
                                        </Tooltip>
                                    ))}
                                    <button onClick={() => navigate("/shop/works")}>
                                        <Image size={16} />
                                        我的作品
                                    </button>
                                </div>
                            </details>
                        </div>
                    </motion.aside>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
