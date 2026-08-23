# 2026-07-29 三仓上游全量同步（aionrs v0.2.8 / 1oneCore v0.1.53 / 1oneUI v2.1.43）

> 上一次同步是 2026-07-20。本轮把三仓一次性跟到上游最新，**包含团队作战那批更新**，
> 前提是「不破坏 fork 自有产品能力」。累计约 148 个上游提交。

## 0. 最终 commit 与分支

| 仓库                     | 分支         | 最终 commit | 相对 fork 主干新增 |
| ------------------------ | ------------ | ----------- | ------------------ |
| aionrs（`aionrs-local`） | `master`     | `8bb0e0b`   | 已直接落在 master  |
| 1oneCore                 | `sync-v0153` | `8ec21dc5`  | 64                 |
| 1oneUI                   | `sync-v2142` | `6302b444c` | 63                 |

版本级联：aionrs `8bb0e0b` → 1oneCore `0.1.53-one.1` → 1oneUI `aioncoreVersion: v0.1.53-one.1`。

### ⚠️ 推送前必做（顺序不能颠倒）

1. **先推 aionrs** `master`。
2. 删掉 1oneCore `Cargo.toml` 末尾的临时 `[patch."https://github.com/gaogg521/aionrs.git"]`
   段（它把 `aion-*` 指向本地 `../aionrs-local`，因为 aionrs 当时还没推）。
3. `cargo update -p aion-mcp` 让 `Cargo.lock` 指向 aionrs 真实远端 commit，重新编译确认。
4. 再推 1oneCore `one-main`，最后推 1oneUI `one-main`。

---

## 1. 本轮两个「不采纳」的架构决策

### 1.1 session-port 迁移（1oneCore #609 + 1oneUI #3572）——**明确不采纳**

上游把 Claude/Codex 从 ACP 子进程模型迁到新的 direct-CLI `SessionAgentTask` 路径。
**问题**：新路径在 `factory/acp.rs` 里直接 early-return，绕过了 fork 的
**Codex/Claude 自定义模型桥接注入**（`codex_bridge_config_repo` /
`claude_bridge_config_repo`）；上游那条路径只接了第三方 cc-switch 兜底，
没接 fork 的第一方桥接。照搬会让桥接功能静默退回 cc-switch-only。

用户拍板本轮不迁移，继续走老 ACP 路径。落地方式：

- `factory/acp.rs`：删掉 early-return 分发块，留注释说明原因。
- `factory/mod.rs`：`AgentFactoryDeps` **不加** `session_spawner` 字段。
- `services.rs` / `factory_provider_integration.rs`：移除随之无用的 spawner 装配。
- 前端 #3572 同步不采纳——前端单独走新路径会跟仍在 ACP 路径的后端对不上。

上游那批新代码（`session_agent.rs`、`aionui-session`、`aionui-process`）**照常合入
但未接线**，处于休眠状态，将来要迁移时把桥接 repo 串进 `SessionBuildInputs` 即可。

### 1.2 `acp_tool_runtime` 被静默删除——已恢复

git 自动合并把 fork 独占的 `crates/aionui-runtime/src/acp_tool_runtime/`
（claude-agent-acp / codex-acp 包装 CLI 的**按需 npm 下载**逻辑）整个换成了上游新增的
`managed_cli`（原生二进制、打包期预备，走新的 `prepare-managed-resources` 子命令），
**没有产生任何冲突标记**。而 `factory/acp.rs` 仍在调用它 → 编译直接报错才暴露出来。

这与 session-port 属同一类「改造 claude/codex 启动方式」的动作，同样不在本轮采纳范围，
因此恢复了 `acp_tool_runtime`，连带恢复它依赖的：

- `cache.rs::managed_acp_tool_root()`
- `managed_resources.rs::acp_tool_sources()`
- `runtime_status.rs` 的 `conversation_acp_tool_runtime_reporter` / `acp_tool_runtime_reporter` / `map_acp_phase` / `map_acp_failure_kind`
- `aionui-api-types` 的 `RuntimeResourceKind::AcpTool`

**未恢复**的只有 `managed_acp_tool_contract_for_export`——上游的
`cmd_prepare_managed_resources.rs` 已改成只产出新的 schema-v2 `ManagedCliResourceContract`，
旧导出函数既无调用方也无对应的 manifest schema。`managed_cli` 保留在树中未接线。

> **教训**：3-way merge 可以在**零冲突标记**的情况下删掉 fork 独占模块。
> 光看「冲突解完了」不够，必须全量编译 + 跑测试。

---

## 2. Phase 1 — aionrs（27 提交，5 个冲突文件）

冲突全部砸在 07-20/07-21 那批**截断恢复命脉补丁**同一片代码上：

- `stream_process.rs`：取上游 `emitted_done` 感知的 EOF 判定（是 fork `45cce3a` 的严格超集）。
- `stream_process_test.rs`：上游改进过的 OpenAI 测试套 + fork 独有的 Anthropic EOF 测试，两边都留。
- `engine.rs` / `turn.rs`：保留 fork 的有界续写（`recover_truncated_tool_call` /
  `continue_truncated`）；`FinalizationReason::fallback_prompt` 的 match 臂合并成
  「fork 的 host-agnostic MaxTokens 文案 + 上游新增的 ToolFailure 臂」。
- `composed_test.rs`：双方各自新增的独立测试，假冲突，全留。

验证：`cargo test --workspace` 全绿、clippy / fmt 干净。

---

## 3. Phase 2 — 1oneCore（60 提交，23 个冲突文件）

### 3.1 计划里「需人工裁决」六项的结论

| 项                                         | 结论                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| (a) session-port #609                      | **不采纳**，见 §1.1                                                        |
| (b)(c) 团队冷启动 #670 / 原生斜杠命令 #696 | 正常合入；fork 在 team 模块无基于旧批量预热机制的自有改动                  |
| (d) project-bind #672/#676                 | 与 fork 的「项目组」(`one-org`/`one_tenants`) 语义完全不同，直接吃         |
| (e) MiMo Code + ACP Registry 对齐          | 正常合入；种子行数断言 40→41、npx lock 版本表取上游                        |
| (f) per-model 能力配置                     | 用 `git log --grep` 核实过是上游真新功能、**不是** fork 重复造轮子，正常吃 |

(f) 的具体形态：`openai_api_mode` / `image_input` 从单点提升为按模型可覆盖
（`ModelCompatOverrides` + `resolve_model_compat_overrides`），
`rewrite_chat_completions_url_to_responses` 泛化成双向的 `rewrite_openai_api_url`。
顺带把 fork 独有的 `resolve_provider_config_for_bridge` 也接上了新的解析链
（它原本调用的函数被上游降级成 `#[cfg(test)]`）。

### 3.2 migration 撞号（本轮的坑）

上游新增 4 个 migration 用了 fork 已占用的编号，已重排：

| 上游编号 | 重排为  | 内容                                  |
| -------- | ------- | ------------------------------------- |
| 026      | **037** | `clear_bridge_agent_command_override` |
| 027      | **038** | `provider_model_settings`             |
| 028      | **039** | `project_bind`                        |
| 029      | **040** | `add_mimo_code_builtin_acp_agent`     |

另有一个 `025_sync_and_add_acp_registry_agents.sql` 与 fork 的 `030_*` **内容逐字节相同**，
直接删除。

⚠️ `crates/aionui-db/tests/provider_model_settings_migration.rs` 按编号回放迁移，
测试里的 25/27 已同步改成 37/38（函数名一并从 `migration_027_*` 改为 `migration_038_*`）。

### 3.3 其他值得记的冲突裁决

- `cli_probe.rs`：取上游的 `validate_with_budget`（返回分类过的 `ProbeSuccess`/`ProbeFailure`）
  替代 fork 的 `validate()`——`registry.rs` / `services/availability/mod.rs` 已经在调新签名。
- `manager/aionrs/agent_test.rs`：保 fork 的 `Some(32_000)` 断言（锁的是 `33c2bd2` 那个
  `default_max_tokens` 修复），不取上游的 `None`。
- `AGENTS.md`：`just push` 那段合成「上游的完整门禁描述 + fork 的 `just` 不可用时的回退路径」。
- `Cargo.lock`：34 个冲突块，直接删掉重新 `cargo generate-lockfile`。

### 3.4 验证

- `cargo build --workspace` 绿。
- 31 个 crate、178 个测试二进制、**5788 个用例通过**。
- clippy（本轮碰过的 16 个 crate）`-D warnings` 绿；`cargo fmt` 绿
  （顺带修了 07-28/07-29 专家市场那批从未跑过 fmt 的 3 个文件）。

失败项归类（全部已定性）：

| 失败                                       | 归因                                                            | 处理                                                   |
| ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------ |
| `provider_model_settings_migration` (1)    | 本轮重排编号导致                                                | 已修                                                   |
| `session_service_integration` provider (2) | fork `8c778df1` 的 fail-fast 校验撞上游新用例的真空 provider 仓 | 已修（补假 provider，仿 `src/test_utils.rs` 既有写法） |
| `session_service_integration` 路径 (3)     | 合并前就红，Windows 反斜杠断言                                  | 既有                                                   |
| `aionui-project` (18)                      | 上游新 crate，测试硬编码 `file:///Users/Me/...` macOS 路径      | 既有（上游问题）                                       |
| `aionui-extension`/`file`/`shell` (13)     | 本轮 **0 改动**，Windows 上跑 `.sh`（os error 193）             | 既有                                                   |
| `aionui-runtime` (8)                       | 与本轮改动文件零 diff                                           | 既有                                                   |

---

## 4. Phase 3 — 1oneUI（61 提交，47 个冲突文件）

### 4.1 助手列表重做 #3696 —— 计划点名要小心的地方

上游删掉 `MyAssistantRow.tsx`，换成卡片式 `MyAssistantCard.tsx` + 新增
`EnabledAssistantsList.tsx`。fork 在旧文件里有**两处专家市场逻辑**必须移植，
否则会静默劣化：

| fork 逻辑                                                                    | 不移植的后果                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `isMutableAssistantSource(assistant.source)` 替代 `=== 'user'`               | 从专家市场装来的助手（`source='imported'`）**变成不可删除**    |
| `resolveAssistantName(assistant, localeKey)` 替代 `name_i18n?.[k] \|\| name` | 市场人设的 `display_name`/`role_name` 失效，**显示不出中文名** |

两处均已移植进 `MyAssistantCard.tsx`，`EnabledAssistantsList.tsx` 的名字渲染也同步对齐。

### 4.2 四 tab 合成

`AssistantHomeTabs` 从「fork 的 mine/official/marketplace」+「上游的 enabled/mine/official」
合成 **enabled / mine / official / marketplace** 四态。计数改用 fork 的
`visibleAssistants`（而非上游的 `assistants`），否则 tab 角标会把「后端没装的自动生成 CLI 助手」
算进去，与实际渲染的列表对不上。

### 4.3 其他关键裁决

- `assistantSelection.ts`：保留 fork 的 `isInstalledGeneratedCliAssistant` 过滤，
  排序换成上游抽取的 `compareLegacyAssistantOrder`（同规则且多了 id 兜底）。
- `useAssistantList.ts`：排序实现整体取上游（持久化顺序数组），
  但保留 fork 的 `ASSISTANTS_LIST_SWR_KEY` 导出（`prefetchAssistantsList.ts` 在用）。
- `TeamSiderSection.tsx`：保 fork 的 `visibleTeams` 限量预览 + 外层布局，
  嫁接上游的运行中 spinner 与「运行时不显示置顶标记」。
- `AcpModelSelector.tsx`：桥接锁定态**单独成一个分支**，不复用上游的
  `renderReadonlyPill`——后者会附带 warmup 点击唤醒，而桥接锁定是硬锁。
- `SkillsHubSettings.tsx`：保 fork 版（上游挪目录 + 内联渲染函数，fork 早已拆到
  `skillsHub/` 子目录，属同一诉求的两种实现）。
- `PetSettings.tsx` / `PetSettings.dom.test.tsx`：保持删除（fork `33f8aae28`
  已移除整个桌面宠物子系统），上游 #3777 把它们带了回来。

### 4.4 i18n（40 个冲突块 / 27 个文件）

脚本化处理：**以上游那侧作结构模板**（它是超集，逗号与嵌套天然正确）、
共有 key 用 fork 的值覆盖、新 key 保留并刷品牌，**`JSON.parse` 作为校验闸门**。
脚本按设计**拒绝**任何会丢失 fork 独有 key 的合并——`es-ES/guid.json` 因此被挡下并手工处理
（上游换掉的 `defaultPrompts` 采纳，fork 独有的 `authorTip` 保留）。

### 4.5 品牌复检（铁律五类全扫）

| 类别               | 结果                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| i18n locales       | 刷 52 处（上游新增的启动提示 / cron 默认提示）                                  |
| 渲染层用户可见文案 | 3 处：`ButlerDiagnoseButton` 诊断提示 + 上游新桌面通知 #3715 的**两个通知标题** |
| 安装器脚本         | 命中全是内部 NSIS 变量（`$AionUiSessionId` 等），**按边界规则保留**             |
| 测试断言           | 仅 `tests/e2e/docs/*.md` 文档，非断言                                           |
| 外链               | 均为注释 / GitHub 模板，合并前既有状态                                          |

**刻意不改**：`BACKGROUND_BLOCK_START/END`（`/* AionUi Theme Background Start */`）——
这是写进**用户已保存主题 CSS** 里的分隔标记，改名会让存量自定义背景失效。

### 4.6 顺带揪出的「上游改了、fork 没跟上」

1. **`SessionCenter`（fork 自有页面）漏传上游新增的必填 `onCreateCronTask`** → tsc 报错。
   已按 `GroupedHistory` 的写法接上同一个 handler（解构 / 传参 / deps 三处）。
2. **反馈模块映射缺 fork 全部 6 个自有顶层路由**——上游新增的
   「每个可导航路由都必须能解析出反馈模块」这条测试一次性把它们全暴露了：
   `/super-assistant`→`other`、`/enterprise/*`→`system-settings`、
   `/skills`→`skills-plugin`、`/mcp`→`mcp-tools`、`/sessions`→`search-history`、
   `/memory`→`conversation-session`。此前用户在这些页面点「报告问题」预选不到模块。
3. 上游新测试的 mock 不认识 fork 自有部分（见下）。

### 4.7 测试夹具对齐

| 缺口                                                   | 补法                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `ipcBridgeShowOpen`（上游新增）的 httpBridge mock      | 补 fork 07-20 加的 `httpGetLocal`/`httpPostLocal`/`httpPutLocal`/`httpDeleteLocal`/`getLocalBaseUrl` |
| `useTeamRunView` 的 `ipcBridge.team` mock              | 补上游本轮新增的 `slotWorkChanged` 事件                                                              |
| `SettingsSider` / `TeamSiderSection` 的 icon-park mock | 补 fork 用的 `BuildingOne` / `FullScreen`                                                            |
| `AssistantSettings` 的 hooks mock                      | 补 fork 的 `useMarketplacePersonas`                                                                  |
| 多处 `generated` 助手 fixture                          | 补 `agent_status: 'online'`——否则被 fork 的「隐藏未安装 CLI 助手」过滤整条吃掉                       |
| `LocalAgents` 断言                                     | 改为 fork 自己的 setup guide 链接（实现早已不指上游 wiki，断言一直没跟上）                           |
| `useDesktopTurnNotification` 断言                      | 通知标题跟随品牌改 One Work                                                                          |

### 4.8 验证

`tsc` 0 错误、`lint:fix` 退出码 0、`check-i18n` 通过、
**node 项目 1605 全绿**、**dom 项目 2878 通过**。

dom 仅剩 4 个文件失败，逐个核实均为**合并前就红的既有项**，本轮不扩大范围：

- `SortableConversationRow.dom`（2）：断言 `conversation-drag-handle`，但 fork 已删该 UI（上游还有）。
- `guidPage.dom`（1）：断言 `assistant-selection-area`，同上。
- `GuidActionRow.dom`（7）：测试从不传组件必填的 `personaAssistants`，合并前后完全一致。
- `AboutModalContent.dom`（4）：缺 `ThemeProvider` 包裹，源码与测试本轮均 0 改动。

---

## 5. 工程方法：worktree 隔离

同步期间工作区里有**另一条工作线的未提交改动**（P0-3 知识库 LanceDB 重做 +
License Key）。为不触碰它们：

- 1oneUI / 1oneCore 各开一个 **仓库外** worktree（`D:/aionui-m0/1oneUI-sync`、
  `D:/aionui-m0/1oneCore-sync`）做合并与验证。
- ⚠️ **worktree 不能放在仓库内部**：`.git` 是文件而非目录，Vite 的工作区根探测会
  一路向上找到父仓库的真 `.git`，导致 `/@fs/` 路径全部解析到主仓库，
  180 个 dom 测试套件直接加载失败（假失败）。移到仓库外即恢复。
- 1oneCore 的 `[patch]` 写的是相对路径 `../aionrs-local/...`，
  worktree 与 `aionrs-local` 同级时正好解析正确。
- 另一条线加的 `lancedb` 依赖需要 `protoc`（本机没装），在主工作区**任何 workspace 级
  cargo 命令都编不过**；干净 worktree 里没有这批未提交改动，因此不受影响。

## 6. `aionui-extension` 的 Windows 欠账：12 条（不是 5 条）——已全部修完

> **先纠正一个数**：本节初稿写「5 条」，是**我数错了**。`cargo test` 默认 fail-fast，
> lib 目标一挂就不再运行后面的集成测试二进制，所以只看到 lib 里的 5 条。
> 加 `--no-fail-fast` 重跑，真实数字是 **12 条**（lib 5 + `tests/lifecycle_hooks_test.rs` 7）。
> **教训：统计失败数必须带 `--no-fail-fast`，否则报出来的数字系统性偏小。**

本轮同步对该 crate 源码零改动，这些是排查红测试时挖出来的既有问题，现已全部解决。

### 6.1 扩展生命周期钩子在 Windows 上从来没能运行（11 条同源）

`execute_hook` 直接 spawn 脚本文件本身，靠 shebang 找解释器。Windows 没有 shebang 机制——
实测 `CreateProcess` 对 `.sh` 直接拒绝（`EFTYPE` / errno `-4028`，即 `ERROR_BAD_EXE_FORMAT`、
os error 193）。**这不是测试写错，是产品缺陷**：任何带 `onInstall`/`onActivate`/`onDeactivate`
钩子的扩展，在 Windows 上钩子都不执行，而且报出来的是一个没有任何指向性的 OS 错误码。

修法是新增 `build_hook_command()` 按扩展名分发解释器：

| 脚本类型        | 处理                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `.sh` / `.bash` | 走 POSIX shell（Unix 用 `/bin/sh`；Windows 从 PATH 找 `bash`/`sh`，Git for Windows 自带）          |
| `.ps1`          | `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File`（PowerShell 也不接受把脚本当程序传） |
| 其余            | 保持原样直接 spawn（原生二进制、`.cmd`/`.bat`、带 shebang 且有可执行位的文件）                     |

**顺带解决 Unix 上一个隐患**：扩展以压缩包分发，可执行位经常在解包时丢失，直接 spawn 就会失败；
改走解释器后不再依赖它。找不到解释器时返回明确原因，而不是抛 OS 错误码。

### 6.2 悬空链接导入：第二处失败点找到了，而且**第一处的修复是死代码**

上一版这里写「已修掉第一处（`remove_file` → `remove_dir`），还有第二处未定位」。
真相更难看一点：**第一处那个修复根本没生效过**。它写的是

```rust
#[cfg(windows)]
if metadata.is_dir() { remove_dir(path) }
```

而实测一个悬空 junction 的 `symlink_metadata`：

```
is_symlink=true  is_dir=false  file_type().is_dir()=false
remove_file → os error 5     remove_dir → OK
```

**Rust 在 Windows 上对任何链接 `is_dir()` 都返回 `false`**，所以那个分支从不触发，
代码照旧落到 `remove_file` 并报 os error 5。**教训：给平台特有分支加条件时，条件本身
也必须实测**——它可以完全合理却永远为假，而测试只会告诉你「还是坏的」，不会告诉你
「你的修复根本没跑」。

改为不依赖 `is_dir()`：先试 `remove_file`，失败再 `remove_dir`。目录型 reparse point 只有
后者能解，且它不跟随链接，所以目标已删也能删掉。

### 6.3 测试侧的三处改进（不是为了让它变绿，是原来就没测到东西）

- **两个 timeout 测试压根没测产品代码**。它们绕开 `execute_hook`，自己 `tokio::time::timeout`
  一个裸 `Command`——注释里明说「没法覆盖内置超时常量所以只好这样」。结果是：既没断言本
  crate 任何行为，也跳过了解释器分发（这才是它们在 Windows 上失败的真正原因）。
  新增 `execute_hook_with_timeout()`（最短内置超时 30s，测试无法触发），改为驱动真实路径
  并断言 `HookTimeout` 的每个字段。
- **cwd 断言**：脚本通过*相对路径*写文件，文件落在 ext_dir 本身就是 cwd 的证明；而 `pwd`
  文本比对只在 `pwd` 说平台原生路径语法时成立（Git Bash 报 `/d/...`，`canonicalize` 解析不了）。
  故文本比对收进 `cfg(unix)`，Unix 侧强度不变。
- **批量导入失败断言带上完整 `outcome`**，否则失败时只看得到一个空 vec，得再改代码才能知道原因。

### 6.3b ⚠️ 单测全绿 ≠ 修好了：真机 CDP 又抓出两个独立缺陷

按扩展名分发解释器那版**单测全绿**，装进真机一跑，钩子照样不执行。CDP 冒烟连抓两条，
两条都只在 **Electron 主进程用增强 PATH 派生子进程**时才出现：

| #   | 缺陷                                                                                                                                                                                   | 真机证据                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `bash` 解析到 `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe` —— 那是 **WSL 启动器**不是 Windows 侧 shell。WSL 在自己的文件系统命名空间（`/mnt/c/...`），递过去的 Windows 路径原样报错 | 日志里路径**完整无误**却 `No such file or directory`                                                                    |
| 2   | MSYS / Git-for-Windows 的 shell 按 POSIX 转义规则**重新解析原始命令行**，`C:\Users\…\hook.sh` 的反斜杠被当转义吃掉                                                                     | `/bin/bash: C:Usersallenzhao…: No such file or directory`；另用 PowerShell 直接 spawn Git bash 传反斜杠绝对路径独立复现 |

修法：优先 `sh`（这个名字在 Windows 上只由真正的 POSIX 工具链提供）并显式跳过 `WindowsApps`
下的 Store 执行别名（新增单测锁死）；路径改传正斜杠。

**为什么单测挡不住**：这个 crate 的单测在 `cargo` 下跑，继承的是 Git Bash 的 PATH，
`sh`/`bash` 解析结果与 Electron 主进程的增强 PATH **不是同一个**。
**凡是行为取决于 PATH 解析的改动，「单测全绿」没有证明力，必须真机验证。**

**最终真机结论**（dev + 自建带 `.sh` 钩子的扩展）：

```
lifecycle hook completed successfully extension="hook-smoke" hook="onActivate"
```

标记文件落在扩展目录内 —— 同时证明 cwd 也是对的。

### 6.3c 排查过程中我自己犯的两个错（都因为截断输出）

- `cargo build --release -p aioncore` **包名不存在**（真实是 `-p aionui-app --bin aioncore`），
  但我只 `tail -3` 看输出，没看到 `error: package ID specification did not match`，
  于是拿着**旧二进制**测了一轮，得出「修复没生效」的错误结论。
- 同一天早些时候 `cargo fmt -- --check` 的输出被我 `head -5` 截断，只看到第一个文件就
  声称「fmt 绿」，实际另一个文件没格式化。

**教训：构建/校验类命令的输出不能截断着看，要么看退出码，要么看全。**

### 6.4 顺带修的两处（与上面无关，是提交时发现的）

- **`Cargo.lock` 漂移**：`092e9071` 给 `one-devops` 加了 `futures-util`/`tempfile`（FTS5 检索用）
  但没提交对应的 lock 更新，导致每次构建都弄脏工作区，`--locked` 构建会直接失败。
- **`canonical_test.rs` 没格式化**：这是我上一轮同步时自己写的代码，**推送时我声称
  「clippy + fmt 绿」是错的**——那次 `cargo fmt -- --check` 的输出我 `head -5` 截断了，
  只看到第一个文件就下了结论。已补格式化。**教训：`--check` 的输出不能截断着看。**

**结果**：`cargo test -p aionui-extension --no-fail-fast` → 18 个测试二进制全绿，0 失败。

---

### ⚠️ CRLF 会让**全部存量用户**的数据库迁移失败（真机验证抓到）

CDP 冒烟第一次启动就报「本地数据迁移失败」，后端日志：

```
BOOTSTRAP_DATA_INIT_FAILED stage="database.migration"
error=Migration failed: migration 19 was previously applied but has been modified
```

排查结论：**与本轮合并无关**。sqlx 用迁移文件的原始字节做 sha384 校验和，
而行尾取决于检出环境，所以「换台机器/换 CI 构建」就会让所有存量库校验和对不上。

⚠️ **第一版结论把方向搞反了，这里记正确的**：一开始以为"库里存的是 LF、
worktree 检出成 CRLF 导致失配"，于是给 `*.sql` 钉 `eol=lf`。实测推翻：

| 位置                         | 状态                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| 打包源（1oneCore 主工作区）  | **30 个迁移是 CRLF、10 个是 LF**（历史上 `autocrlf` 改过） |
| 已发布版本写进用户库的校验和 | 就是上面这个**混合**状态                                   |
| 单纯钉 `eol=lf` 的后果       | 那 30 个哈希全变 → **亲手触发**本要防的事故                |

所以正确修法不是改文件字节，而是**让启动过程容忍纯行尾差异**：

`aionui-db/src/database.rs` 的 `align_line_ending_only_checksums()`——
`VersionMismatch` 时逐条比对，只有当已应用迁移的文本**去掉 `\r` 后完全一致**
才对齐存储的校验和并重试；任何真实改动仍照常拒绝，「已应用迁移不可变」的保证不变。
照抄既有 `align_reconciled_mcp_migration_checksum` 的模式，新增两条测试锁死
（仅行尾差异会对齐 / 语义改动不会）。

**真机验证**：拿本机那个原本起不来的 dev 库直接启动，日志

```
Applied migrations differ from the shipped ones only by line endings;
realigned their checksums and retrying versions=[19,20,21,25,31,32,33,34,35,36]
```

精确识别出 fork 后加的那 10 条 LF 迁移，对齐后重试成功，40 条校验和全部匹配、
应用完整加载。有了这层修复，`.gitattributes` 再钉 `*.sql eol=lf` 就只是防止
漂移继续发生，不会影响存量库（本轮已加）。

> 顺带一提：本机 dev 库之所以是 LF/CRLF 混着记录的，就是因为 `autocrlf` 设置
> 中途变过——没有任何一种检出方式能同时满足全部 36 条，这也正是必须在代码里
> 容忍而不是靠 git 配置解决的直接证据。

**本轮的一次操作失误（已恢复，记录备查）**：曾在 1oneCore 合并中途用 `git stash`
做基线对比，导致 `MERGE_HEAD` 丢失、分支被 reset。所有改动完整躺在 stash 里，
`git stash pop` 后用 `git commit-tree` 重建了正确的双亲合并提交（`263b60a2`）。
**结论仍然是：合并/冲突解决期间绝不用 `git stash`，要基线就开 worktree。**

## 7. 与另一条工作线的汇合（推送时才发生，5 个冲突）

推送时 `one-main` 上已有另一条线（企业版商业化 5 项待办）的 3 个提交，所以最后一步是**合并**而非 fast-forward。5 个冲突里有 3 个直接源于本轮同步，值得单独记下来：

| 冲突文件                                                                                                                    | 裁决                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                                                                                 | **两个索引条目都保留**（本轮同步的 07-29 条 + 另一条线的 07-30 条），不是二选一 |
| `i18n-keys.d.ts`                                                                                                            | 生成物，取 `one-main` 后直接 `bun run i18n:types` 重生成，不手工合 key union    |
| `verify-bundled-aioncore-resources.js`<br>`verify-bundled-aioncore-install.ps1`<br>`verifyBundledAioncoreResources.test.ts` | **全取 `one-main`**——它是严格超集                                               |

第三行是关键因果：**另一条线那个"解除打包阻塞"的修复，起因就是本轮同步**。同步后后端改产 `schemaVersion: 2` manifest（agent CLI 从 npm 包换成原生二进制），而 JS 校验器和**装机侧 PS1 校验器**都写死只认 v1 —— 前者让 `dist:win` 直接失败，后者会把已装用户误判成"安装损坏"。他们的版本同时认 v1+v2，我这边只有 v2；取 `--ours` 会把这个修复覆盖掉、重新把打包堵死。

同时顺手清了一个既有测试卫生问题：`SettingsSider.dom.test.tsx` 断言通过但抛 2 个 unhandled rejection —— `configService` 首次访问会 fetch 相对 URL `/api/settings/client`，jsdom 的 undici 不接受相对 URL。按仓库里既有写法补了 `configService` mock。

**合并后完整验证**：`bunx tsc --noEmit` 0 错误 → `bun run lint:fix` exit 0 → `node scripts/check-i18n.js` 通过 → `bunx vitest run` **360 文件 / 2896 用例全绿、0 unhandled**（合并前是 359/2895，多出的来自另一条线）。

### 另一条线那条"两个主干不对齐"的警告：确实成立，已补合

那份文档写着"1oneCore 提交 `092e9071` 在 `sync-v0153` 分支上尚未合并主干，发版前必查"。第一反应是"我推的 `one-main` 就是从 `sync-v0153` 来的，应该已经带上了"——**实测 `git merge-base --is-ancestor 092e9071 origin/one-main` 返回否，警告是真的**。

原因是两条线在同一个提交上平行分叉：他们把 1oneCore 的企业改动（`092e9071` + `56cdd1b4`）直接叠在**我的同步分支** `sync-v0153` 上并推到了远端，而我在同一个父提交 `6c77ad7f` 上加了拆 `[patch]` 的 `24bedf70` 就推了 `one-main`。所以 `one-main` 和 `origin/sync-v0153` 互不包含。

已补合（`79938cf8`），无冲突。合并后验证 `cargo build --workspace` 通过 + 他们那三个 crate 测试数与其文档记录的基线**逐一吻合**（one-devops 46 / one-org 41 / one-enterprise 13）。

**教训**：多条工作线并行时，"我的分支被合进主干了"不等于"基于我分支的后续提交也进去了"。判据只有 `git merge-base --is-ancestor`，不能靠分支血缘推断。

### 三仓级联最终核实

| 环节                           | 实测值                        |
| ------------------------------ | ----------------------------- |
| aionrs `origin/master`         | `8bb0e0b`                     |
| 1oneCore `Cargo.lock` → aionrs | `...#8bb0e0bb72e4...` ✅ 一致 |
| 1oneCore 版本                  | `0.1.53-one.1`                |
| 1oneUI `aioncoreVersion`       | `v0.1.53-one.1` ✅ 一致       |
| `092e9071` ∈ `origin/one-main` | ✅                            |
