# Changelog

## v0.4.0（2026-08-27）

**无 pi 扩展路线正式确立**

- 回滚收尾：extensions/ 隔离区已清理，运行环境零扩展残留；
- 功能补位：新增 MCP 工具 wf_rules（list / enable / disable），替代原扩展的 /workflow 命令；
- 模式说明：宪章（AGENTS.md 工作流表）+ MCP Server 为唯一运行方式；
- 测试：新增 3 例，共 14/14 全绿；
- extension/ 目录仅保留参考实现。

## v0.3.1（2026-08-27）

**回滚：pi 扩展整体停用**

- 背景：v0.2 引入的 pi 扩展（自动提醒）在真实环境中两次引发 pi 启动/输入异常（v0.2 顶层文件不合法、v0.3 子目录模式仍不稳定），已决定**不再部署扩展**；
- 回滚动作：运行环境 `extensions/` 中所有 workflow-gate 文件已移除并隔离（`_quarantine/`）；
- 推荐模式：**宪章（AGENTS.md 工作流表）+ MCP Server** —— 任务开始时主动调用 `wf_begin` 获取阶段清单，由宪章约束流程；MCP 门控能力（wf_begin/wf_check/wf_status/wf_notes/wf_reset）不受影响；
- 仓库保留 `extension/` 子目录参考实现（未部署即不生效），后续若 pi 扩展生态稳定可重新评估。

## v0.3.0（2026-08-27）

**热修复：pi 扩展目录结构不合法**

- 问题：v0.2 将 `workflow-gate-core.ts` 放在 `extensions/` 顶层，pi 会把**顶层每个 `.ts` 文件**当作独立扩展加载；core.ts 没有 default export，扩展加载失败并影响 pi 启动与其他会话输入；
- 修复：改为官方支持的**子目录模式**——`extensions/workflow-gate/index.ts`（入口）+ `core.ts`（依赖）；与 pi 官方示例 `doom-overlay/` 同构；
- 验证：`test/extension-core.test.ts` 11/11 pass（Node type-stripping 实际执行）；
- 提示：旧顶层文件已隔离（`extensions/_quarantine/`），确认无误后可删除。

## v0.2.0（2026-08-26）

依据《使用问题报告》（17 次触发 / 分类准确率约 40%）的三层修复：

### A 层 · 触发机制重构（`extension/`，新增收录）

- **分类器从「关键词裁决」改为「粗筛 + 确认」**：`detectTaskCandidates` 收集全部命中类型并按交付物信号优先级排序（文档 > bug > 实现 > 计划 > 设计 > 讨论 > 调研 > 评审），提醒文案引导与用户确认任务实质后再 `wf_begin`，不再直接断言任务类型；
- **上下文感知**：有进行中任务时只提示进度（`buildProgressHint`），同一任务链不再重复分类触发；
- **豁免通道**：用户显式豁免语（"先讨论 / 跳过流程 / 不走流程"等）不触发提醒；`wf_begin(task_type="none")` 记录审计豁免；新增 `/workflow pause` / `/workflow resume` 会话级开关；
- **提醒视觉分离**：提醒独立为引用块（`> ⚙️ **workflow-gate**`），与用户指令明确分界。

### B 层 · MCP 状态机强化（`workflow_gate_mcp.py` + `workflow.json`）

- 新增任务类型：`decision`（discuss→decide→record）、`research`（search→synthesize→report）、`review`（scan→classify→fix→verify）；
- `wf_begin(task_type="none")` 豁免通道（audit 留痕，不残留状态）；
- 残留任务警告：上一任务未完成时开启新任务会提示先 `wf_reset`；
- 阶段顺序强制：规则级 `"ordered": true`（默认关闭，保持兼容），开启后乱序标记被拒；
- `wf_check` 新增 `evidence` 参数：验证证据写入 state + audit，可审计的「声称完成」；
- 新工具 `wf_notes`：回读各阶段备注/证据（兼容旧版字符串格式）；
- 阶段术语对齐注释（write-test=RED / implement=GREEN / tests-pass=REFACTOR / verify=evidence-before-claims）。

### C 层 · 工程配套

- 新增 `tests/test_workflow_gate.py`（11 用例，unittest）与 `test/extension-core.test.ts`（11 用例，node:test）；
- 宪章增补「提醒是建议框架，任务实质是裁决者」使用规范；
- README 新增「触发机制」章节。

> 变更内容与运行环境 `~/.pi/agent/` 已同步（旧文件备份为 `*.bak-v0.1`）。
