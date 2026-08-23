# 2026-07-27 MCP 管理越界写用户真实 Claude 配置修复 + 一键导入解析 BUG 修复

用户自己在 app 里用 Agent 写了两个 MCP（ftshare / stock-sdk）装上后，MCP 管理界面看不到、后来手工把配置写进 `~/.claude.json` 后每条消息都 400 崩溃。追下去发现是两条独立缺陷链：**MCP 配置管理越界写用户真实 Claude Code 配置**（1oneCore + 1oneUI）、**一键导入把 Windows 命令解析坏了 + 无法单独勾选**（1oneCore + 1oneUI）。分两批提交：

- 1oneCore `835af6da` / 1oneUI `1631471dd` — 配置隔离 + 工具 schema 校验闸门
- 1oneCore（本节新增）/ 1oneUI（本节新增）— 一键导入解析修复 + 单独勾选

## 1. MCP 配置隔离：读写刻意不对称

**现象**：Agent 会话里跑 `claude mcp add` 装的 MCP，MCP 管理界面看不到；手工把非法 schema 的工具（`ft_goodwill_market_overview` 用 `（无业务参数）` 当占位参数名）写进 `~/.claude.json` 后，Claude Code 每条消息都返回
`400 tools.214.custom.input_schema.properties: Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'`。

**根因**：Claude 桥接 spawn agent 时把 `CLAUDE_CONFIG_DIR` 指向隔离目录（`<data_dir>/claude-bridge-isolated-home`），但 `ClaudeAdapter` 的 CLI 调用完全没带这个变量——`claude mcp add-json -s user` 写的是**用户自己的** `~/.claude.json`。后果不只是两边互相看不见：在 app 内装/删一个 MCP 会改动用户自己的 Claude Code 安装，一个坏 server 装进去，用户终端里的 `claude` 也会跟着挂。

**修复**（[`crates/aionui-mcp/src/adapters/claude.rs`](../../../1oneCore/crates/aionui-mcp/src/adapters/claude.rs)）：

`ClaudeAdapter` 的读写故意不对称，别在后续改动里"统一"掉：

| 操作                               | `CLAUDE_CONFIG_DIR` | 为什么                                                       |
| ---------------------------------- | ------------------- | ------------------------------------------------------------ |
| `detect_existing`                  | 用户**真实**家目录  | 它是一键导入的数据源，只读，不然导入功能会去扫自己的空注册表 |
| `install_server` / `remove_server` | 隔离目录            | 永远不碰用户真实配置                                         |

隔离目录路径抽到 [`aionui-common/src/agent_bridge.rs`](../../../1oneCore/crates/aionui-common/src/agent_bridge.rs)，agent 工厂（spawn agent）和 MCP 适配器共用一份，防止两边路径漂移。

新增 [`aionui-mcp/tests/claude_config_isolation.rs`](../../../1oneCore/crates/aionui-mcp/tests/claude_config_isolation.rs)——不是 mock，直接调本机真实 `claude` 二进制，跑完比对 `~/.claude.json` 的 sha256 逐字节未变、配置确实落进了隔离目录。这条从代码上无法推断（Claude CLI 到底认不认 `CLAUDE_CONFIG_DIR` 是 CLI 自己的行为），必须实测。

## 2. 工具 schema 校验闸门

**现象同上**。一个可达的 MCP server 仍可能宣告模型 API 会拒绝的工具定义，握手成功、`tools/list` 成功、UI 显示"已连接"，但下一条消息就 400——报错只给一个扁平工具数组里的下标，定位不到是哪个 MCP、哪个工具。

**修复**：

- [`aionui-common/src/tool_schema.rs`](../../../1oneCore/crates/aionui-common/src/tool_schema.rs) 新增，按 `^[a-zA-Z0-9_.-]{1,64}$` 递归校验 `properties`/`items`/`anyOf`/`$defs`，一次返回全部问题。
- 连接测试（[`connection_test/protocol.rs`](../../../1oneCore/crates/aionui-mcp/src/connection_test/protocol.rs)）标注不兼容工具，落到 `McpToolResponse.incompatibilities`。
- [`load_user_mcp_servers`](../../../1oneCore/crates/aionui-ai-agent/src/factory/acp.rs)（下发给会话前）跳过带非法工具的整个 server——ACP 只下发服务器配置，工具由 agent 自己连上后拉取，本应用从不经手那个工具数组，能拦的最小粒度就是整个 server。ftshare 172 个工具会因为 1 个坏工具整体损失，这是已知代价，优于让整个会话 400。
- 前端（[`useMcpConnection.ts`](../../packages/desktop/src/renderer/hooks/mcp/useMcpConnection.ts)）连接测试成功但带不兼容工具时，弹**黄色警告**而不是绿色成功，直接点名工具名+参数名，13 语言。

### 真机验证（dev，全部通过）

用 CDP 直连渲染进程勾选两个真实 MCP（ftshare 带毒 / stock-sdk 干净）发进 Claude Code 会话：

| 项                              | 结果                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| ftshare 172 工具中精确标出 1 个 | `ft_goodwill_market_overview` / key=`（无业务参数）` / reason=`illegal_characters`，其余 171 个不受影响                                          |
| stock-sdk 69 工具               | 全部干净                                                                                                                                         |
| 下发闸门日志                    | `user_mcp: server advertises tools the model API rejects; skipping` (ftshare) + `user_mcp: injected into session/new count=1` (只放行 stock-sdk) |
| 会话结果                        | Claude 正常回复，全程 **0 个 400**                                                                                                               |
| 真实 `~/.claude.json`           | 全程 sha256 不变（`0c33db3f…`），装/删操作确认落在隔离目录 `claude-bridge-isolated-home/.claude.json`                                            |

## 3. 一键导入：Windows 命令被解析坏

修完上面两条，用户顺手点了「一键导入」，发现两个新问题：**弹窗只能整批导入不能单独勾选**、**导入的三个 server 全部连不上**：`codegraph: 未找到命令 codegraph serve --mcp`、`one-image-generation: 启动 cmd /c node ... 失败`、`one-web-tools: 无法完成握手`。

### 3.1 根因：两个独立 bug，都在 `service.rs`

`ClaudeAdapter::detect_existing` 解析的是 `claude mcp list` 的**纯文本**输出，命令和参数之间没有分隔符（`codegraph: codegraph serve --mcp - ✓ Connected`），只能靠 [`normalize_transport`](../../../1oneCore/crates/aionui-mcp/src/service.rs) 里的 `SPLITTABLE_STDIO_LAUNCHERS` 白名单 + `shell_split` 去猜命令边界：

- **Bug A —— `shell_split` 把 `\` 当 POSIX 转义符**：`'\\' => { current.push(chars.next()...) }`，`D:\1one-command\out\main\x.js` 被拆成 `D:1one-commandoutmainx.js`，Windows 路径逢拆必毁。这个函数还被 [`sync_team_servers`](../../../1oneCore/crates/aionui-mcp/src/service.rs) 复用（团队分发的 stdio endpoint 解析），同样中招。
- **Bug B —— 白名单太窄**：`&["npx","pnpx","bunx","uvx","uv","node","python","python3","deno"]`，首 token 是 `codegraph`/`cmd` 不在名单里，直接不拆，整条命令行原样塞进 `command`、`args` 留空。

### 3.2 修复一：detect_existing 改为叠加 `~/.claude.json` 的结构化字段

`claude mcp list` 的文本仍然是唯一的**存在性 + 实时连通状态**来源（`Connected`/`Disconnected`/`Needs authentication`/`plugin:` 前缀），这条不能丢——所以不是整体切换数据源，而是**叠加**：按 server 名字匹配，把猜出来的 `command`/`args` 替换成 `~/.claude.json` 里的结构化字段（[`read_claude_json_mcp_servers`](../../../1oneCore/crates/aionui-mcp/src/adapters/claude.rs)）。找不到匹配、文件不存在、JSON 解析失败都静默回退到原来的文本猜测，不会更差，也不会挡住 `detect_existing` 本身。

`importable`/`import_skip_reason`（活体连通状态）完全不受影响，只有 `transport` 字段被覆盖——[`overlay_structured_transports`](../../../1oneCore/crates/aionui-mcp/src/adapters/claude.rs) 抽成纯函数单独测试，专门锁死这一点（`overlay_preserves_live_status_fields`）。

### 3.3 修复二：`shell_split` 反斜杠按平台区分

Windows 上 `\` 是路径分隔符不是转义符，不该被吃掉；Unix 上保留标准转义语义（`\` + 下一字符 → 该字符本身，用来转义空格/引号）。改成 `cfg!(windows)` 门控，两个调用方（`split_stdio_command` 手输命令场景、`sync_team_servers` 团队分发场景）一并修好。

### 3.4 修复三：一键导入弹窗加单独勾选

[`OneClickImportModal.tsx`](../../packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx) 原来没有任何 Checkbox，`handleBatchImport` 直接对 `importableFetchedServers` 全量导入，是 all-or-nothing。改动：

- 新增 `selectedNames: Set<string>` 状态，扫描完成时默认勾选**全部可导入项**（保留旧行为的默认值）。
- 每个可导入行加 Arco `Checkbox`，独立勾选/取消。
- 右上角「全选/取消全选」一键切换。
- 「将导入 N 个」标签从 `importableFetchedServers.length` 改读 `selectedNames.size`；导入按钮的 disabled 条件同步；提交时只取 `selectedNames` 里勾选的那些。
- 新增 i18n key `settings.mcpSelectAll`/`mcpDeselectAll`，13 语言。

### 3.5 真机验证（dev，全部通过）

清空 dev 库里上一轮遗留的三条坏记录后重新走一遍一键导入：

**API/DB 级**（`backend-run.ps1 --local` 直连 `/api/mcp/agent-configs`）：

| server                 | 修复前                                                               | 修复后                                                               |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `codegraph`            | `command="codegraph serve --mcp"`, `args=[]`                         | `command="codegraph"`, `args=["serve","--mcp"]`                      |
| `one-image-generation` | `command="cmd /c node D:\...\x.js"`, `args=[]`                       | `command="cmd"`, `args=["/c","node","D:\\1one-command\\...\\x.js"]`  |
| `one-web-tools`        | `command="node"`, `args=["D:1one-commandoutmainx.js"]`（反斜杠丢失） | `command="node"`, `args=["D:\\1one-command\\...\\x.js"]`（完整保留） |

**UI 级**（CDP 驱动真实弹窗交互）：

- 打开一键导入，「检测到 6 个 MCP」→「将导入 2 个」（`one-image-generation`/`one-web-tools`，其余 4 个已存在/不支持）→ 两行各带独立勾选框，默认打勾，右上角「取消全选」。
- 手动取消勾选 `one-image-generation` → 计数即时变「将导入 1 个」，按钮变回「全选」。
- 点「导入」→ DB 里只多了 `one-web-tools`（`command`/`args` 结构与上表一致），`one-image-generation` 确认没进去。
- 全程结束后 `~/.claude.json` 的 `mcpServers` 字段逐字节未变（整体文件 hash 有变化，diff 出来是 `clientDataCacheSlots`/`cachedGrowthBookFeaturesAt` 两个 Claude CLI 自己的功能开关缓存字段，与 MCP 无关，是用户自己那几小时正常用 Claude Code 产生的漂移）。

## 4. 收尾：Codex 同款隔离（1oneCore commit `5a0f8e4c`）

用户明确要求「Codex 桥接的同类隐患肯定要处理」，补上对称修复。

**先重新核实前提**：Codex 和 Claude 的病因不完全一样。Claude 是"agent spawn 用隔离目录、`ClaudeAdapter` 却写真实目录"的**配置分裂**；Codex **没有**这个分裂——它压根没有 agent-spawn 侧的隔离（Codex 的 LLM-provider 桥接走 `CODEX_CONFIG`/`MODEL_PROVIDER` 两个环境变量，跟 `~/.codex/config.toml` 的 `mcp_servers` 表毫无关系），`CodexAdapter` 一直读写同一个真实 `~/.codex/`。唯一问题就是写操作会碰用户真实配置，和 Claude 修复前那半个问题同病。

**关键判断**：`CodexAdapter::install_server`/`remove_server` 和 `ClaudeAdapter` 当年一样，**目前没有任何生产路由调用**（`grep` 全仓确认）。这意味着隔离写入路径本身不需要碰 agent spawn——不会像最初设想的那样强制用户重新登录 Codex（`auth.json` 与写入路径完全无关）。

**改动**（`aionui-mcp/src/adapters/codex.rs` + `aionui-common/src/agent_bridge.rs`）：

- 新增 `codex_mcp_isolated_home`/`CODEX_HOME_ENV_KEY` 等，命名上刻意与既有的"Codex 桥接"（LLM provider 那个）区分开，避免同名不同义。
- `CodexAdapter` 改为有状态，读写不对称，和 `ClaudeAdapter` 一个模子：`detect_existing`（一键导入数据源）读真实 `~/.codex`，`install_server`/`remove_server` 只写隔离目录。
- **真机测试当场揪出一个新问题**：`codex mcp add` 在隔离目录第一次不存在时直接硬失败——`CODEX_HOME points to ..., but that path does not exist`。Claude CLI 会自动建目录，Codex 不会。补了 `ensure_isolated_home()` 在每次写操作前显式建目录。

**验证**：`codex_config_isolation.rs`（新增，直接调真实 `codex` 二进制）确认 `codex mcp add/list/remove` 认 `CODEX_HOME`、写入 `<CODEX_HOME>/config.toml` 的 `[mcp_servers.<name>]` 表；装/删探针前后真实 `~/.codex/config.toml` 的 sha256 逐字节未变。`aionui-common`/`aionui-mcp` 单测全绿（含 22 个新的 CodexAdapter 单测）。

⚠️ **验证节奏上的一次自我纠偏**：这轮收尾一度跑了一次全量 `aionui-app` e2e（含 `assistants_e2e.rs` 52 个测试等完全不相关的子系统），機器负载高导致单条测试 60+ 秒、耗时过长——被用户当场叫停。本改动实际只是「新增一个隔离的 crate 内部逻辑 + `state.rs` 一行接线」，风险面很小，`aionui-common`/`aionui-mcp` 的针对性测试 + `aionui-app` 编译通过就足够，不需要跑全量 e2e。

## 未做 / 遗留

- 一键导入弹窗现在多语言的「不支持」文案（`test-no-shell` 这类）沿用旧的 skip-reason 分类逻辑，没有专门为"用户手动取消勾选"加一个区别于"检测到就不可导入"的第三态；目前两者共用「未导入」这一批次展示，不影响功能，纯文案精细度可以后续再抠。
- 未打包、未真正发到用户日用的正式版；`resources/首页.png` 及 7 张截图在 1oneUI 工作区未提交，不属于本轮改动，故意留给用户自己处理。
