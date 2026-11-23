/**
 * 电商创作：准备素材 → 选视觉方向 → 逐张分析并出图 → 交付。
 * 页面状态很多，这里只把它们折算成「现在在哪一步、这一步在做什么」，供进度条和下一步提示共用。
 */
export type CommerceFlowStepKey = "material" | "direction" | "plan" | "generate" | "deliver";
export type CommerceFlowStepStatus = "done" | "current" | "todo";
export type CommerceFlowStep = { key: CommerceFlowStepKey; label: string; status: CommerceFlowStepStatus; detail: string; running: boolean };

export type CommerceFlowInput = {
    /** 直接生成的旧项目：没有方向和方案两步。 */
    direct: boolean;
    hasProduct: boolean;
    readyToCreate: boolean;
    directionsLoading: boolean;
    /** 四套方向已经出来，等用户选。 */
    directionsReady: boolean;
    directionChosen: boolean;
    planningPending: boolean;
    /** 本轮方案已经写好（还没提交出图也算）。 */
    planReady: boolean;
    planCount: number;
    submitted: number;
    completed: number;
    failed: number;
    active: number;
};

const labels: Record<CommerceFlowStepKey, string> = {
    material: "准备素材",
    direction: "选视觉方向",
    plan: "分析并出图",
    generate: "生成图片",
    deliver: "导出交付",
};

function currentStep(input: CommerceFlowInput): CommerceFlowStepKey {
    // 正在进行的分析优先：上一轮已交付后继续下一组时，进度回到选方向 / 策划。
    if (!input.direct && input.planningPending) return "plan";
    if (!input.direct && (input.directionsLoading || input.directionsReady)) return "direction";
    if (input.submitted > 0) return input.planCount > 0 && input.completed >= input.planCount ? "deliver" : "generate";
    if (input.direct) return input.readyToCreate ? "generate" : "material";
    if (input.planReady || input.directionChosen) return "plan";
    return input.readyToCreate ? "direction" : "material";
}

function stepDetail(key: CommerceFlowStepKey, input: CommerceFlowInput): string {
    switch (key) {
        case "material":
            return !input.hasProduct ? "上传商品主图，Agent 会根据图片策划" : "选择创作类型、投放平台和模型规格，并填写商品名称";
        case "direction":
            return input.directionsLoading ? "正在识别商品并推荐 4 套视觉方向，切换页面不会中断" : input.directionsReady ? "选一套视觉方向，选定后自动策划并出图" : "点「开始创作」，先推荐 4 套视觉方向；也可以「跳过选方向」直接策划";
        case "plan":
            if (input.planningPending) return "逐张分析并自动出图，生成期间继续分析下一张";
            return input.planReady ? `方案共 ${input.planCount} 张，正在自动提交出图` : "按选定方向逐张分析并出图";
        case "generate":
            if (!input.submitted) return input.direct ? "点「开始创作」直接按设置出图" : "每张分析完成后自动出图";
            return `已完成 ${input.completed} / ${input.planCount} 张${input.failed ? `，${input.failed} 张失败可重试` : ""}`;
        case "deliver":
            return "全部完成，已保存到资产库，可导出、做成视频或继续下一组";
    }
}

export function resolveCommerceFlow(input: CommerceFlowInput): CommerceFlowStep[] {
    const keys: CommerceFlowStepKey[] = input.direct ? ["material", "generate", "deliver"] : ["material", "direction", "plan", "generate", "deliver"];
    const current = keys.indexOf(currentStep(input));
    return keys.map((key, index) => {
        // 交付是终点：到了这一步就算完成，同时保持高亮提示下一步可做的事。
        const status: CommerceFlowStepStatus = index < current ? "done" : index === current ? "current" : "todo";
        const running = status === "current" && ((key === "direction" && input.directionsLoading) || (key === "plan" && input.planningPending) || (key === "generate" && input.active > 0));
        return { key, label: labels[key], status, detail: status === "todo" ? "" : stepDetail(key, input), running };
    });
}

/** 当前这一步的说明，作品区空态和进度条共用同一句话。 */
export function commerceFlowNextStep(steps: CommerceFlowStep[]) {
    return steps.find((step) => step.status === "current")?.detail || "";
}
