/**
 * workflow-gate extension for pi（v0.2）
 * - input 事件：粗筛任务候选项，追加【确认式】提醒（不再直接裁决任务类型）；
 *   进行中任务只提示进度；用户显式豁免语（如"先讨论"）不触发。
 * - /workflow 命令：list / status / enable <rule> / disable <rule> / pause / resume
 * 依赖：~/.pi/agent/workflow/workflow.json（规则表）+ workflow_gate_mcp.py（MCP server）
 * 核心逻辑见 workflow-gate-core.ts（纯函数，可独立测试）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectTaskCandidates,
  isExempted,
  buildReminder,
  buildProgressHint,
  TYPE_LABELS,
} from "./workflow-gate-core.ts";

const WORKFLOW_DIR = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), "workflow");
const RULES_PATH = path.join(WORKFLOW_DIR, "workflow.json");

const ENABLED_HINT = "（此流程未启用，仅作提示）";

// 会话级开关：暂停后不再触发任何提醒（不落盘）
let reminderPaused = false;

function loadRules(): any {
  try {
    return JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
  } catch {
    return { rules: {} };
  }
}

function saveRules(rules: any): boolean {
  try {
    fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function loadState(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, "state.json"), "utf-8"));
  } catch {
    return null;
  }
}

/** 有激活任务未完成 → 附进度提示；已全部完成 → 提示可结束 */
function stateHint(state: any): string | null {
  if (!state?.task_type) return null;
  const done = Array.isArray(state.done) ? state.done : [];
  const stages = Array.isArray(state.stages) ? state.stages : [];
  if (stages.length > 0 && done.length < stages.length) {
    return buildProgressHint(state.task_type, done.length, stages.length);
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  // 用户输入时附加工作流提醒（transform 不改内容，仅追加提示行）
  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return { action: "continue" };
    const text = event.text.trim();
    if (!text || text.startsWith("/") || text.startsWith("!")) return { action: "continue" };

    // 1) 会话暂停 → 静默
    if (reminderPaused) return { action: "continue" };

    // 2) 用户显式豁免（"先讨论/跳过流程/不走流程"等）→ 静默
    if (isExempted(text)) return { action: "continue" };

    // 3) 进行中任务 → 只提示进度，不重新分类（消除重复触发）
    const state = loadState();
    const hint = stateHint(state);
    if (hint) {
      return { action: "transform", text: text + hint };
    }

    // 4) 粗筛候选 → 确认式提醒（将分类裁决交给对话主体）
    const candidates = detectTaskCandidates(text);
    if (candidates.length === 0) return { action: "continue" };

    const primary = candidates[0];
    const rule = loadRules().rules?.[primary];
    const skills = rule?.skills?.join("、") || "";
    const hintText = rule?.enabled === false ? ENABLED_HINT : "";
    const reminder = buildReminder(candidates) + (skills ? `\n> 首选流程技能：${skills}。` : "") + hintText;
    return { action: "transform", text: text + reminder };
  });

  // /workflow 命令：管理规则开关 + 会话级暂停
  pi.registerCommand("workflow", {
    description: "管理工作流规则：list / status / enable <rule> / disable <rule> / pause / resume",
    handler: async (args, ctx) => {
      const [cmd, ruleName] = (args || "").trim().split(/\s+/);
      const rules = loadRules();
      const all = rules.rules || {};

      if (cmd === "list") {
        const lines = Object.entries(all).map(([k, v]: [string, any]) => {
          const on = v.enabled !== false;
          return `${on ? "✅" : "⏸"} ${k}（${TYPE_LABELS[k] ?? k}）: ${v.skills?.join(", ") || "无技能"}${on ? "" : "（未启用）"}`;
        });
        ctx.ui.notify(`工作流规则:\n${lines.join("\n")}`, "info");
        return;
      }

      if (cmd === "status") {
        const state = loadState();
        const active = state?.task_type;
        ctx.ui.notify(
          active
            ? `当前激活任务: ${active}（${TYPE_LABELS[active] ?? ""}）\n完成阶段: ${(state.done || []).join(", ") || "无"}`
            : "当前没有激活的任务",
          "info"
        );
        return;
      }

      if (cmd === "pause") {
        reminderPaused = true;
        ctx.ui.notify("⏸ 工作流提醒已暂停（本次会话）。/workflow resume 恢复。", "info");
        return;
      }

      if (cmd === "resume") {
        reminderPaused = false;
        ctx.ui.notify("▶ 工作流提醒已恢复。", "info");
        return;
      }

      if ((cmd === "enable" || cmd === "disable") && ruleName) {
        const rule = all[ruleName];
        if (!rule) {
          ctx.ui.notify(`未知规则「${ruleName}」。可用: ${Object.keys(all).join(", ")}`, "error");
          return;
        }
        if (cmd === "enable") delete rule.enabled;
        else rule.enabled = false;
        if (saveRules(rules)) {
          ctx.ui.notify(`✔ 已${cmd === "enable" ? "启用" : "禁用"}规则「${ruleName}」`, "success");
        } else {
          ctx.ui.notify("写入 workflow.json 失败，请检查文件权限", "error");
        }
        return;
      }

      ctx.ui.notify("用法: /workflow list | status | enable <rule> | disable <rule> | pause | resume", "info");
    },
  });
}
