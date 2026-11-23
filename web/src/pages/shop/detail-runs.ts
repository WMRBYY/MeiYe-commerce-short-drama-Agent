import { create } from "zustand";

import type { EcommerceProject } from "@/services/api/ecommerce";

/** 详情图在本页后台跑的一轮电商 Agent：从点「生成」到这一轮所有出图任务都已提交。 */
export type DetailRun = {
    id: string;
    /** 发起这一轮的账号。 */
    scope: string;
    /** 交给后台电商 Agent 的地址（/ecommerce?new=…）。 */
    url: string;
    title: string;
    count: number;
    startedAt: number;
    /** 第一次保存后才知道的项目 ID；之前右栏用这条记录画思考动画和等待位。 */
    projectId?: string;
};

type DetailRunsState = {
    runs: DetailRun[];
    /** 后台电商 Agent 最近一次保存的项目，详情图右栏用它立即显示方案和逐屏任务。 */
    saved: Record<string, EcommerceProject>;
    start: (run: DetailRun) => void;
    save: (runId: string, project: EcommerceProject) => void;
    finish: (runId: string) => void;
    /** 项目被删除后不再从缓存里补回右栏。 */
    forget: (projectIds: string[]) => void;
    reset: (scope: string) => void;
};

export const useDetailRuns = create<DetailRunsState>((set) => ({
    runs: [],
    saved: {},
    start: (run) => set((state) => ({ runs: [...state.runs.filter((item) => item.id !== run.id), run] })),
    save: (runId, project) =>
        set((state) => ({
            runs: state.runs.map((item) => (item.id === runId && item.projectId !== project.id ? { ...item, projectId: project.id } : item)),
            saved: { ...state.saved, [project.id]: project },
        })),
    finish: (runId) => set((state) => ({ runs: state.runs.filter((item) => item.id !== runId) })),
    forget: (projectIds) => set((state) => ({ saved: Object.fromEntries(Object.entries(state.saved).filter(([id]) => !projectIds.includes(id))) })),
    reset: (scope) => set((state) => ({ runs: state.runs.filter((run) => run.scope === scope), saved: Object.fromEntries(Object.entries(state.saved).filter(([, project]) => project.userId === scope)) })),
}));
