/**
 * workflow-gate-core.ts — 纯函数核心（无 pi 依赖，可独立测试）
 * 分类候选 / 豁免语 / 提醒文案 / 进度提示 均在此，主扩展文件只做组装。
 */

export type TaskType = string;

/** 交付物信号优先级：文档 > bug > 实现 > 计划 > 设计 > 讨论 > 调研 > 评审 */
export const TYPE_PRIORITY: string[] = [
  "doc_writing",
  "bug",
  "implement",
  "multi_step",
  "feature_design",
  "decision",
  "research",
  "review",
];

export const TYPE_LABELS: Record<string, string> = {
  bug: "调试修复",
  implement: "功能实现",
  multi_step: "多步骤任务",
  claim_complete: "完成前验证",
  feature_design: "方案设计",
  doc_writing: "文档撰写",
  decision: "讨论决策",
  research: "调研",
  review: "评审回顾",
  merge: "合并交付",
  review_received: "评审反馈",
  isolation: "隔离开发",
};

/** 关键词 → 任务类型（保守匹配；不再"首命中即返回"，改为收集候选） */
export const KEYWORDS: Record<string, string[]> = {
  bug: ["bug", "报错", "错误", "异常", "崩溃", "挂掉", "挂了", "失败", "修复", "修好", "debug", "排查", "定位问题", "测试不通过", "测试挂了"],
  implement: ["实现", "开发", "写一个", "写个", "新增", "添加", "加个功能", "implement", "feature", "做个"],
  multi_step: ["重构", "迁移", "搭建", "改造", "重构一下", "新项目", "架构", "计划", "规划", "设计一个"],
  feature_design: ["想做一个", "创意", "点子", "brainstorm", "头脑风暴", "设计方案", "需求分析"],
  doc_writing: ["文档", "方案书", "报告", "说明书", "README", "readme", "写文档", "设计文档", "doc", "document"],
  decision: ["讨论", "决策", "定方案", "确认方案", "商量", "聊聊"],
  research: ["调研", "检索", "搜索资料", "查资料", "找数据", "评估数据集", "查询论文"],
  review: ["回顾", "评审", "全面检查", "找问题", "审查", "review"],
};

/** 豁免语：命中则本轮不触发流程提醒（用户显式声明不走流程） */
export const EXEMPT_PHRASES: string[] = [
  "跳过流程", "不用流程", "先讨论", "别走流程", "豁免", "不走流程",
  "不需要流程", "先沟通", "不启用", "不适用", "暂不",
  "skip workflow", "no workflow", "skip it",
];

export function isExempted(text: string): boolean {
  const lower = text.toLowerCase();
  return EXEMPT_PHRASES.some((p) => lower.includes(p.toLowerCase()));
}

/** 粗筛：收集所有命中类型（去重、按优先级排序、最多 max 个）——不再直接裁决 */
export function detectTaskCandidates(text: string, max = 3): string[] {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const [type, words] of Object.entries(KEYWORDS)) {
    for (const w of words) {
      if (lower.includes(w.toLowerCase())) {
        hits.add(type);
        break;
      }
    }
  }
  return TYPE_PRIORITY.filter((t) => hits.has(t)).slice(0, max);
}

/** 组装分类确认提醒（候选空返回 null） */
export function buildReminder(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const primary = candidates[0];
  const names = candidates.map((c) => `${c}（${TYPE_LABELS[c] ?? c}）`).join("、");
  return (
    `\n\n> ⚙️ **workflow-gate**：检测到可能是「${primary}」相关任务（候选：${names}）。\n` +
    `> 请先与用户确认任务实质（交付物是代码/文档/决策？），再调用 wf_begin(task_type=...) ` +
    `获取阶段清单；若确实不需要流程，调用 wf_begin(task_type="none") 声明豁免。`
  );
}

/** 进行中任务简短进度提示（避免重复分类） */
export function buildProgressHint(taskType: string, done: number, total: number): string {
  const label = TYPE_LABELS[taskType] ?? taskType;
  return (
    `\n\n> ⚙️ **workflow-gate**：任务「${taskType}（${label}）」进行中 ` +
    `（${done}/${total}），请在阶段完成时用 wf_check 标记进度。`
  );
}
