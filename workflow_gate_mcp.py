#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
workflow_gate_mcp.py — 工作流约束 MCP Server

暴露 5 个工具：
  wf_begin  → 任务开始时调用，按规则表返回应遵循的技能链与阶段清单
  wf_check  → 标记/检查某个流程阶段是否完成（支持顺序强制与证据字段）
  wf_status → 查看当前任务状态（跨轮次持久化）
  wf_notes  → 回读各阶段已记录的备注与证据
  wf_reset  → 结束当前任务，清除状态

stdio 传输，供 pi（pi-mcp-adapter）本地集成。
状态存储于 ~/.pi/agent/workflow/，规则表为同目录 workflow.json。

术语对齐（阶段标识符 ↔ 流程文档术语）：
  write-test ↔ RED（先写失败测试）
  implement  ↔ GREEN（最小实现让测试通过）
  tests-pass ↔ REFACTOR（清理重构，测试保持通过）
  verify     ↔ evidence-before-claims（先证据后断言）
"""
import os
import sys
import json
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from mcp.server.fastmcp import FastMCP

BASE = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(BASE)          # 规则表同目录
RULES_PATH = os.path.join(BASE, "workflow.json")
STATE_PATH = os.path.join(BASE, "state.json")
AUDIT_PATH = os.path.join(BASE, "audit.log")

mcp = FastMCP("workflow_gate_mcp")

EXEMPT_LABEL = "none"


# ── 数据层 ──────────────────────────────────────────────

def _load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def _save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def _audit(action, detail):
    try:
        with open(AUDIT_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{_now()}] {action} | {detail}\n")
    except Exception:
        pass

def _load_rules():
    rules = _load_json(RULES_PATH, {"rules": {}, "stage_labels": {}})
    return rules.get("rules", {}), rules.get("stage_labels", {})

def _load_state():
    return _load_json(STATE_PATH, {})

def _save_state(state):
    _save_json(STATE_PATH, state)

def _stage_label(stage, labels):
    return labels.get(stage, stage)

def _fmt_skills(skill_names):
    if not skill_names:
        return "（本流程不绑定特定技能，请按任务实质执行）"
    return " → ".join(f"/skill:{s}" for s in skill_names)

def _fmt_stages(done, total, labels):
    lines = []
    for i, st in enumerate(total, 1):
        mark = "✓" if st in done else "○"
        lines.append(f"  {mark} {i}. {_stage_label(st, labels)}")
    return "\n".join(lines)

def _note_text(rec):
    """兼容两种 notes 格式：旧版=字符串，新版={note, evidence, at}。"""
    if isinstance(rec, dict):
        return rec.get("note", "")
    return rec if isinstance(rec, str) else ""


# ── 工具 ────────────────────────────────────────────────

@mcp.tool()
async def wf_begin(task_type: str, description: str = "") -> str:
    """任务开始时调用。传入任务类型，返回应遵循的技能链与阶段清单，并记录任务状态。
    task_type 取值：bug、implement、multi_step、claim_complete、feature_design、
    doc_writing、decision（讨论/决策）、research（调研）、review（评审）、
    merge、review_received、isolation，以及 none（显式声明本轮不启用流程）。"""
    # 豁免通道：显式声明不启用流程
    if task_type == EXEMPT_LABEL:
        _audit("wf_begin", "none | 豁免 | " + (description[:80] or "-"))
        return ("⚪ workflow-gate 已豁免 · 本任务不启用流程约束（已记录审计）。\n"
                "请按任务实质执行；若之后决定启用流程，可再次调用 wf_begin(task_type=...)。")
    rules, labels = _load_rules()
    rule = rules.get(task_type)
    if not rule:
        return (f"✗ 未知任务类型「{task_type}」。可用类型："
                + ", ".join(rules.keys()) + f", {EXEMPT_LABEL}（豁免）")
    if not rule.get("enabled", True):
        return (f"⏸ 任务类型「{task_type}」当前未启用（/workflow enable {task_type} 可启用）。"
                "请按常识执行，无需本流程约束。")
    state = _load_state()
    skills = rule["skills"]
    stages = rule["stages"]
    ordered = bool(rule.get("ordered", False))
    # 残留任务警告：上一任务未完成就开启新任务
    remnant = ""
    prev = state.get("task_type")
    if prev and prev != task_type:
        done = state.get("done", [])
        total = state.get("stages", [])
        if len(done) < len(total):
            label = _stage_label(prev, labels)
            remnant = (f"⚠ 检测到上一任务「{prev}（{label}）」尚未完成"
                       f"（{len(done)}/{len(total)}），请先调用 wf_reset 结束旧任务。\n\n")
    # 任务级归档：把旧任务摘要存入 history，当前任务 notes 不再跨任务累积
    history = state.get("history", [])
    if prev:
        history.append({
            "task_type": prev,
            "stages": state.get("stages", []),
            "done": state.get("done", []),
            "notes": state.get("notes", {}),
            "started_at": state.get("started_at"),
            "ended_at": _now(),
        })
    state["task_type"] = task_type
    state["description"] = description
    state["skills"] = skills
    state["stages"] = stages
    state["ordered"] = ordered
    state["done"] = []
    state["notes"] = {}
    state["history"] = history[-20:]  # 最多保留 20 个历史任务
    state["started_at"] = _now()
    state["updated_at"] = _now()
    _save_state(state)
    _audit("wf_begin", f"{task_type} | {description[:80]}")
    order_hint = "（阶段顺序已强制：必须按序标记）" if ordered else ""
    return (f"⚡ workflow-gate 已激活 · 任务类型「{task_type}」\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"{remnant}"
            f"必须遵循的技能链：\n  {_fmt_skills(skills)}\n\n"
            f"阶段清单（每完成一步调用 wf_check 标记）{order_hint}：\n"
            f"{_fmt_stages([], stages, labels)}\n\n"
            f"说明：先加载技能内容（/skill:名称 或 read SKILL.md），"
            "按技能流程执行；声称完成前必须先完成「verify/最后阶段」并用 wf_check 标记。"
            "若发现流程与任务实质不符，请先与用户确认正确的 task_type，"
            "或声明 wf_begin(task_type=\"none\") 豁免本轮。")


@mcp.tool()
async def wf_check(stage: str, note: str = "", evidence: str = "") -> str:
    """标记某个流程阶段完成，或查询某阶段是否完成（note/evidence 留空时只查询不标记）。
    stage 取值由 wf_begin 返回的阶段清单给出。evidence 可选：附验证证据
    （如测试输出路径、diff 摘要），供后续 wf_notes 审计回读。"""
    state = _load_state()
    if not state.get("task_type"):
        return "✗ 当前没有激活的任务。请先调用 wf_begin 开始任务。"
    rules, labels = _load_rules()
    stages = state["stages"]
    ordered = bool(state.get("ordered", False))
    done = set(state.get("done", []))
    if stage not in stages:
        return (f"✗ 阶段「{stage}」不属于当前任务「{state['task_type']}」。"
                f"可用阶段：{', '.join(stages)}")
    if ordered and stage not in done:
        expected = next((s for s in stages if s not in done), None)
        if expected is not None and stage != expected:
            return (f"✗ 阶段顺序错误：本任务已开启顺序强制，"
                    f"请先完成「{_stage_label(expected, labels)}」"
                    f"（调用 wf_check stage=\"{expected}\"）。")
    if note or evidence:
        done.add(stage)
        state["done"] = sorted(done, key=lambda s: stages.index(s))
        state["updated_at"] = _now()
        if "notes" not in state or not isinstance(state["notes"], dict):
            state["notes"] = {}
        state["notes"][stage] = {
            "note": note[:200],
            "evidence": evidence[:500],
            "at": _now(),
        }
        _save_state(state)
        extra = f" | evidence: {evidence[:80]}" if evidence else ""
        _audit("wf_check", f"{state['task_type']} | {stage} | {note[:80]}{extra}")
    remaining = [s for s in stages if s not in done]
    lines = [f"⚡ workflow-gate · 任务「{state['task_type']}」",
             "━━━━━━━━━━━━━━━━━━━━━━━━",
             _fmt_stages(done, stages, labels)]
    if remaining:
        lines.append(f"\n下一步：{_stage_label(remaining[0], labels)}"
                     f"（调用 wf_check stage=\"{remaining[0]}\" 标记完成）")
    else:
        lines.append("\n✅ 所有阶段已完成。可调用 wf_reset 结束任务。")
    return "\n".join(lines)


@mcp.tool()
async def wf_status() -> str:
    """查看当前任务状态：任务类型、已完成的阶段、下一步、开始时间。"""
    state = _load_state()
    if not state.get("task_type"):
        return "⏸ 当前没有激活的任务。调用 wf_begin 开始一个受约束的任务。"
    labels = _load_rules()[1]
    done = set(state.get("done", []))
    stages = state["stages"]
    remaining = [s for s in stages if s not in done]
    notes = state.get("notes") or {}
    count = sum(1 for v in notes.values() if _note_text(v) or (isinstance(v, dict) and v.get("evidence")))
    lines = [f"⚡ workflow-gate · 任务「{state['task_type']}」",
             f"  描述: {state.get('description') or '-'}",
             f"  开始: {state.get('started_at')}",
             f"  留痕: {count} 条阶段备注/证据（wf_notes 查看）",
             "━━━━━━━━━━━━━━━━━━━━━━━━",
             _fmt_stages(done, stages, labels)]
    if remaining:
        lines.append(f"\n下一步：{_stage_label(remaining[0], labels)}")
    else:
        lines.append("\n✅ 全部阶段完成。")
    return "\n".join(lines)


@mcp.tool()
async def wf_rules(action: str = "list", rule: str = "") -> str:
    """管理规则表（无 pi 扩展时的替代入口，对应原 /workflow 命令）。
    action 取值：list（列出全部规则与开关）、enable <rule>、disable <rule>。
    规则开关持久化于 workflow.json，禁用后 wf_begin 会提示该流程未启用。"""
    rules, labels = _load_rules()
    if not rules:
        return "✗ 规则表为空或不可读。"
    if action == "list":
        lines = []
        for k, v in rules.items():
            on = v.get("enabled", True)
            mark = "✅" if on else "⏸"
            skills = ", ".join(v.get("skills", [])) or "无技能"
            lines.append(f"{mark} {k}: {skills}{'' if on else '（未启用）'}")
        return "工作流规则:\n" + "\n".join(lines)
    if action in ("enable", "disable"):
        if rule not in rules:
            return f"✗ 未知规则「{rule}」。可用: {', '.join(rules.keys())}"
        if action == "enable":
            rules[rule].pop("enabled", None)
        else:
            rules[rule]["enabled"] = False
        _save_json(RULES_PATH, {"rules": rules, "stage_labels": labels})
        _audit("wf_rules", f"{action} | {rule}")
        return f"✔ 已{('启用' if action == 'enable' else '禁用')}规则「{rule}」"
    return "用法: wf_rules(action=\"list\" | \"enable\" | \"disable\", rule=...)"


@mcp.tool()
async def wf_notes(history: bool = False) -> str:
    """回读阶段备注与证据（审计用）。
    history=False 时仅显示当前任务；history=True 时追加显示已归档的历史任务备注。"""
    state = _load_state()
    if not state.get("task_type"):
        return "⏸ 当前没有激活的任务。先调用 wf_begin 开始任务后再读取备注。"
    labels = _load_rules()[1]
    parts = []
    notes = state.get("notes") or {}
    if notes:
        lines = ["📋 当前任务阶段备注与证据：", "━━━━━━━━━━━━━━━━━━━━━━━━"]
        for st, rec in notes.items():
            label = _stage_label(st, labels)
            if isinstance(rec, dict):
                note = rec.get("note", "") or "（未填备注）"
                ev = rec.get("evidence", "")
                at = rec.get("at", "")
                ev_line = f"\n  🔎 证据: {ev}" if ev else ""
                lines.append(f"• {st}（{label}）· {at}\n    {note}{ev_line}")
            else:
                lines.append(f"• {st}（{label}）\n    {_note_text(rec)}")
        parts.append("\n".join(lines))
    else:
        parts.append("📋 当前任务尚无阶段备注。")
    if history:
        hist = state.get("history", []) or []
        if hist:
            hlines = ["", "🕘 历史任务归档：", "━━━━━━━━━━━━━━━━━━━━━━━━"]
            for h in reversed(hist[-5:]):
                label = _stage_label(h.get("task_type", "?"), labels)
                hlines.append(f"• {h.get('task_type')}（{label}）· {h.get('started_at') or '-'}")
                for st, rec in (h.get("notes") or {}).items():
                    txt = _note_text(rec)
                    if "evidence" in (rec if isinstance(rec, dict) else {}):
                        txt = rec.get("note", "") + f" [证据: {rec.get('evidence', '')[:40]}]"
                    hlines.append(f"    - {st}: {txt[:80]}")
            parts.append("\n".join(hlines))
    return "\n".join(parts)


@mcp.tool()
async def wf_audit(limit: int = 20) -> str:
    """读取审计日志（audit.log）：最近 limit 条动作记录（begin/check/豁免/规则变更/reset）。"""
    if not os.path.exists(AUDIT_PATH):
        return "📄 无审计记录（audit.log 尚未创建）。"
    try:
        with open(AUDIT_PATH, encoding="utf-8") as f:
            lines = [l.rstrip() for l in f if l.strip()]
    except Exception:
        return "✗ 审计日志读取失败。"
    if not lines:
        return "📄 无审计记录。"
    limit = max(1, min(int(limit or 20), 200))
    recent = lines[-limit:]
    return (f"📜 审计日志（最近 {len(recent)}/{len(lines)} 条）：\n"
            + "\n".join(recent))


@mcp.tool()
async def wf_reset() -> str:
    """结束当前任务，清除任务状态（不删除规则表）。换任务前必须调用。"""
    state = _load_state()
    if not state.get("task_type"):
        return "⏸ 当前没有激活的任务，无需重置。"
    task_type = state["task_type"]
    _save_state({})
    _audit("wf_reset", task_type)
    return f"✔ 任务「{task_type}」已结束，状态已清除。"


if __name__ == "__main__":
    mcp.run()
