/**
 * workflow-gate-core.ts — 纯函数核心（无 pi 依赖，可独立测试）
 * 分类候选 / 豁免语 / 提醒文案 / 进度提示 均在此，主扩展文件只做组装。
 */

export type TaskType = string;

/** 交付物信号优先级：文档 > bug > 实现 > 计划 > 设计 > 讨论 > 调研 > 评审 > 合并 > 反馈 > 隔离 */
export const TYPE_PRIORITY: string[] = [
  "doc_writing",
  "bug",
  "implement",
  "multi_step",
  "feature_design",
  "decision",
  "research",
  "review",
  "merge",
  "review_received",
  "isolation",
];

export const TYPE_LABELS: Record<string, string> = {
  bug: "调试修复",
  implement: "功能实现",
  multi_step: "多步骤任务",
  feature_design: "方案设计",
  doc_writing: "文档撰写",
  decision: "讨论决策",
  research: "调研",
  review: "评审回顾",
  merge: "合并交付",
  review_received: "评审反馈",
  isolation: "隔离开发",
};

/** 关键词 → 任务类型（v1.2.1：口语化/行业词/英文变体全量扩展；双字词优先防误报） */
export const KEYWORDS: Record<string, string[]> = {
  bug: ["bug", "报错", "出错", "错误", "异常", "故障", "崩溃", "挂掉", "挂了", "失败", "不工作", "没法用", "用不了", "打不开", "闪退", "卡死", "无响应", "连不上", "宕机", "修复", "修好", "debug", "排查", "定位问题", "测试不通过", "测试挂了", "error", "exception", "not working", "broken", "crash", "timeout"],
  implement: ["实现", "开发", "写一个", "写个", "新增", "添加", "加个功能", "创建", "构建", "搞一个", "整一个", "写代码", "编码", "implement", "feature", "做个", "build", "add", "create", "coding"],
  multi_step: ["重构", "迁移", "搭建", "改造", "重构一下", "新项目", "架构", "计划", "规划", "设计一个", "升级", "重写", "整理", "拆分", "优化一下", "分阶段", "任务拆解", "大工程", "migrate", "refactor", "upgrade"],
  feature_design: ["想做一个", "创意", "点子", "新玩法", "头脑风暴", "设计方案", "需求分析", "原型", "创新", "产品设计", "交互设计", "用户体验", "脑洞", "MVP", "brainstorm", "prototype", "new idea"],
  doc_writing: ["文档", "方案书", "报告", "说明书", "README", "readme", "写文档", "设计文档", "教程", "指南", "文章", "笔记", "总结一下", "介绍", "白皮书", "会议纪要", "专栏", "博客", "doc", "document", "guide", "summary", "writeup"],
  decision: ["讨论", "决策", "定方案", "确认方案", "商量", "聊聊", "要不要", "选哪个", "权衡", "拍板", "怎么选", "方案对比", "利弊", "二选一", "decide", "which one", "go or no go"],
  research: ["调研", "检索", "搜索资料", "查资料", "找数据", "评估数据集", "查询论文", "资料收集", "文献", "研究一下", "查一下", "竞品分析", "背景调查", "市场调研", "盘点", "综述", "investigate", "literature"],
  review: ["回顾", "评审", "全面检查", "找问题", "审查", "review", "代码审查", "看看问题", "自检", "复检", "审计", "质量检查", "安全审查", "挑刺", "体检", "audit", "inspect", "security review"],
  merge: ["合并", "发布", "更新", "pull request", "pull-request", "上线", "交付", "合入", "部署", "发版", "打 tag", "打tag", "release notes", "上架", "release", "merge", "deploy", "ship"],
  review_received: ["评审意见", "收到反馈", "审阅意见", "评审反馈", "review 意见", "按意见改", "处理反馈", "回复评审", "复审", "处理 review"],
  isolation: ["工作区", "隔离", "并行开发", "沙箱", "分叉", "fork", "支线", "旁路", "临时分支", "单独环境", "worktree", "sandbox", "试验一下"],
};

/** 直接型：交付物明确，提醒直接建议执行（不要求用户确认任务实质） */
export const DIRECT_TYPES: string[] = ["bug", "implement", "review", "research", "doc_writing"];

export function isDirectType(t: string): boolean {
  return DIRECT_TYPES.includes(t);
}

/** 豁免语：命中则本轮不触发流程提醒（用户显式声明不走流程） */
export const EXEMPT_PHRASES: string[] = [
  "跳过流程", "不用流程", "先讨论", "别走流程", "豁免", "不走流程",
  "不需要流程", "先沟通", "不启用", "不适用", "暂不", "先聊聊", "仅咨询",
  "只咨询", "随便问问", "先了解一下", "不急着动手",
  "skip workflow", "no workflow", "skip it", "just asking",
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

/** 组装提醒：直接型=建议执行；确认型=先确认任务实质（候选空返回 null） */
export function buildReminder(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const primary = candidates[0];
  const names = candidates.map((c) => `${c}（${TYPE_LABELS[c] ?? c}）`).join("、");
  if (isDirectType(primary)) {
    return (
      `\n\n> ⚙️ **workflow-gate**：检测到「${primary}」相关任务（候选：${names}）。\n` +
      `> 建议直接调用 wf_begin(task_type="${primary}") 获取阶段清单；若任务实质不同，可换 task_type 或声明豁免（task_type="none"）。`
    );
  }
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

/** 客观性约束（v1.2）：每次对话注入 system prompt 的固定指导 */
export function buildObjectiveGuideline(): string {
  return (
    "[workflow-gate 客观性原则] 保持客观中立，基于事实与证据回应；" +
    "不要迎合用户；发现用户前提或假设有误时明确指出并给出依据。"
  );
}

