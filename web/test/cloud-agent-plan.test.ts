import { describe, expect, test } from "bun:test";

import { advanceOmniPlanFromTool, agentPlanVisible, latestAgentPlanItems, pendingAgentQuestion, preserveOmniVerifiedPlan } from "@/lib/canvas/cloud-agent-plan";

const items = (...statuses: Array<"pending" | "doing" | "done">) => statuses.map((status, index) => ({ id: `${index + 1}`, title: `第 ${index + 1} 项`, status }));

/**
 * 回归（2026-09-16）：一个对话会跨多轮运行，每轮各有一条 `plan-${runId}` 清单消息，
 * 都在同一个 messages 数组里。原来取的是**第一条**，于是清单永远钉在第 1 轮的初始状态 ——
 * 后面怎么推进都不刷新、全部做完也不消失（实测反馈：plan 完成了不更新、全完成也不关闭）。
 */
describe("latestAgentPlanItems", () => {
    test("跨轮取最新那份，而不是第一条", () => {
        const messages = [
            { id: "plan-run-1", planItems: items("pending", "pending") },
            { id: "user-1", text: "..." },
            { id: "plan-run-2", planItems: items("done", "doing") },
        ];
        expect(latestAgentPlanItems(messages).map((entry) => entry.status)).toEqual(["done", "doing"]);
    });

    test("最新那份全部完成 → 清单收起", () => {
        const messages = [
            { id: "plan-run-1", planItems: items("pending") },
            { id: "plan-run-2", planItems: items("done", "done") },
        ];
        const plan = latestAgentPlanItems(messages);
        expect(plan.every((entry) => entry.status === "done")).toBe(true);
        expect(agentPlanVisible(plan)).toBe(false);
    });

    test("最新那份还没做完 → 继续显示", () => {
        expect(agentPlanVisible(latestAgentPlanItems([{ id: "plan-run-1", planItems: items("done", "doing") }]))).toBe(true);
    });

    test("没有任何清单（包括带空数组的）→ 空且不显示", () => {
        expect(latestAgentPlanItems([])).toEqual([]);
        expect(latestAgentPlanItems([{ id: "user-1" }, { id: "plan-run-1", planItems: [] }])).toEqual([]);
        expect(agentPlanVisible([])).toBe(false);
    });
});

describe("omni plan verified progress", () => {
    const plan = [
        { id: "read", title: "读取画布状态", status: "done" as const },
        { id: "copy", title: "策划插画文案并落到 Markdown 节点", status: "doing" as const },
        { id: "image", title: "按文案生成插画并等待结果", status: "pending" as const },
        { id: "review", title: "核对结果并交付成品", status: "pending" as const },
    ];

    test("replayed text write and finished image advance the current step", () => {
        const afterText = advanceOmniPlanFromTool(plan, { toolName: "canvas_apply_ops", result: { committed: true }, arguments: JSON.stringify({ ops: [{ type: "add_node", nodeType: "text", content: "小猫看书" }] }) });
        expect(afterText.map((item) => item.status)).toEqual(["done", "done", "doing", "pending"]);
        const submitted = advanceOmniPlanFromTool(afterText, { toolName: "generate_media", result: { phase: "submission", status: "running", nodeId: "image" }, arguments: '{"mode":"image"}' });
        expect(submitted).toEqual(afterText);
        const finished = advanceOmniPlanFromTool(afterText, { toolName: "generate_media", result: { phase: "completion", status: "succeeded", nodeId: "image" }, arguments: '{"mode":"image"}' });
        expect(finished.map((item) => item.status)).toEqual(["done", "done", "done", "doing"]);
        expect(preserveOmniVerifiedPlan(finished, plan)[2].status).toBe("done");
        expect(preserveOmniVerifiedPlan([{ id: "draft", title: "可重做的草稿", status: "done" }], [{ id: "draft", title: "可重做的草稿", status: "doing" }])[0].status).toBe("doing");
    });

    test("one result does not complete several images or review", () => {
        const multi = [{ id: "images", title: "生成8张详情页图片", status: "doing" as const }];
        const payload = { toolName: "generate_media", result: { phase: "completion", status: "succeeded", nodeId: "image-1" }, arguments: '{"mode":"image"}' };
        expect(advanceOmniPlanFromTool(multi, payload)).toEqual(multi);
        expect(advanceOmniPlanFromTool([{ id: "review", title: "核对生成结果", status: "doing" }], payload)[0].status).toBe("doing");
    });
});

describe("pendingAgentQuestion", () => {
    const question = { question: "选哪个模型？", options: [{ label: "H3文生视频" }, { label: "Seedance 2.5" }] };

    test("有未作答的提问 → 亮面板", () => {
        const messages = [{ role: "user" }, { role: "assistant", question }];
        expect(pendingAgentQuestion(messages)?.question).toBe("选哪个模型？");
    });

    test("提问之后用户已回复 → 收起面板", () => {
        const messages = [{ role: "assistant", question }, { role: "user" }];
        expect(pendingAgentQuestion(messages)).toBeUndefined();
    });

    test("多轮提问取最新那道；旧的那道不算数", () => {
        const later = { question: "确认开始吗？", options: [{ label: "开始" }, { label: "再改改" }] };
        const messages = [{ role: "assistant", question }, { role: "user" }, { role: "assistant", question }, { role: "assistant", question: later }];
        expect(pendingAgentQuestion(messages)?.question).toBe("确认开始吗？");
    });

    test("没有提问 → 不亮面板", () => {
        expect(pendingAgentQuestion([])).toBeUndefined();
        expect(pendingAgentQuestion([{ role: "assistant" }, { role: "user" }])).toBeUndefined();
    });
});
