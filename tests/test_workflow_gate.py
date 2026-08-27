"""workflow_gate_mcp B 层修复的测试（TDD：先写测试，后实现）。

覆盖：新任务类型(decision/research/review)、豁免(none)、残留警告、
顺序强制(ordered)、证据字段(evidence)、wf_notes、旧格式兼容。

运行：python tests/test_workflow_gate.py
"""
import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, REPO)

spec = importlib.util.spec_from_file_location("wg", os.path.join(REPO, "workflow_gate_mcp.py"))
wg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wg)


def load_module_with_tmp_paths():
    """重新加载模块（隔离的 tmp 路径），返回 (module, tmpdir)。"""
    tmp = tempfile.mkdtemp()
    spec = importlib.util.spec_from_file_location(
        f"wg_{abs(hash(tmp))}", os.path.join(REPO, "workflow_gate_mcp.py")
    )
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.RULES_PATH = os.path.join(tmp, "workflow.json")
    m.STATE_PATH = os.path.join(tmp, "state.json")
    m.AUDIT_PATH = os.path.join(tmp, "audit.log")
    shutil.copy(os.path.join(REPO, "workflow.json"), m.RULES_PATH)
    return m, tmp


class TestWorkflowGate(unittest.TestCase):
    def setUp(self):
        self.m, self.tmp = load_module_with_tmp_paths()
        self.loop = asyncio.new_event_loop()

    def tearDown(self):
        self.loop.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def call(self, fn, *args, **kwargs):
        return self.loop.run_until_complete(fn(*args, **kwargs))

    def read_state(self):
        with open(self.m.STATE_PATH, encoding="utf-8") as f:
            return json.load(f)

    def read_audit(self):
        with open(self.m.AUDIT_PATH, encoding="utf-8") as f:
            return f.read()

    # ── 新任务类型 ─────────────────────────────
    def test_wf_begin_research_activates(self):
        out = self.call(self.m.wf_begin, "research", "检索论文")
        self.assertIn("research", out)
        self.assertIn("检索/收集素材", out)  # 中文阶段标签
        self.assertEqual(self.read_state()["task_type"], "research")

    def test_wf_begin_decision_and_review(self):
        for t in ("decision", "review"):
            out = self.call(self.m.wf_begin, t)
            self.assertIn(t, out)
        self.assertEqual(self.read_state()["task_type"], "review")

    # ── 豁免通道 ─────────────────────────────
    def test_wf_begin_none_exemption(self):
        out = self.call(self.m.wf_begin, "none", "本轮不走流程")
        self.assertIn("豁免", out)
        # 不残留激活任务
        self.assertFalse(os.path.exists(self.m.STATE_PATH))
        self.assertIn("none", self.read_audit())

    # ── 未知类型 ─────────────────────────────
    def test_wf_begin_unknown_type(self):
        out = self.call(self.m.wf_begin, "not-a-type")
        self.assertIn("未知任务类型", out)

    # ── 残留任务警告 ──────────────────────────
    def test_wf_begin_remnant_warning(self):
        self.call(self.m.wf_begin, "bug")  # 开始但未完成
        out = self.call(self.m.wf_begin, "research")
        self.assertTrue("未完成" in out or "未重置" in out, "应有残留任务警告")

    # ── 顺序强制（ordered: true）────────────────
    def test_wf_check_ordered_enforced(self):
        rules = json.load(open(self.m.RULES_PATH, encoding="utf-8"))
        rules["rules"]["bug"]["ordered"] = True
        rules["rules"]["bug"]["stages"] = ["reproduce", "fix"]
        json.dump(rules, open(self.m.RULES_PATH, "w", encoding="utf-8"), ensure_ascii=False)
        self.call(self.m.wf_begin, "bug")
        # 乱序：先标记 fix 应被拒
        out = self.call(self.m.wf_check, "fix", "先干修复")
        self.assertIn("请先完成", out)
        # 按序标记成功
        out = self.call(self.m.wf_check, "reproduce", "已复现")
        self.assertIn("✓", out)

    # ── 默认无序（旧行为兼容）──────────────────
    def test_wf_check_unordered_by_default(self):
        self.call(self.m.wf_begin, "bug")
        out = self.call(self.m.wf_check, "fix", "乱序仍允许")
        self.assertNotIn("请先完成", out)

    # ── 证据字段 ─────────────────────────────
    def test_wf_check_evidence_recorded(self):
        self.call(self.m.wf_begin, "bug")
        self.call(self.m.wf_check, "reproduce", "已复现", "pytest 输出见 /tmp/x.log")
        st = self.read_state()
        rec = st["notes"]["reproduce"]
        if isinstance(rec, dict):
            self.assertIn("evidence", rec)
            self.assertEqual(rec["evidence"], "pytest 输出见 /tmp/x.log")
        else:
            self.fail("notes 新格式应为对象")

    # ── wf_notes 回读 ────────────────────────
    def test_wf_notes_lists(self):
        self.call(self.m.wf_begin, "bug")
        self.call(self.m.wf_check, "reproduce", "已复现", "证据A")
        out = self.call(self.m.wf_notes)
        self.assertIn("reproduce", out)
        self.assertIn("已复现", out)
        self.assertIn("证据A", out)

    # ── 旧格式兼容（notes 为字符串）─────────────
    def test_notes_legacy_compat(self):
        self.call(self.m.wf_begin, "bug")
        with open(self.m.STATE_PATH, encoding="utf-8") as f:
            st = json.load(f)
        st["notes"] = {"reproduce": "旧式字符串备注"}
        with open(self.m.STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False)
        out = self.call(self.m.wf_notes)  # 不应抛异常
        self.assertIn("旧式字符串备注", out)

    # ── wf_rules 规则管理（无扩展时的替代入口）───────
    def test_wf_rules_list(self):
        out = self.call(self.m.wf_rules, "list")
        self.assertIn("bug", out)
        self.assertIn("research", out)  # 含新类型

    def test_wf_rules_disable_and_enable(self):
        out = self.call(self.m.wf_rules, "disable", "bug")
        self.assertIn("已禁用", out)
        rules = json.load(open(self.m.RULES_PATH, encoding="utf-8"))
        self.assertFalse(rules["rules"]["bug"].get("enabled", True))
        # 禁用后 wf_begin 应提示未启用
        out = self.call(self.m.wf_begin, "bug")
        self.assertIn("未启用", out)
        # 重新启用
        out = self.call(self.m.wf_rules, "enable", "bug")
        self.assertIn("已启用", out)
        out = self.call(self.m.wf_begin, "bug")
        self.assertIn("已激活", out)

    def test_wf_rules_unknown_rule(self):
        out = self.call(self.m.wf_rules, "disable", "not-a-rule")
        self.assertIn("未知规则", out)

    # ── wf_audit 审计查询 ─────────────────────
    def test_wf_audit_lists_recent(self):
        self.call(self.m.wf_begin, "bug", "审计测试")
        self.call(self.m.wf_check, "reproduce", "已复现")
        out = self.call(self.m.wf_audit)
        self.assertIn("wf_begin", out)
        self.assertIn("wf_check", out)

    def test_wf_audit_empty(self):
        out = self.call(self.m.wf_audit)
        self.assertTrue("无审计记录" in out or "无审计" in out, "空审计提示")

    # ── 任务级备注归档 ─────────────────────────
    def test_wf_begin_archives_old_notes(self):
        self.call(self.m.wf_begin, "bug")
        self.call(self.m.wf_check, "reproduce", "旧任务备注")
        self.call(self.m.wf_begin, "research", "新任务")  # 切换任务应归档旧备注
        st = self.read_state()
        self.assertIn("history", st)
        self.assertEqual(len(st["history"]), 1)
        self.assertIn("bug", st["history"][0]["task_type"])
        # 当前任务 notes 应已清空
        self.assertNotIn("reproduce", st.get("notes", {}))
        out = self.call(self.m.wf_notes)
        self.assertNotIn("旧任务备注", out)
        # 历史回读
        out = self.call(self.m.wf_notes, True)
        self.assertIn("旧任务备注", out)

    def test_wf_notes_history_flag_compat(self):
        self.call(self.m.wf_begin, "bug")
        out = self.call(self.m.wf_notes, True)  # 无历史时不应崩溃
        self.assertIsInstance(out, str)

    # ── 规则表一致性 ──────────────────────────
    def test_new_rules_present_in_json(self):
        rules = json.load(open(self.m.RULES_PATH, encoding="utf-8"))
        self.assertIn("decision", rules["rules"])
        self.assertIn("research", rules["rules"])
        self.assertIn("review", rules["rules"])
        self.assertEqual(
            rules["rules"]["decision"]["stages"], ["discuss", "decide", "record"]
        )
        for t in ("research", "review"):
            self.assertTrue(rules["rules"][t]["stages"])
        labels = rules["stage_labels"]
        for st in ("discuss", "decide", "record", "search", "synthesize", "report",
                   "scan", "classify"):
            self.assertIn(st, labels)


if __name__ == "__main__":
    unittest.main(verbosity=2)
