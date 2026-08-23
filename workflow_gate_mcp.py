#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
workflow_gate_mcp.py — 工作流约束 MCP Server

暴露 4 个工具：
  wf_begin  → 任务开始时调用，按规则表返回应遵循的技能链与阶段清单
  wf_check  → 标记/检查某个流程阶段是否完成
  wf_status → 查看当前任务状态（跨轮次持久化）
  wf_reset  → 结束当前任务，清除状态

stdio 传输，供 pi（pi-mcp-adapter）本地集成。
状态存储于 ~/.pi/agent/workflow/，规则表为同目录 workflow.json。
"""
import os, sys, json
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from mcp.server.fastmcp import FastMCP

BASE = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(BASE)          # ~/.pi/agent
RULES_PATH = os.path.join(BASE, "workflow.json")
STATE_PATH = os.path.join(BASE, "state.json")
AUDIT_PATH = os.path.join(BASE, "audit.log")

mcp = FastMCP("workflow_gate_mcp")


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
    return " → ".join(f"/skill:{s}" for s in skill_names)

def _fmt_stages(done, total, labels):
    lines = []
    for i, st in enumerate(total, 1):
        mark = "✓" if st in done else "○"
        lines.append(f"  {mark} {i}. {_stage_label(st, labels)}")
    return "\n".join(lines)


# ── 工具 ────────────────────────────────────────────────

@mcp.tool()
async def wf_begin(task_type: str, description: str = "") -> str:
    """任务开始时调用。传入任务类型，返回应遵循的技能链与阶段清单，并记录任务状态。
    task_type 取值：bug（遇到bug/报错/测试失败）、implement（实现功能/修复）、
    multi_step（多步骤任务如重构/迁移/搭建）、claim_complete（完成任务并声明完成前）、
    feature_design（新功能/创意设计）、doc_writing（撰写正式文档）、
    merge（合并/交付）、review_received（收到评审意见）、isolation（隔离工作区开发）。"""
    rules, labels = _load_rules()
    rule = rules.get(task_type)
    if not rule:
        return (f"✗ 未知任务类型「{task_type}」。可用类型："
                + ", ".join(rules.keys()))
    if not rule.get("enabled", True):
        return (f"⏸ 任务类型「{task_type}」当前未启用（/workflow enable {task_type} 可启用）。"
                "请按常识执行，无需本流程约束。")
    state = _load_state()
    skills = rule["skills"]
    stages = rule["stages"]
    state["task_type"] = task_type
    state["description"] = description
    state["skills"] = skills
    state["stages"] = stages
    state["done"] = []
    state["started_at"] = _now()
    state["updated_at"] = _now()
    _save_state(state)
    _audit("wf_begin", f"{task_type} | {description[:80]}")
    return (f"⚡ workflow-gate 已激活 · 任务类型「{task_type}」\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"必须遵循的技能链：\n  {_fmt_skills(skills)}\n\n"
            f"阶段清单（每完成一步调用 wf_check 标记）：\n"
            f"{_fmt_stages([], stages, labels)}\n\n"
            f"说明：先加载技能内容（/skill:名称 或 read SKILL.md），"
            "按技能流程执行；声称完成前必须先完成「verify/最后阶段」并用 wf_check 标记。")


@mcp.tool()
async def wf_check(stage: str, note: str = "") -> str:
    """标记某个流程阶段完成，或查询某阶段是否完成（note 留空时只查询不标记）。
    stage 取值由 wf_begin 返回的阶段清单给出，如 reproduce、root-cause、fix、verify、
    write-test、implement、tests-pass、plan、execute、explore、decide、outline、draft、
    review、self-review、submit-review、merge、evaluate、worktree、develop、merge-back。"""
    state = _load_state()
    if not state.get("task_type"):
        return "✗ 当前没有激活的任务。请先调用 wf_begin 开始任务。"
    stages = state["stages"]
    labels = _load_rules()[1]
    done = set(state.get("done", []))
    if stage not in stages:
        return (f"✗ 阶段「{stage}」不属于当前任务「{state['task_type']}」。"
                f"可用阶段：{', '.join(stages)}")
    if note:
        done.add(stage)
        state["done"] = sorted(done, key=lambda s: stages.index(s))
        state["updated_at"] = _now()
        if "notes" not in state:
            state["notes"] = {}
        state["notes"][stage] = note[:200]
        _save_state(state)
        _audit("wf_check", f"{state['task_type']} | {stage} | {note[:80]}")
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
    lines = [f"⚡ workflow-gate · 任务「{state['task_type']}」",
             f"  描述: {state.get('description') or '-'}",
             f"  开始: {state.get('started_at')}",
             "━━━━━━━━━━━━━━━━━━━━━━━━",
             _fmt_stages(done, stages, labels)]
    if remaining:
        lines.append(f"\n下一步：{_stage_label(remaining[0], labels)}")
    else:
        lines.append("\n✅ 全部阶段完成。")
    return "\n".join(lines)


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
