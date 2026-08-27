# pi 扩展官方规范与事故复盘

> 日期：2026-08-27 · 依据：[pi.dev/docs/latest/extensions](https://pi.dev/docs/latest/extensions)（官网）与 npm 包内 `docs/extensions.md`（v0.84.3，3002 行）交叉核对，两处口径一致。
> 目的：① 固化官方扩展写法与放置规范，避免重蹈 v0.2/v0.3 覆辙；② 诚实复盘此前「无法使用 pi」的真实归因。

---

## 1. 官方规范（可信来源 = pi.dev 官网 + 本地 docs）

### 1.1 放置位置（自动发现）

| Location | 作用域 |
|---|---|
| `~/.pi/agent/extensions/*.ts` | 全局（**顶层每个 .ts 都是独立扩展**） |
| `~/.pi/agent/extensions/*/index.ts` | 全局（子目录模式，入口必须叫 `index.ts`） |
| `.pi/extensions/*.ts` | 项目级 |
| `.pi/extensions/*/index.ts` | 项目级（子目录） |
| `settings.json` → `"extensions": ["/path/to/file.ts", "/path/to/dir"]` | 附加路径 |

**红线**：顶层 `extensions/*.ts` 目录下**任意 .ts 文件都会被当作扩展加载**——辅助模块不得放在顶层，必须放进子目录（`*/index.ts` 是唯一入口，同目录其他 .ts 只是普通模块）。

### 1.2 三种扩展结构（官方原文）

```text
■ 单文件（最简）
~/.pi/agent/extensions/
└── my-extension.ts

■ 目录 + index.ts（多文件扩展）★ 推荐
~/.pi/agent/extensions/
└── my-extension/
    ├── index.ts        # 入口：export default function (pi) {...}
    ├── tools.ts        # 辅助模块（不会被当作扩展加载）
    └── utils.ts        # 辅助模块

■ 包 + 依赖（需要 npm 包时）
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json    # dependencies + "pi": {"extensions": ["./src/index.ts"]}
    ├── package-lock.json / node_modules/
    └── src/index.ts
```

### 1.3 写法要点（官方）

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {          // 可 async
  pi.on("input", async (event, ctx) => { ... });      // 事件订阅
  pi.registerTool({ ... });                            // 注册工具
  pi.registerCommand("name", { ... });                 // 注册命令
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

- 加载器为 **jiti**（TS 免编译，运行时加载）；
- `export default` **必须**是工厂函数（接收 `ExtensionAPI`）；
- `import type` 用 `@earendil-works/pi-coding-agent`（类型擦除，不引入运行时依赖）；
- **async 工厂会在 startup 被 await**——若在工厂里做网络请求，会**阻塞 pi 启动**（延伸解释了我们「启动变慢」的一个真实机制：无扩展时只剩 pi.dev/npm 检查，有扩展工厂联网则更严重）；
- **不要在工厂**启动后台资源（进程/端口/文件监听/定时器）——官方明示，改在 `session_start` 或需要时启动，`session_shutdown` 清理；
- 测试：`pi -e ./my-extension.ts` 快速验证；自动发现位置可用 `/reload` 热重载。

### 1.4 input 事件（本次用到的核心 API）

```typescript
pi.on("input", async (event, ctx) => {
  // event.text / event.images / event.source("interactive"|"rpc"|"extension")
  // event.streamingBehavior = "steer" | "followUp" | undefined
  return { action: "continue" };                       // 放行
  return { action: "transform", text: "改写后输入" };  // 改写输入（扩展注入提醒用这个）
  return { action: "handled" };                        // 拦截，不回 LLM
});
```

---

## 2. 事故复盘（诚实归因修正）

### 2.1 时间线（事件与证据）

| 时间 | 事件 | 证据 |
|---|---|---|
| 8/23 | 修复 GitHub MCP：设置**全局**代理变量（HTTPS_PROXY=127.0.0.1:7897） | 本会话记录 |
| 8/26 16:08 | 用户新会话报 **Connection error**（deepseek API） | 会话 jsonl 硬证据 |
| 8/26 21:00 | pi 升级 0.84.2 → 0.84.3 | npm 包时间戳 |
| 8/26 23:28 | 我部署 v0.2 扩展：**顶层**放 `workflow-gate-core.ts` | 操作记录 |
| 8/27 00:49 | 用户报「进入 pi 需要加后缀 / 其他会话无法发出指令」 | 用户消息 |
| 8/27 22:56 | 重启电脑后复检：Vortex 无自启 → 7897 无监听 → 代理方案全挂 | 本次体检 |

### 2.2 结论（修正后的归因）

**「无法使用 pi」的主体元凶是全局代理环境变量，不是扩展（但扩展确实有真实违规）。**

1. **主元凶（有硬证据）**：8/23 设置的全局 `HTTPS_PROXY` 把 DeepSeek（国内 API）也劫持进代理；电脑重启后 Vortex 不自启 → 7897 无监听 → pi 所有模型请求 ECONNREFUSED → **Connection error / 无法发出指令**。规律「重启后出现、手动救活后恢复」完全吻合；
2. **次因（真实违规）**：v0.2 将 `workflow-gate-core.ts` 放在 `extensions/` **顶层**——违反官方 1.1 红线，pi 会把它当独立扩展加载（无 default export → 加载报错，污染扩展加载流程，可能影响启动）；v0.3 改为官方子目录模式（结构合规）但**综合稳定性不足**，最终 v0.3.1 回滚停用扩展；
3. **两者同期交织**（扩展部署与代理设置发生在同一 48h），导致当时把「无法使用 pi」全部归因到扩展——**该归因是错的**；扩展只是「加载报错」级别问题，而代理是「全功能不可用」级别。

### 2.3 已验证的正确姿势（现状）

- ✅ **无扩展路线**：宪章（AGENTS.md）+ MCP Server，零扩展加载风险；
- ✅ **定点代理**：`HTTPS_PROXY` + `NO_PROXY`（模型域直连）——pi 不依赖代理，github MCP 走代理；
- ✅ **Vortex 带参自启**：VBS 已补齐 `-d -f -ext-ctl` 参数（service.xml 标准）→ 7897 开机即就绪；
- ✅ **github MCP `lazy`**：启动零等待，首次调用才连接。

---

## 3. 若未来恢复扩展（官方合规模板）

```text
~/.pi/agent/extensions/workflow-gate/
├── index.ts    # export default function(pi){...}，仅注册事件/命令
└── core.ts     # 纯逻辑辅助模块（无 default export，不参与事件）
```

并遵守：工厂内不联网、不启动后台资源；async 工厂会阻塞启动（避免）；提醒注入用 `input` 事件 `{action:"transform"}`；如需 npm 依赖用 package 结构。

> 教训沉淀：任何 pi 扩展改动前先核对官网 1.1-1.4 清单；「无法使用」类问题先查网络/代理/环境变量（会话 jsonl 里的 errorMessage 是最快证据），再查代码。
