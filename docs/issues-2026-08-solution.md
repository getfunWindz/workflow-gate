# workflow-gate 使用问题报告 · 解决方案

> 日期：2026-08-26 · 依据：《workflow-gate使用问题报告.md》（黄金分割率算法项目，17 次触发 / 分类准确率约 40%）
> 本文档给出**可落地的三层修复方案**，含验收标准。实施前请确认实施范围。

---

## 0. 诊断结论（先看这个）

报告定位准确，但**需要修正一处根因归属**：问题绝大部分不由 MCP Server（`workflow_gate_mcp.py`）造成，而由 **pi 扩展 `extensions/workflow-gate.ts` 的 `detectTaskType()`** 造成：

- 按 `KEYWORDS` 对象**定义顺序**遍历，**首命中即返回**（bug → implement → multi_step → feature_design → doc_writing），词汇重叠时误判；
- 仅匹配**单条用户消息**，不看会话上下文——前序对话已明确性质的消息仍重新分类；
- **每次 input 事件都触发**（同一任务链内 17 次），无进行中状态感知；
- **无豁免通道**：用户说"不走流程/先讨论"仍强制提醒；
- 提醒以 `transform` 追加到用户消息**尾部**，与用户指令混排。

**报告中的 3 处不实断言（供参考，避免据此开发）**：

| 报告断言 | 实际代码 | 结论 |
|---|---|---|
| 「完成时无自动提示调用 wf_reset」 | `wf_check` 全绿时返回「✅ 所有阶段已完成。可调用 wf_reset 结束任务。」 | 已有，无需修 |
| 「阶段枚举是全局固定池，decide/self-review 等从未分配」 | `workflow.json` 中每个 rule 有自己的 `stages` 列表 | 表述不准确；但「decision 类任务无对应类型」是事实 |
| 「阶段枚举英文、中英混杂」 | `wf_begin/wf_check` 输出经 `stage_labels` 中文渲染（复现问题/定位根因…），仅 API 标识符为英文（必要） | 大部分已改善；仅补术语注释 |

---

## 1. 修复方案总览

| 层 | 文件 | 修复内容 | 对应报告条目 |
|---|---|---|---|
| A | `extensions/workflow-gate.ts`（**不在仓库，需补充收录**） | 分类器重构 + 上下文感知 + 豁免通道 | 2.1 / 2.2 |
| B | `workflow_gate_mcp.py` + `workflow.json` | 新任务类型 + 顺序强制 + 证据字段 + note 查询 | 2.3 / 2.4 / 2.5 |
| C | `AGENTS.md`（工作流宪章）+ `README.md` | 使用规范澄清 + 触发机制文档 + 版本说明 | 3 结语 |

---

## 2. A 层：扩展分类器重构（P0，治本）

### A1. 分类从「关键词裁决」改为「粗筛 + 代理确认」

关键词检测不再直接产出结论，只产出**候选**，提醒文案引导代理与用户确认后再 `wf_begin`：

```ts
// 改造后：detectTaskType 返回候选列表而非单一类型
const candidates = detectTaskCandidates(text); // string[]（按优先级排序，最多 3 个）
// 提醒文案：
// [workflow-gate 提醒] 检测「{首候选}」候选：{candidates.join("、")}。
// 请与用户确认任务实质（交付物是代码/文档/决策？）后调用 wf_begin(task_type=...)；
// 若确实不需要流程，调用 wf_begin(task_type="none") 声明豁免。
```

**理由**：分类需要任务实质（交付物），而扩展无 LLM 能力；把「裁决权」交给对话主体，准确率提升且尊重用户意图。粗筛规则同时按**交付物信号词**重排优先级：文档词（`报告/文档/spec`）> bug 词（`报错/失败/测试不过`）> 实现词（`实现/写个`）> 计划词（`重构/搭建/新项目`），信号重叠时不再首命中即返回。

### A2. 上下文感知（消除 17 次重复触发）

`input` 事件中读取 `workflow/state.json`：

- 已激活任务且阶段**未全绿** → 只提醒一行「进行中：{task_type}（{done}/{total}），请继续 wf_check」，不再重新分类；
- 新任务开始前若有**未重置的旧任务** → 附「检测到上一任务未 wf_reset」提示。

### A3. 豁免通道（用户显式声明）

- 用户消息命中豁免语（`跳过流程/不用流程/先讨论/别走流程/豁免/不走流程/不需要']`），或请求分类为 `none` 时：**不触发提醒**；
- 新增 `/workflow pause` / `/workflow resume`：会话级暂停/恢复提醒（内存变量，不落盘）。

### A4. 提醒视觉分离

提醒改为独立段落并加引用标记：`\n\n> ⚙️ **workflow-gate**：…`，与用户指令明确分界。

**验收**：①「生成正式回归报告」→ 候选含 doc_writing 且不直接断言；② 同一任务链后续消息不再重复分类；③ 用户说「先讨论」→ 零提醒。

---

## 3. B 层：MCP Server 状态机强化（P1）

### B1. `workflow.json` 新增任务类型与豁免类型

| 类型 | skills | stages | 场景 |
|---|---|---|---|
| `decision` | brainstorming | discuss → decide → record | 讨论/决策（Q3 体系等高频场景） |
| `research` | ——（或 url-citation-search） | search → synthesize → report | 论文检索、数据集评估 |
| `review` | systematic-debugging（或 requesting-code-review） | scan → classify → fix/record → verify | 全面回顾类任务（不再误用 bug） |
| `none` | —— | —— | 豁免：wf_begin 返回「已记录豁免，请按任务实质执行」 |

`wf_begin(task_type="none")` 的实现：**不在 rules 表**，MCP server 内单独处理——记录 audit + 返回豁免确认（阶段清单为空）。

### B2. 阶段顺序强制（可选开关）

`workflow.json` 每规则增加 `"ordered": true|false`（默认 false 兼容旧行为）：

- `ordered: true` 时，`wf_check` 标记**非当前期望阶段**（done 之后第一个未完成阶段）→ 返回错误「请先完成 {label}」；
- 默认关闭，不破坏现有使用习惯。

### B3. 证据字段（可审计的「声称完成」）

`wf_check` 新增可选参数 `evidence`（如 `pytest 输出 /tmp/x.log`、`git diff 摘要`），写入 `state.json`（`notes` 扩展为 `{stage: {note, evidence, at}}`）与 audit.log，`wf_status` 可回读。

### B4. 新工具 `wf_notes`（报告 2.5）

列出当前任务全部阶段的 note/evidence/时间，解决「写了没处看」问题。

### B5. 阶段术语对齐

`stage_labels` 注释 + MCP docstring 补充术语映射：`write-test = RED`、`implement = GREEN`、`tests-pass = REFACTOR` 等，消除理解成本。

**验收**：① `wf_begin(task_type="research")` 返回 3 阶段中文清单；② `ordered:true` 规则下乱序标记被拒；③ `wf_check(evidence=...)` 后 `wf_notes` 可回读；④ 豁免调用在 audit.log 留痕。

---

## 4. C 层：文档与使用规范（P2）

### C1. 工作流宪章 AGENTS.md 增补

- 「提醒是**建议框架**，任务实质是裁决者」：分类不匹配时，代理**先与用户确认**，再选择正确 task_type 或声明豁免，无需"无视提醒"；
- 提及 `wf_begin(task_type="none")` 与 `/workflow pause` 的合法用法。

### C2. 仓库补充与版本发布

- 将 `extensions/workflow-gate.ts` **收录进仓库**（新增 `extension/` 目录），README 增加「触发机制」章节（分类→确认→门控全链路图）；
- 发布 v0.2.0：changelog 记录 A/B/C 三层变更；`state.json`/`audit.log` 继续 gitignore。

**验收**：仓库含 extension 源码；README 全链路说明可读；tag v0.2.0。

---

## 5. 实施顺序与建议

1. **A 层先行**（P0）：解 40% 准确率与 17 次噪声，直接决定体验；
2. **B1 + B4 + B3**（P1）：新增类型与证据链，覆盖报告 80% 场景缺口；
3. **B2 顺序强制**（P1，默认关）：状态机语义强化，低风险；
4. **C 层**（P2）：文档与发布，随 v0.2.0 一起。

> 各层均有独立验收标准；实施时按 TDD 流程为 `workflow_gate_mcp.py` 补测试（当前项目无测试目录，建议建立 `tests/`）。
