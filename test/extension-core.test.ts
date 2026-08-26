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
  const r = buildReminder(["doc_writing", "implement"]);
  assert.ok(r);
  assert.ok(r.includes("确认任务实质"));
  assert.ok(r.includes("候选"));
});

test("buildReminder：空候选 → null", () => {
  assert.equal(buildReminder([]), null);
});

// ── 进度提示 ─────────────────────────────
test("buildProgressHint：显示 done/total", () => {
  const h = buildProgressHint("bug", 2, 4);
  assert.ok(h.includes("2/4"));
  assert.ok(h.includes("bug"));
});
