# 2026-07-30 团队唤醒 38 秒冷启动定位与修复（node runtime 探测缓存 + MCP 启动超时）

> 起因：用户从上游同步了团队作战功能后反馈"拉起团队时不知道是不是冷启动，需要花很长时间"。
> 结论先说：**慢的不是团队功能**。团队自己的骨架 2 毫秒就起好了，38 秒全部花在 leader 成员的 agent 运行时上。

**提交**：aionrs `02f3c50`（master）/ 1oneCore `ad407cdb` + `a229a3eb`（CLAUDE.md 索引）+ `1133f33c`（Cargo.lock 对齐 aionrs），**均已推 `origin/one-main`**。
**状态**：单测绿、`fmt`/`clippy` 干净、真机 CDP 冒烟过、已推送；**未打包**。

> 这一天有三条并行会话，本文只覆盖第三条。三份文档的分工、交叉事实的核对结果、以及当前三仓的真实状态，见 **§十一**。

---

## 〇 先读这一节

### 一句话

38.3 秒 → 15.5 秒。省下的 23 秒里，6.6 秒来自「每个会话都重复探测 node 运行时」，15 秒来自「一个起不来的 MCP 吃满 30 秒超时」。**但真正的底层根因是这台机器上启动一个 node 进程要 1~1.7 秒（正常几十毫秒），代码层面只能缓解不能根治**，见 §4。

### 状态表

| 项目                        | 状态                                            |
| --------------------------- | ----------------------------------------------- |
| node runtime 验证缓存       | ✅ 已改 + 单测 + 真机验证（6.6s → 7ms）         |
| MCP 启动超时 30s → 15s      | ✅ 已改 + 单测 + 真机验证                       |
| 脏 MCP 数据清理             | ✅ 已清（3 处，含备份）                         |
| 提交 / 推送                 | ✅ 三仓均已推（hash 见上）                      |
| 主干 `Cargo.lock` 对齐      | ✅ `1133f33c`，否则主干拿不到 aionrs 那半边修复 |
| 打包                        | ❌ 未做                                         |
| Defender 排除（真正的治本） | ❌ 需要人来做，见下                             |
| bundled 后端版本混乱        | ⚠️ 见 §11.4，两个检出的 bundled 各缺一半修复    |

> 📋 **这一天三条并行会话的全部未决项，已合并成唯一一份清单放在 §十二**（13 项，按"必须人做／等你拍板／可以让 AI 做"分类）。只想知道"还剩什么没做"就直接翻那一节。下面三条是本轮自己的。

### 必须由人决定或亲自做的三件事

1. **给托管 node 目录加杀软排除** —— 这是本轮查到的最底层根因（§4），属于安全设置，AI 不应代改。加完之后 ACP CLI 冷启动也会一起变快：

   ```
   Add-MpPreference -ExclusionPath "$env:APPDATA\1one-Dev\1one\runtime\node\", "$env:APPDATA\1ONE Code\1one\runtime\node\"
   ```

   需要管理员权限。这台机器 `DisableRealtimeMonitoring = False`，现有排除项 5 个，不含 node 运行时目录。

2. **`stock-sdk` 的取舍** —— 超时从 30s 降到 15s 后，它在慢的时候会被直接砍掉，**那 69 个股票工具在会话里不可用**（以前等 30 秒好歹有时能等到）。三个选项：加上面的杀软排除（预期能在 15s 内起来）／在团队会话里取消勾选它（唤醒立刻降到 ~1.5 秒）／接受现状。

3. **打包前确认 bundled 后端** —— 这一天有三条会话各自重编过 `aioncore.exe`，两个检出的 bundled 各缺一半修复，**直接打包会漏东西**。见 §11.4。

> 推送顺序（fork 铁律）本轮已按规矩走完：先推 aionrs（`02f3c50`）→ 主干 `cargo update -p aion-mcp` → `cargo build --locked` 验证 → 提交 `1133f33c`。**注意主检出 `1oneCore/Cargo.toml` 里那个指向 `../aionrs-local` 的 `[patch]` 是未提交的本地临时措施，不在主干上**，所以主干必须靠 `Cargo.lock` 锁定的 commit 才能拿到 aionrs 侧修复——这一步漏了的话，代码推了但修复不生效。

---

## 一 我在本轮判断错过的地方

放最前面，因为接手人最可能被这两条误导。

1. **把 `team-search` 当成了 07-30 刚落地的知识库检索 MCP** —— 错的。真正的知识库 MCP 叫 `one-team-knowledge`，它在库里活得好好的、连接正常。`team-search` 是 2026-07-09 团队 MCP 下发（M3）留下的占位条目，URL 是不存在的域名 `https://mcp.corp/sse`。我在第一轮回复里说"知识库功能实际是坏的"，是错的，已在同一会话内更正。

2. **最初判断 `stock-sdk`「起不来」** —— 不准确。它是**时好时坏**：同一天 10:47 那次 8.5 秒成功连上并拿到 69 个工具，10:42 那次卡满 30 秒。这个差异正是找到 §4 底层根因的入口，如果停在"它坏了"就会漏掉真正的原因。

---

## 二 症状与实测基线

前端只是等后端：`useTeamWarmup` 挂载即 `ipcBridge.team.ensureSession.invoke()`，全屏 overlay（"正在唤醒团队…"）挂到 promise resolve 为止。所以耗时全在后端。

后端日志同口径（`team session status broadcast` 的 `Starting` → `Ready`），基线一次真实冷启动：

| 时间戳（UTC） | 阶段                                 | 耗时       |
| ------------- | ------------------------------------ | ---------- |
| 10:42:28.763  | LoadingTeam → StartingBridge         | —          |
| 10:42:28.764  | Team MCP Server started（tcp 58860） | —          |
| 10:42:28.765  | leader attach started                | **2 ms**   |
| 10:42:28.788  | node runtime probe decided（npx）    | —          |
| 10:42:35.363  | node runtime **selected**            | **6.6 s**  |
| 10:42:36.6    | MCP 开始并发连接                     | —          |
| 10:43:06.101  | `stock-sdk` startup timed out 30s    | **30.5 s** |
| 10:43:07.043  | Ready                                | 合计 38.3s |

两点值得注意：

- **队友是懒唤醒的**（冷启动只 attach lead，其余广播 `Dormant`），所以 38 秒是"一个成员"的代价，不是三个。但**每个队友第一次被唤醒时会各付一遍**。
- 这跟团队没有本质关系。普通 aionrs 会话走同一条路径，只是没有全屏 overlay 挡着，感受被放大了。

---

## 三 三个连不上的 MCP，三个完全不同的根因

一次冷启动里 aionrs 日志报了三个失败，很容易被当成同一类问题，其实互不相干：

### 3.1 `team-search` —— 假域名的残留数据

```
transport_config = {"url":"https://mcp.corp/sse"}
description      = "Team-distributed MCP connector"
created_at       = 2026-07-09      enabled = 1
```

`mcp.corp` DNS 直接 `getaddrinfo failed`。07-09 团队 MCP 下发功能留下的占位条目，一直挂着 `enabled=1`。失败很快（30ms），不占时间，但每个会话都白试一次。

### 3.2 `one-web-tools` —— 绕过应用管理的"影子配置"

它**不在后端注入的列表里**（`mcp_names=["stock-sdk","team-search","ftshare","aionui-team"]`），来源是 aionrs 自己的全局配置：

```toml
# %APPDATA%\aionrs\config.toml（2026-07-12 写入）
[mcp.servers.one-web-tools]
command = "node"
args = ["D:\\1one-command\\out\\main\\builtin-mcp-web-tools.js"]
```

`D:\1one-command` 整个目录已被用户删除（旧仓库路径）。node 找不到脚本立即退出 → `Child process stdout closed`。

⚠️ **这条的教训比它本身重要**：数据库里那条 `one-web-tools` 是 `enabled=0` 的，但禁用完全没用——aionrs 会读自己的 `config.toml`，那是应用 MCP 管理页看不见也管不着的一层。排查"某个 MCP 从哪来的"时，注入列表之外还要看这个文件。

### 3.3 `stock-sdk` —— `npx` 在会话启动的关键路径上

配置是 `npx -y stock-sdk-mcp`（07-25 用户自己加的，`builtin=0`）。

它**没坏**：10:47 那次 8.5 秒成功连上、69 个工具。对比两次的 npm 内部日志：

| 阶段                                   | 10:42（超时 30s） | 10:47（成功 8.5s）     |
| -------------------------------------- | ----------------- | ---------------------- |
| 加载 4 个 npmrc                        | ✅                | ✅                     |
| 清理日志文件                           | ❌ 没走到         | ✅                     |
| `GET registry.npmjs.org/stock-sdk-mcp` | ❌ 请求根本没发出 | ✅ 781ms（cache 命中） |

实测 registry 延迟 0.74 / 0.80 / 1.25 秒，网络是通的。所以慢的不是网络，是 npm 自身的启动链路——这条线索直接指向 §4。

---

## 四 最底层根因：这台机器上启动一个 node 进程要 1~1.7 秒

```
node.exe --version：1148ms / 1005ms / 1478ms
npx-cli.js --version：1738ms / 1442ms
```

正常应当是几十毫秒。`DisableRealtimeMonitoring = False`，那个 `node.exe` 是 89.8 MB —— 每次进程创建都被实时防护完整扫一遍。

于是：

- **`npx -y <pkg>` 不是一个进程**，是一串：npx-cli → npm 解析 → 联网 revalidate → 再 spawn 真正的 MCP server。**每一层都挨一次扫描**，叠成 8.5 秒（顺利）到 >30 秒（不顺）。扫描结果有缓存，这解释了它为什么时好时坏。
- **旧代码里那 6.6 秒的 node runtime 探测**，本质是 `node --version` + `npm --version` + `npx --version` 三个子进程 × 每个 1~2 秒。
- **同一根因的独立实例**：`chrome-devtools`（同样 `npx -y ...@latest`，`enabled=0`）在 app 启动时的连接测试上 **47.6 秒超时返回 504**，这是本轮日志里唯一的 ERROR。

**代码层面只能缓解**（少跑几次 node），根治在杀软排除，见 §0 第 1 条。

---

## 五 两处代码改动

### 5.1 `1oneCore/crates/aionui-runtime/src/node_runtime/{mod,managed}.rs`

**问题**：`MANAGED_RUNTIME_CACHE` 缓存了 runtime 对象，但 `cached_managed_runtime()` 每次命中都要重跑 `validate_managed_runtime()` → `validate_runtime()` → spawn `node`/`npm`/`npx` 三个 `--version`。缓存了路径，没缓存**验证结果**。每个 agent 冷启动都付一次。

**改法**：缓存条目加 `validated_at: Instant`，TTL 5 分钟。

- TTL 内：只走新增的 `revalidate_managed_runtime_files()`，它复用生产的 `runtime_from_root()` 做纯文件系统校验（root 是目录、node 可执行文件存在、npm/npx 入口可解析），version 沿用上次完整验证证明过的值。
- TTL 外 / 文件系统校验失败：走原来的完整验证；失败则清空缓存（与改动前一致）。

**刻意的取舍**：

- 轻量路径**不刷新 `validated_at`**，否则频繁使用会让完整探测永远不再跑。有断言锁死。
- 轻量路径**不发 `Validating` 进度事件**（它确实没在验证）。核实过 `NodeRuntimeProgressPhase::Validating` 只映射成 UI 进度展示，不是状态机必经步骤，没有逻辑依赖。
- 抓不到的情况：文件都在但二进制损坏。这种最多延后一个 TTL 发现，且真正 spawn 时也会报错。

**测试**：完整 crate 口径 **85 passed / 8 failed → 87 passed / 6 failed**（在干净的 `origin/one-main` worktree 上跑的基线，非本地分叉分支）。新增 `fresh_cache_reuses_validation_instead_of_probing_versions`，证明方式是**把 node/npm/npx 三个可执行文件截断成空**——走轻量路径仍通过，走完整路径必失败。

> ⚠️ **统计口径的坑**：我一开始跑的是 `cargo test -p aionui-runtime node_runtime`（带模块过滤），得到"基线 5 红 → 现 3 红"，据此在早期结论里报过"3 条既有红"。跑完整 crate 才看到真实数字是 8 → 6（`node_runtime` 之外还有 `shell_env` 1 条、`spawn` 2 条）。**报既有失败数必须跑完整 crate，不能带过滤**。另一条并行会话报的"`aionui-runtime` 8 条红"是对的，我的 3 条是口径问题。

⚠️ 顺带修好的既有问题：测试夹具 `fake_managed_runtime` 写死 Unix 目录布局（`bin/node`），而 Windows 的 managed 布局是 `root/node.exe` + `node_modules/npm/bin/*-cli.js`，导致这几个测试**在 Windows 上一直是红的**。已改为按平台生成布局、并复用 `revalidate_managed_runtime_files()` 解析，夹具不会再与生产路径逻辑漂移。`cached_managed_runtime_emits_ready_after_validation` 加了 `#[cfg(unix)]`（走完整路径要真的执行 `node --version`，Windows 上没有等价的廉价假 `node.exe`）。

> 基线用 `git worktree` 跑 HEAD 确认过：这 5 个失败在改动前就存在。**不要用 `git stash` 验基线**（这条已在 memory 里摔过三次）。

### 5.2 `aionrs/crates/aion-mcp/src/manager.rs`

`DEFAULT_STARTUP_TIMEOUT_MS` **30_000 → 15_000**。

`connect_all` 用 `FuturesUnordered` 并发连接，但 `while let Some(...) = pending.next().await` 要把**全部**排干才返回，且 agent 在此之前无法注册工具、无法构建系统提示。所以这个常量在实践中就是"用户等多久会话才可用"的上界。

选 15s 的依据：要高于一次现实的冷启动（实测 npx 首跑 8.5s），又要远低于读起来像卡死的程度。per-server `startup_timeout_ms` 逃生阀保持不变。

**测试**：新增 `default_startup_timeout_bounds_a_server_that_never_answers`，用 `#[tokio::test(start_paused = true)]` 的虚拟时钟精确断言在默认 deadline 放弃，外加一条 `<= 20_000` 的上界断言防止将来无意改回。aion-mcp 58 passed。

⚠️ 已知代价：注入路径（`factory/aionrs.rs`、`factory/acp.rs`）构造 `McpServerConfig` 时 `startup_timeout_ms` 一律写 `None`，**应用内配置的 MCP 用户无法单独调这个值**（改动前也一样）。走 aionrs `config.toml` 的用户可以自己设。

---

## 六 刻意没做的三个改动

写下来是为了避免接手人重新评估一遍。

1. **把 MCP 连接移出会话启动的关键路径**（后台补齐工具表）—— 这是最彻底的解法，但 `connect_mcp()` 的结果直接喂给 `register_mcp_tools()` 和 `load_skills()`，工具注册表和系统提示都依赖它。改成异步意味着首轮对话可能没有 MCP 工具，且 `ToolRegistry` 要变成可变共享结构、engine 每轮重新取。**会动 engine 核心数据流，风险远超本轮收益。**

2. **`list_by_ids_any` 加 `deleted_at IS NULL`** —— 它不过滤软删除行，所以从 UI 删掉的 MCP，只要某个会话的 `mcp_server_ids` 还记着 id 就照样注入。看起来像 bug，但**有测试 `list_by_ids_any_includes_soft_deleted_rows` 明确锁死这个语义**，是刻意设计。没动。⚠️ 但这直接决定了 §7 的清理方式必须是硬删。

3. **改 `stock-sdk` 的默认种子配置**（`runBackendMigrations.ts:232` 的 `npx -y stock-sdk-mcp`）—— 默认种子是幂等的，只对新装/迁移生效，**对已有该记录的用户完全无效**。而这台机器上那条记录是用户 07-25 自己加的。真要改得配一次迁移更新已有行，且预装包会牵动打包链路。

---

## 七 脏数据清理（已做，有备份）

| 对象                               | 处理                                                            | 备份                                |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| `%APPDATA%\aionrs\config.toml`     | 整个文件只有 `one-web-tools` 一段，重命名为 `.disabled`         | scratchpad `aionrs-config.toml.bak` |
| `mcp_servers` 表的 `team-search`   | **硬删**                                                        | scratchpad `aionui-backend.db.bak`  |
| `mcp_servers` 表的 `one-web-tools` | **硬删**                                                        | 同上                                |
| 4 个会话的 `extra`                 | 剥掉 `mcp_server_ids` / `mcp_servers` / `mcp_statuses` 里的引用 | 同上                                |

**为什么硬删而不是软删**：见 §6.2——软删对已在 `mcp_server_ids` 里记着 id 的会话无效，会继续注入。

清理后库里剩：`aionui-image-generation`(0) / `chrome-devtools`(0) / `codegraph`(0) / `ftshare`(1) / `one-export-pdf`(1) / `one-team-knowledge`(1) / `stock-sdk`(1)。

---

## 八 验证

改的是 Rust，**必须 `backend-rebuild.ps1` 重编并内嵌 bundled 才生效**。

dev 环境从 **1oneUI-sync** 启动（该检出 git 干净，且正是产生 38.3 秒基线的同一环境；1oneUI 主检出当时有另一会话的 60 个未提交文件，没碰）。

### 8.1 后端日志同口径对比

| 阶段              | 基线   | 改动后      |
| ----------------- | ------ | ----------- |
| node runtime 探测 | 6.6 s  | **0.007 s** |
| 等 MCP 连接排干   | 30.5 s | 15.4 s      |
| 其余              | 1.2 s  | 0.1 s       |
| **合计**          | 38.3 s | **15.5 s**  |

app 启动后的**首次**探测仍是 16 秒（冷的，要跑完整 `--version`），之后每个会话 7 毫秒——改动前是每个会话都付 6.6 秒。

### 8.2 CDP 冒烟

CDP 端口 9230，用原始 WebSocket 直连渲染进程（chrome-devtools MCP 连的是独立浏览器，看不到 Electron 窗口）。

| 场景                           | 结果                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| aionrs 团队冷启动              | overlay 15.5s 清除；`ftshare`(172 工具)、`aionui-team`(10 工具) 正常连上；`stock-sdk` 被 15s 截断 |
| 同团队热路径（session 已建立） | **1.1 s**                                                                                         |
| ACP（Claude Code）团队冷启动   | 45.4s，但 44.8s 全在 CLI 子进程握手内部，**日志中无 node runtime 重复探测** → ACP 路径无回归      |
| 打开一个 ACP 会话              | 正常打开（后端 409 是 `TeamRuntimeRequired`，团队成员会话不允许独立 ensure，设计如此）            |
| 全程 ERROR/WARN 扫描           | 唯一 ERROR 是 `chrome-devtools` 连接测试 504（§4，既有）                                          |

⚠️ CDP 脚本踩的坑：`websocket-client` 默认带 Origin 头，Chrome 会 **403 Forbidden**，要 `create_connection(..., suppress_origin=True)`。

---

## 九 遗留与未处理（本轮全部发现的汇总）

### 9.1 本轮改动引入的取舍（有意为之，但需要有人拍板）

| 项                                     | 说明                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `stock-sdk` 在慢的时候会被砍掉         | 超时 30s→15s 的直接代价，69 个股票工具会不可用。三个出路见 §0 第 2 条。**这是本轮唯一的功能性回退。** |
| 应用内 MCP 无法调 `startup_timeout_ms` | 注入路径一律写 `None`（改动前也是）。降低默认值后，若真有 MCP 合法需要更久，用户在 UI 上没有逃生阀。  |
| 首次 node runtime 探测仍是 16 秒       | app 启动后第一次必须跑完整 `--version`。只有 §0 第 1 条的杀软排除能压掉它，代码层缓存管不了首次。     |

### 9.2 发现的既有缺陷（非本轮引入，均未修）

1. **从 UI 删掉的 MCP 会继续被注入** —— `list_by_ids_any` 不过滤 `deleted_at`（§6.2），会话只要还在 `mcp_server_ids` 里记着 id 就照旧连它。用户视角就是"我明明删了它还在拖慢会话"。有测试锁死当前语义，要改得先决定语义该不该变。**本轮正是因为这条才必须硬删数据。**

2. **`aionui-runtime` 在 Windows 上还有 6 条红** —— 本轮只修了 `node_runtime::tests` 里的 2 条（顺带，因为它们挡住了我自己的验证），剩下 6 条同类根因（夹具/断言按 Unix 假设写）没动：
   - `node_runtime::managed::tests::managed_runtime_injects_npm_state_under_runtime_root`
   - `node_runtime::managed::tests::managed_runtime_validation_uses_real_commands`
   - `node_runtime::system::tests::mixed_roots_are_rejected`
   - `shell_env::tests::platform_extra_bins_at_filters_nonexistent`
   - `spawn::tests::display_renders_shell_style_command`
   - `spawn::tests::resolved_command_builder_applies_prefix_and_env`

   已在干净的 `origin/one-main` worktree 上跑基线确认这 6 条改动前就红（**85 passed / 8 failed → 87 passed / 6 failed**）。**`cargo test -p aionui-runtime` 在 Windows 上不是全绿基线**，接手人别把它当成自己引入的。另一条并行会话另报 `aionui-team` 3 条红（同类定性），我未独立复核。

3. **aionrs 的"影子 MCP 配置"没有任何 UI 可见性** —— `%APPDATA%\aionrs\config.toml` 里的 server 会被注入，但应用的 MCP 管理页既看不到也管不了（§3.2）。这次是死路径所以只是噪音，但同样的机制可以让一个用户完全不知情的 MCP 进入每个会话。

4. **`npx -y` 型内置 MCP 默认种子** —— `stock-sdk`、`chrome-devtools` 都是这个模式，在本机环境下（§4）注定慢且不稳。改默认种子对存量用户无效（§6.3），要根治得配迁移或改预装策略。

### 9.3 观察到但没查的现象

1. **ACP session resume 白等 26.6 秒** —— ACP 团队那 45 秒里，第一次 `session/new` 等了 26.6 秒后被 CLI 以 `stale session id rejected by CLI` 拒绝，重建只花 7.6 秒。纯浪费 26.6 秒，且它现在是 ACP 团队冷启动的最大单项。与本轮无关，未查。
2. **团队 MCP 每次建连刷一条 `Read error: frame too large (>10MB)`** —— 形态是「TCP 端口收到一帧解析失败 → 紧接着 HTTP 端口连接成功」，功能正常，属既有噪音。
3. **`chrome-devtools` 连接测试 47.6 秒 504** —— §4 同根因，本轮日志里唯一的 ERROR。

---

## 十 环境与工具踩坑

- **验基线用 `git worktree add <path> HEAD` + `CARGO_TARGET_DIR` 共享 target**，几十秒出结果。**禁止 `git stash`**。
- **同一天有两个 1oneUI 检出在用**：`1oneUI`（主检出，另一会话在改，当时 60 个未提交文件）和 `1oneUI-sync`（干净）。判断"用户当时跑的是哪个"的依据是团队会话 `extra.team_mcp_stdio_config.binary_path` 里记的 aioncore 绝对路径。
- **`backend-rebuild.ps1` 写死内嵌到 `1oneUI`**。要给别的检出内嵌，在该检出下 `$env:AIONUI_BACKEND_LOCAL_PATH=<exe>; node scripts/prepareAioncore.js`。
- `cargo fmt --all -- --check` 会报到工作区里别人未提交的文件（本轮遇到 `one-employee/src/migrate.rs`）。要判断自己改的文件是否干净，用 `rustfmt --edition 2024 --check <file>` 单独跑。

---

## 十一 三条并行会话的交汇（本节是给接手人的，不只是本轮）

2026-07-30 有三条会话同时在这三个仓库上工作。本节记录**我独立核实过的**交汇点，未核实的一律标注。

### 11.1 三份文档的分工

| 会话 | 主题                                                     | 文档                                                                                                                             |
| ---- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A    | 企业版商业化 5 项待办 + 知识库混合检索 + 打包阻塞修复    | [`session-2026-07-30-enterprise-backlog-and-hybrid-rag.zh-CN.md`](session-2026-07-30-enterprise-backlog-and-hybrid-rag.zh-CN.md) |
| B    | 三仓上游同步收尾 + `aionui-extension` 12 条 + WebUI 反代 | 见 1oneCore CLAUDE.md 中 `4821b65d` / `f70abde2` 条目                                                                            |
| C    | **本文** —— 团队唤醒冷启动                               | 本文件                                                                                                                           |

### 11.2 交叉事实核对（三条，全部已消解）

| 说法                                                                              | 核实结果                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 会话 B：「aionrs 那 2 个未提交文件不是我的，是别的会话在改 MCP 启动超时」         | **是本轮（C）的**。已提交推送 `02f3c50`，aionrs 工作区现已干净。                                                                     |
| 会话 B：「`aionui-runtime` 红 8 条」 vs 本文早期的「3 条」                        | **B 是对的**。我最初带了 `node_runtime` 模块过滤所以口径偏小。完整 crate 基线确实 8 条，本轮修好 2 条剩 6 条。详见 §5.1 的口径提醒。 |
| 会话 B：「主检出 1oneUI 的 bundled 后端是旧的（Jul 30 22:26），不含扩展钩子修复」 | **那份正是本轮（C）编的**。它含 C 的 node runtime 修复，但因为编译时基于 `sync-v0153` 工作区，**不含 B 的 `f70abde2`**。见 §11.4。   |

### 11.3 ⚠️ 两个 sync worktree 挂在**同一个分支**上，别搞混也别在错的那个提交

实测（`git worktree list` + 读各自的 `.git` 指针文件）：

| 路径                                 | 位置       | 分支         | 未提交 | 说明                              |
| ------------------------------------ | ---------- | ------------ | ------ | --------------------------------- |
| `D:\aionui-m0\1oneUI-sync`           | 仓库**外** | `sync-v2142` | 0      | 本轮（C）用它跑 dev、做基线与验证 |
| `D:\aionui-m0\1oneUI\.sync-worktree` | 仓库**内** | `sync-v2142` | **87** | 会话 B 查到的雷，B 停手没动       |

**两者都是 `1oneUI` 的 worktree**（`.git` 是指针文件而非目录，共享同一个 `.git`），**而且挂在同一个分支 `sync-v2142` 上**——在任一边提交都会推进同一个分支指针，另一边随即显示脏或落后。我最初以为 `1oneUI-sync` 是独立 clone，读了 `.git` 才确认不是。

会话 B 对仓库内那个的判断与我看到的一致：里面有真实的盘上编辑、与主检出那批未提交改动逐字节相同，**谁在那儿提交一次就会把那批改动提交到 `sync-v2142` 上**。87 这个数字里大部分是"分支已推进而目录停留在旧状态"造成的假象，B 也是这么说的。

⚠️ 仓库内 worktree 另有一个已知副作用（会话 B 记录）：`.git` 是文件时 Vite 的工作区根探测会窜到父仓库，导致 **180 个 dom 套件假失败**。**worktree 必须建在仓库外**——本轮所有 worktree 都建在 scratchpad 下，用完即删。

### 11.4 ⚠️ bundled 后端现在有三个版本，打包前必须确认

| 位置                                           | 时间         | 含 C 的 runtime 修复 | 含 B 的扩展钩子修复 |
| ---------------------------------------------- | ------------ | -------------------- | ------------------- |
| `1oneUI/resources/bundled-aioncore/`（主检出） | Jul 30 22:26 | ✅                   | ❌                  |
| `1oneUI-sync/resources/bundled-aioncore/`      | Jul 30 22:26 | ✅                   | ❌                  |
| B 自己检出里的那份                             | 更晚         | ❌                   | ✅                  |

**现在没有任何一份 bundled 同时含两边的修复。** 三个提交（`ad407cdb` / `1133f33c` / B 的 `f70abde2`）都已在 `origin/one-main`，所以**从对齐后的主干重编一次即可得到完整的**：

```
git -C 1oneCore checkout one-main && git -C 1oneCore pull
D:\aionui-m0\scripts\backend-rebuild.ps1
```

⚠️ 但主检出 `1oneCore` 当前在 `sync-v0153` 且 ahead 8 / behind 2、暂存区里躺着另一批改动（会话 A 在 CLAUDE.md 里警告过：直接 `git commit` 会把 `aionui-assistant/src/routes.rs` 回退），**切分支前先处理那个暂存区**。本轮为了绕开它，全程用 `git worktree` 在 `origin/one-main` 上提交，没碰主检出任何一个文件。

### 11.5 会话 B 移交的 5 件待办（原样转录，逐条标注核实状态）

会话 B 结束时明确列了 5 件没做完、其中 4 件"不该我做主"的事。**这些不是本轮的产出，但它是同一天留下的未决项，接手人必须一起看，所以在此转录**：

| #   | 事项                                                                                                                                                                                                                                                                                                        | 我的核实状态                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **11 条后端测试仍红（等决定）** —— `aionui-runtime` 8 条 + `aionui-team` 3 条，全部是上游按 Unix 写的既有测试（断言 `Command` 的 Unix 专有 Debug 渲染、硬编码 `~/.nvm` 布局、`/conversations/acp-temp-` 正斜杠）。B 逐条定性：**无一是产品缺陷，无一由 B 引入**。                                           | `aionui-runtime` 那 8 条**我独立核实过**（干净 `origin/one-main` worktree 上 85 passed / 8 failed），本轮修好 2 条剩 6 条，清单见 §9.2。`aionui-team` 那 3 条**我未复核**。 |
| 2   | **主检出 `D:/aionui-m0/1oneUI` 是隐患** —— 落后远端 73+ 提交、60 个未提交文件，其中 **21 个**与远端新提交重叠会撞：`enterprise/index.tsx`、`ipcBridge.ts`、`i18n-keys.d.ts`、13 个 locale 的 `common.json`。                                                                                                | 未独立核实条数。**本轮全程走仓库外 worktree，没有加剧这个状态**，也没有动主检出任何文件。                                                                                   |
| 3   | **`1oneUI/.sync-worktree` 是真正的雷** —— B 本想删（是 B 早期弃用的仓库内 worktree，导致过 180 个 dom 套件假失败），但发现里面有 10 个文件的真实盘上编辑、与主检出那批未提交改动逐字节相同，而 HEAD 挂在 **B 的同步分支**上。**谁在那儿提交一次，就会把那批改动提交到 B 的分支上。** B 没动，留给你们定夺。 | 我确认了该目录存在，**没有进入、没有动**。⚠️ 注意别和本轮用的 `1oneUI-sync` 搞混，见 §11.3。                                                                                |
| 4   | **主检出的 bundled 后端是旧的**（Jul 30 22:26，早于 B 的修复）—— 从那里跑 dev 或打包，拿到的后端不含扩展钩子修复。                                                                                                                                                                                          | **这条我能补充关键信息**：那份正是本轮编的，含本轮修复但不含 B 的 `f70abde2`。完整状态与重编方法见 §11.4。                                                                  |
| 5   | **`WorkspaceIdentityEntry` 测试可能撞车** —— B 说 `490f784e8` 让主干变红（重构了组件没改测试），B 按新语义修好推了；如果另一会话此刻也在改同一文件，会有一处小冲突。                                                                                                                                        | **未核实**（本轮没碰前端测试）。B 同时提到远端当时又推到 `3af83d2d6`、对方仍在持续推——本轮推送时基线已是 `3af83d2d6`，之上叠加 `b8ce2c076`。                                |

除第 4 条本轮补齐了信息外，**其余 4 条本轮都没有处理，状态与 B 移交时一致**。

---

## 十二 2026-07-30 全部未决项归一清单（三条会话合并）

> 这一天三条会话各自留了未决项，分散在三份文档里。**本节是唯一的合并清单**，接手人只看这一节就能知道还有什么没做。
> 来源标注：**A** = 企业版商业化会话，**B** = 上游同步收尾会话，**C** = 本轮（团队唤醒）。

### 12.1 必须由人来做（AI 不应代做）

| #   | 事项                                                                                                                                                               | 来源 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 1   | **给托管 node 目录加杀软排除** —— 属安全设置。命令见 §0 第 1 条。加完之后 `npx` 型 MCP 与 ACP CLI 冷启动会一起变快，是本轮性能问题的真正治本。                     | C    |
| 2   | **License 公私钥轮换** —— 私钥不能进任何 AI 会话，只能离线跑 `cargo run -p one-billing --example license_tool -- keygen`。上线前必须换，因为现私钥在会话里打印过。 | A    |
| 3   | **打包前先 bump `package.json`** —— 现在仍是 `2.1.50`，而 `out/One-Work-2.1.50-win-x64.exe` 已存在，不 bump 会直接覆盖它。                                         | A    |

### 12.2 等你拍板（做与不做都合理）

| #   | 事项                                                                                                                                                                              | 来源 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 4   | **`stock-sdk` 的取舍** —— 超时降到 15s 后它慢时会被砍掉，69 个股票工具不可用。三个出路：加杀软排除（预期能在 15s 内起来）／会话里取消勾选（唤醒立刻降到 ~1.5s）／接受现状。       | C    |
| 5   | **11 条后端既有红测试要不要收拾** —— `aionui-runtime` 8 条（C 已修好 2 条，剩 6 条）+ `aionui-team` 3 条（C 未复核）。均为上游按 Unix 写的测试，B 与 C 一致定性为**非产品缺陷**。 | B+C  |
| 6   | **ACP `session/new` 白等 26.6 秒要不要单独查** —— 第一次被 CLI 以 `stale session id` 拒绝，重建只花 7.6 秒。它现在是 ACP 团队冷启动的最大单项。                                   | C    |
| 7   | **`list_by_ids_any` 的软删除语义要不要改** —— 从 UI 删掉的 MCP 只要会话还记着 id 就照旧注入。有测试明确锁死当前语义，改之前要先决定语义对不对。                                   | C    |

### 12.3 有人得动手（AI 可做，但需要你说一声）

| #   | 事项                                                                                                                                                                                                            | 来源  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 8   | **重编一份完整的 bundled 后端** —— 现在三份 bundled **没有任何一份同时含两边修复**。三个提交都已在主干，从对齐后的主干重编一次即可。方法见 §11.4。                                                              | B+C   |
| 9   | **主检出 `D:/aionui-m0/1oneUI` 对齐** —— 落后 73+ 提交、60 个未提交文件、21 个与远端重叠会撞。**这是当前最大的一处隐患**，越晚处理撞得越狠。                                                                    | B     |
| 10  | **`pages/enterprise/index.tsx` 的合并** —— A 做了信息架构重构（13 页签→6），另一会话对同一文件有未提交改动。**合并必须以 A 的分组结构为基线再叠加对方改动**，不能整文件择一，否则要么丢页签收敛要么丢对方功能。 | A     |
| 11  | **`1oneUI/.sync-worktree` 的处置** —— 仓库内 worktree，与 `1oneUI-sync` 挂同一分支，里面有真实盘上编辑。B 停手没动。见 §11.3。                                                                                  | B     |
| 12  | **`WorkspaceIdentityEntry` 测试可能撞车** —— B 已按新语义修好推送；若另一会话此刻也在改同一文件会有一处小冲突。C 未复核。                                                                                       | B     |
| 13  | **打包本身** —— 三条会话都没打包。注意先做第 3 项（bump）和第 8 项（重编 bundled）。                                                                                                                            | A+B+C |

### 12.4 已在本轮消解、不必再跟的

- ~~aionrs 两个"无主"未提交文件~~ —— 是 C 的，已推 `02f3c50`，工作区干净。
- ~~主干 `Cargo.lock` 拿不到 aionrs 修复~~ —— 已 `cargo update -p aion-mcp` + `--locked` 构建验证，提交 `1133f33c`。
- ~~`aionui-runtime` 红几条的口径分歧~~ —— 完整 crate 8 条为准，C 已核实并修好 2 条。
- ~~脏 MCP 数据（`team-search` / `one-web-tools`）~~ —— 已清，备份在 scratchpad。
