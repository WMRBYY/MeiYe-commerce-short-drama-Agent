import type { EcommerceProject } from "@/services/api/ecommerce";
import { createContext, useContext } from "react";

/**
 * 电商 Agent 页面被电商模式「详情图」嵌在后台运行（不显示、不跳页）时的回调。
 * onSaved：项目每次保存（方案、逐屏任务 ID）都通知详情图页刷新右栏；onDone：这一轮不会再提交任何出图任务时调用。
 */
export type EcommerceEmbed = { onSaved: (project: EcommerceProject) => void; onDone: () => void };

export const EcommerceEmbedContext = createContext<EcommerceEmbed | null>(null);

export const useEcommerceEmbed = () => useContext(EcommerceEmbedContext);
