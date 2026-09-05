/**
 * workflow-gate-core 纯函数测试（node --test）
 * 运行：node --test test/extension-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectTaskCandidates,
  isExempted,
  buildReminder,
  buildProgressHint,
  buildObjectiveGuideline,
  TYPE_LABELS,
} from "../extension/workflow-gate/core.ts";

// ── 分类候选 ─────────────────────────────
test("报告类任务优先 doc_writing（修复误分类）", () => {
  const c = detectTaskCandidates("生成正式回归报告");
  assert.equal(c[0], "doc_writing");
  assert.ok(c.includes("doc_writing"));
});

test("实现类任务 → implement", () => {
  const c = detectTaskCandidates("帮我实现登录接口");
  assert.equal(c[0], "implement");
});

test("bug 类任务 → bug（先于实现类）", () => {
  const c = detectTaskCandidates("接口报错，排查一下");
  assert.equal(c[0], "bug");
});

test("重叠信号按交付物优先级排序（文档>bug>实现）", () => {
  const c = detectTaskCandidates("写个报告并修复测试报错");
  assert.equal(c[0], "doc_writing");
  assert.ok(c.indexOf("bug") < c.indexOf("implement") || !c.includes("implement"));
});

test("候选去重且上限 3 个", () => {
  const c = detectTaskCandidates("写个报告重构一下实现和文档");
  assert.ok(c.length <= 3);
  assert.equal(new Set(c).size, c.length);
});

test("无关键词 → 空候选", () => {
  assert.deepEqual(detectTaskCandidates("好的可以"), []);
});

// ── 豁免 ────────────────────────────────
test("豁免语命中：先讨论 / 跳过流程", () => {
  assert.equal(isExempted("你先别急着开发，先讨论一下"), true);
  assert.equal(isExempted("这次跳过流程，直接看代码"), true);
});

test("普通消息不豁免", () => {
  assert.equal(isExempted("帮我修复报错"), false);
  assert.equal(isExempted("写个开发文档"), false);
});

// ── 提醒文案 ─────────────────────────────
test("buildReminder：引导确认而非直接裁决", () => {
  const r = buildReminder(["feature_design", "multi_step"]);
  assert.ok(r);
  assert.ok(r.includes("确认任务实质"));
  assert.ok(r.includes("候选"));
});

test("buildReminder：空候选 → null", () => {
  assert.equal(buildReminder([]), null);
});

// ── 直接型 vs 确认型（v1.1） ──────────────────────
test("直接型（bug）→ 建议式文案，不要求确认", () => {
  const r = buildReminder(["bug"]);
  assert.ok(r);
  assert.ok(!r.includes("请先与用户确认任务实质"), "直接型不应要求确认");
  assert.ok(r.includes("建议直接调用 wf_begin"), "应给出建议调用");
});

test("确认型（feature_design）→ 保留确认引导", () => {
  const r = buildReminder(["feature_design"]);
  assert.ok(r);
  assert.ok(r.includes("请先与用户确认任务实质"));
});

test("review/research 为直接型", () => {
  assert.ok(!buildReminder(["review"]).includes("请先与用户确认"));
  assert.ok(!buildReminder(["research"]).includes("请先与用户确认"));
});

// ── 新词命中（v1.1 词库） ────────────────────────
test("merge 类词可命中", () => {
  assert.ok(detectTaskCandidates("准备合并并发布上线").includes("merge"));
});

test("review_received 类词可命中", () => {
  assert.ok(detectTaskCandidates("我收到了评审意见").includes("review_received"));
});

test("isolation 不含实验词（科研语境不误命中）", () => {
  assert.ok(!detectTaskCandidates("做个物理实验").includes("isolation"));
});

test("merge 词库含更新词", () => {
  assert.ok(detectTaskCandidates("准备更新发布到仓库").includes("merge"));
});

test("review 补充词可命中", () => {
  assert.ok(detectTaskCandidates("代码审查这个项目").includes("review"));
});

test("TYPE_LABELS 与规则同步（claim_complete 已删）", () => {
  assert.equal(TYPE_LABELS["claim_complete"], undefined);
});

// ── 词库扩展（v1.2） ──────────────────────────
test("bug 新词命中：出错/故障/用不了", () => {
  assert.ok(detectTaskCandidates("电脑这边出错了，一直没法用").includes("bug"));
});

test("multi_step 新词命中：升级/重写", () => {
  assert.ok(detectTaskCandidates("帮我把老系统升级并重写一遍").includes("multi_step"));
});

test("implement 新词命中：创建/构建", () => {
  assert.ok(detectTaskCandidates("帮我创建并构建这个功能").includes("implement"));
});

test("research 新词命中：文献/研究", () => {
  assert.ok(detectTaskCandidates("查一下相关文献做研究").includes("research"));
});

test("merge 新词命中：合入/部署", () => {
  assert.ok(detectTaskCandidates("可以把分支合入并部署上线了").includes("merge"));
});

test("isolation 新词命中：fork/试验", () => {
  assert.ok(detectTaskCandidates("开个 fork 做试验").includes("isolation"));
});

// ── 客观性约束注入文本（v1.2） ────────────────────
test("buildObjectiveGuideline 包含客观与不迎合", () => {
  const g = buildObjectiveGuideline();
  assert.ok(g.includes("客观"));
  assert.ok(g.includes("迎合"));
});

// ── 进度提示 ─────────────────────────────
test("buildProgressHint：显示 done/total", () => {
  const h = buildProgressHint("bug", 2, 4);
  assert.ok(h.includes("2/4"));
  assert.ok(h.includes("bug"));
});
