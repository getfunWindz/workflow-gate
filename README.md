# workflow-gate · 工作流门控 MCP Server

> 让你的 coding agent 在**正确的时间、做正确的事、用正确的方法**——不是一个建议，而是一道门。

`workflow-gate` 是一个基于 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 的本地工作流门控服务。它把业界验证过的开源 Agent 技能（[Superpowers](https://github.com/obra/superpowers) 软件开发方法论 + [Anthropic 官方技能](https://github.com/anthropics/skills)）编排成一张「**任务类型 → 强制技能链 → 阶段清单**」的规则表，并通过 4 个 MCP 工具在对话中强制执行：

- 任务开始时，agent 必须调用 `wf_begin` 取得该任务应遵循的技能链与阶段清单；
- 每个阶段完成时，agent 必须调用 `wf_check` 标记进度，否则无法进入下一阶段；
- 声称「完成 / 修复 / 通过」之前，最后一个验证阶段是不可跳过的门。

一句话：**它把「工程师该有的纪律」变成了 agent 无法绕过的流程**，避免了「口头承诺遵守、实际跳过验证」这类最常见的失守。

---

## 特性

- 🧭 **任务类型路由**：9 种任务类型（bug 修复、功能实现、多步骤任务、文档撰写等）各自映射到一组强制技能链；
- 🚦 **阶段门控**：每个流程拆成有序阶段，逐阶段调用 `wf_check` 标记，未完成前一步无法进入下一步；
- 🔒 **跨轮次持久化**：任务状态写入本地 JSON，会话压缩、切换轮次都不会丢失进度；
- 📜 **审计日志**：所有 `wf_begin` / `wf_check` 动作带 UTC 时间戳追加写入 `audit.log`，事后可追溯；
- 🧩 **规则可配置**：技能链、阶段、开关全部定义在 `workflow.json`，无需改代码即可增删规则；
- 🪶 **零外部依赖服务**：纯 Python stdio MCP Server，仅依赖 `pydantic` 与 `mcp` 两个包，本地运行，不上传任何数据。

---

## 安装

### 1. 准备

```bash
# 依赖（Python 3.10+）
pip install mcp pydantic
```

### 2. 放置文件

将本目录下的两个文件放入任意位置（示例：`~/.pi/agent/workflow/`）：

```
workflow/
├── workflow_gate_mcp.py   # MCP Server 本体
└── workflow.json          # 规则表（技能链 / 阶段 / 开关）
```

### 3. 注册 MCP 服务

在 MCP 客户端配置中注册（`mcpServers` 数组/对象），示例为 [pi](https://github.com/earendil-works/pi) 的 `mcp.json`：

```json
{
  "mcpServers": {
    "workflow-gate": {
      "command": "python",
      "args": ["C:\\Users\\<你>\\...\\workflow\\workflow_gate_mcp.py"]
    }
  }
}
```

> 其他 MCP 客户端（Claude Desktop、Cursor 等）配置方式类似，只需 `command` + `args` 指向该脚本即可。路径请改为你实际部署的位置。

---

## 使用

### 工具一览

| 工具 | 调用时机 | 作用 |
|---|---|---|
| `wf_begin` | 任务开始时 | 按任务类型返回应遵循的技能链与阶段清单，并激活任务状态 |
| `wf_check` | 每个阶段完成时 | 标记当前阶段完成，显示剩余阶段与下一步 |
| `wf_status` | 任意时刻 | 查看当前任务类型、已完成阶段、下一步 |
| `wf_reset` | 任务结束时 | 清除任务状态，结束当前任务 |

### 任务类型 → 强制技能链

| 任务类型 | 触发场景 | 强制技能链 | 阶段 |
|---|---|---|---|
| `bug` | 遇到 bug / 报错 / 测试失败 / 异常行为 | `systematic-debugging` | 复现问题 → 定位根因 → 实施修复 → 运行验证并展示证据 |
| `implement` | 实现任何功能或修复之前 | `test-driven-development` | 先写测试 → 实现功能 → 测试通过 |
| `multi_step` | 多步骤任务（重构 / 迁移 / 搭建 / 新项目） | `writing-plans` + `executing-plans` | 产出计划 → 按计划执行 |
| `claim_complete` | 声称「完成 / 修复 / 通过」之前 | `verification-before-completion` | 运行验证并展示证据 |
| `feature_design` | 新功能 / 创意 / 方案设计前 | `brainstorming` | 探索需求与设计选项 → 与用户确认方案 |
| `doc_writing` | 撰写正式文档（方案 / 报告 / README / 说明书） | `doc-coauthoring` | 明确文档结构与读者 → 撰写初稿 → 复核文档可用性 |
| `merge` | 合并 / 交付前 | `requesting-code-review` + `finishing-a-development-branch` | 自查 diff 与测试 → 发起评审 → 合并交付 |
| `review_received` | 收到外部评审意见 | `receiving-code-review` | 评估评审意见 → 实施修改 |
| `isolation` | 需要隔离工作区（实验 / 并行开发） | `using-git-worktrees` | 创建隔离工作区 → 在隔离区开发 → 合并回主工作区 |

### 完整示例

```
用户: 这个接口报 500 错误，帮我修一下
─── agent 调用 wf_begin(task_type="bug") ───
⚡ workflow-gate 已激活 · 任务类型「bug」
必须遵循的技能链：
  /skill:systematic-debugging
阶段清单（每完成一步调用 wf_check 标记）：
  ○ 1. 复现问题
  ○ 2. 定位根因
  ○ 3. 实施修复
  ○ 4. 运行验证并展示证据

─── agent 每完成一步调用 wf_check(stage="reproduce") ───
...
─── 全部阶段完成后 ───
✅ 所有阶段已完成。可调用 wf_reset 结束任务。
```

---

## 架构

```
┌──────────────┐    wf_begin/check/status/reset    ┌────────────────────┐
│   MCP 客户端  │ ───────────────────────────────▶ │  workflow_gate_mcp  │
│  (pi / Claude │ ◀─────────────────────────────── │  (stdio, FastMCP)   │
│   Desktop...) │    技能链 + 阶段清单 + 进度        └─────────┬──────────┘
└──────────────┘                                          │
                                             ┌────────────┴────────────┐
                                             │  ~/.pi/agent/workflow/   │
                                             │  ├─ workflow.json 规则表 │
                                             │  ├─ state.json    进度   │
                                             │  └─ audit.log    审计     │
                                             └─────────────────────────┘
```

### 文件布局

| 文件 | 说明 |
|---|---|
| `workflow_gate_mcp.py` | MCP Server 实现（工具、状态读写、审计、格式化输出） |
| `workflow.json` | 规则表：`rules`（任务类型 → 技能链/阶段/开关）+ `stage_labels`（阶段中文标签） |
| `state.json` | 运行时状态（当前任务、已完成阶段、备注），**无需提交 Git** |
| `audit.log` | 审计日志（时间戳 + 动作 + 备注），**无需提交 Git** |

### 自定义规则

`workflow.json` 中每条规则的结构：

```json
{
  "your_task_type": {
    "enabled": true,
    "skills": ["skill-a", "skill-b"],
    "stages": ["stage-1", "stage-2"]
  }
}
```

- `enabled: false` 可临时停用某条规则（agent 将被告知无需受约束）；
- 新增任务类型只需追加键，并在 `stage_labels` 中补充中文标签。

---

## 上游致谢

`workflow-gate` 不做方法论发明，只做**编排与执行**。其规则表引用的技能均来自以下开源项目（技能内容本身的版权归原作者，部署于你的技能目录如 `~/.pi/agent/skills/`）：

| 技能 | 上游项目 | 许可 |
|---|---|---|
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `test-driven-development` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `writing-plans` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `executing-plans` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `brainstorming` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `requesting-code-review` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `receiving-code-review` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `finishing-a-development-branch` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `using-git-worktrees` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `doc-coauthoring` | [anthropics/skills](https://github.com/anthropics/skills) | Apache 2.0（开源部分） |

> Superpowers 由 [Jesse Vincent](https://blog.fsck.com) (obra) 与 [Prime Radiant](https://primeradiant.com) 团队构建。

---

## License

本项目 MIT License（见 `LICENSE`）。引用的技能内容遵循其各自上游许可（详见「上游致谢」表）。

---

## 免责声明

本工具是**流程约束器**，不提供任何代码修复、测试或文档能力；它依赖你环境中已安装的对应技能（`/skill:xxx`）真正生效。请确保技能文件已正确部署，否则门控提示与实际行动可能脱节。
