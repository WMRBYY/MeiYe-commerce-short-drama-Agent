import { expect, test } from "bun:test";
import { agentPermissionLabel, agentPermissionMenuItems, normalizeAgentCreditBudgetInput } from "@/components/canvas/canvas-cloud-agent-settings";
import { applyAgentEvent } from "@/components/canvas/canvas-cloud-agent-events";
import { AgentSceneCapsules } from "@/components/canvas/canvas-cloud-agent-composer";
import { canvasThemes } from "@/lib/canvas-theme";
import { renderToStaticMarkup } from "react-dom/server";
import type { Skill } from "@/services/api/skills";
import type { AgentRun } from "@/services/api/agent";

test("omni is a fourth independent choice and preserves old labels", () => {
    expect(agentPermissionLabel("read_only")).toBe("只读");
    expect(agentPermissionLabel("request_approval")).toBe("请求审批");
    expect(agentPermissionLabel("auto")).toBe("自动执行");
    expect(agentPermissionLabel("omni_auto")).toBe("✨ 全能自动");
    const selected: string[] = [];
    const items = agentPermissionMenuItems("read_only", (mode) => selected.push(mode));
    expect(items).toHaveLength(4);
    expect(items?.map((item) => item?.key)).toEqual(["read_only", "request_approval", "auto", "omni_auto"]);
    expect(selected).toEqual([]);
});

test("omni credit limit accepts a fractional hard cap", () => {
    expect(normalizeAgentCreditBudgetInput("0.2")).toBe("0.2");
    expect(normalizeAgentCreditBudgetInput("0.2000009")).toBe("0.200000");
    expect(normalizeAgentCreditBudgetInput("2..5")).toBe("2.5");
});

test("omni run snapshots refresh the displayed remaining budget", () => {
    let run = { id: "run-1", budgetMaxCredits: 0.2, budgetRemainingCredits: 0.2 } as AgentRun;
    applyAgentEvent({ eventId: "status-1", runId: "run-1", seq: 1, type: "run_status", createdAt: "2026-10-23T00:00:00Z", payload: { status: "completed", spentCredits: 0.055891, budgetRemainingCredits: 0.144109, budgetMaxCredits: 0.2 } }, () => {}, (update) => { run = typeof update === "function" ? update(run)! : update!; }, () => {});
    expect(run.spentCredits).toBe(0.055891);
    expect(run.budgetRemainingCredits).toBe(0.144109);
});

test("omni scene chooser requires manual installation and leaves old mode copy intact", () => {
    const props = { buckets: [{ key: "frequent", label: "常用", presets: [], skills: [{ skillId: "mine", skillName: "我的技能" } as Skill] }], installedIds: new Set<string>(), theme: canvasThemes.dark, onPick: () => {}, onPickSkill: () => {} };
    expect(renderToStaticMarkup(<AgentSceneCapsules {...props} manualInstall />)).toContain("缺失技能请自行安装");
    expect(renderToStaticMarkup(<AgentSceneCapsules {...props} />)).toContain("缺失技能将加入技能库");
});
