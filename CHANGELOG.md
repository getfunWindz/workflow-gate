# Changelog

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
