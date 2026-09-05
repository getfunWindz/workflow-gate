/**
 * workflow-gate extension for pi（v1.0 扩展版 · 沙箱开发）
 *
 * 官方合规结构（pi.dev/docs/latest/extensions）：
 *   ~/.pi/agent/extensions/workflow-gate/index.ts  ← 本文件（入口，export default）
 *   ~/.pi/agent/extensions/workflow-gate/core.ts   ← 纯逻辑辅助模块（不被当作扩展加载）
 *
 * 安全设计（WORKSPACE.md 红线逐条落实）：
 *   - 工厂为同步函数（不 async，不阻塞 pi 启动；无任何网络/后台资源）
 *   - input 事件处理器整体 try/catch：任何异常静默放行，绝不干扰用户输入管线
 *   - /workflow 命令处理器同样隔离异常
 *   - 只读文件访问（workflow.json / state.json）；写操作仅限用户显式调用
 *     /workflow enable|disable 时（规则开关持久化）
 *   - 纯逻辑全部在 core.ts（node --test 可测）
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
  buildObjectiveGuideline,
  TYPE_LABELS,
} from "./core.ts";

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
  // 每轮对话注入客观性约束（system prompt 链式追加；异常隔离）：
  // before_agent_start 在用户提交 prompt 后、agent 循环前触发，返回 systemPrompt 即续写
  pi.on("before_agent_start", async (event, _ctx) => {
    try {
      return {
        systemPrompt: event.systemPrompt + buildObjectiveGuideline(),
      };
    } catch {
      return;
    }
  });

  // 用户输入时附加工作流提醒。整体 try/catch：扩展侧任何异常都不得影响输入管线。
  pi.on("input", async (event, ctx) => {
    try {
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

      // 4) 粗筛候选 → 确认式提醒（分类裁决交给对话主体）
      const candidates = detectTaskCandidates(text);
      if (candidates.length === 0) return { action: "continue" };

      const primary = candidates[0];
      const rule = loadRules().rules?.[primary];
      const skills = rule?.skills?.join("、") || "";
      const hintText = rule?.enabled === false ? ENABLED_HINT : "";
      const reminder = buildReminder(candidates) + (skills ? `\n> 首选流程技能：${skills}。` : "") + hintText;
      return { action: "transform", text: text + reminder };
    } catch {
      // 安全网：扩展异常绝不外泄到 pi 输入处理
      return { action: "continue" };
    }
  });

  // /workflow 命令：管理规则开关 + 会话级暂停（同样异常隔离）
  pi.registerCommand("workflow", {
    description: "管理工作流规则：list / status / enable <rule> / disable <rule> / pause / resume",
    handler: async (args, ctx) => {
      try {
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
      } catch {
        ctx.ui.notify("workflow-gate: 命令处理异常，已隔离", "error");
      }
    },
  });
}
