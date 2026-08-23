# 上游同步待办与评估（2026-08-16 交接，2026-08-17 更新进度）

> 上一轮同步（2026-08-13~16）已发布 **v2.1.54**。这份文档记录**当时刻意推迟的**与
> **推迟之后上游又新增的**，并给出每一组的冲突面、收益、难度、是否必须。
>
> **新会话接手时先读这份，再读 [`upstream-sync-reference.zh-CN.md`](upstream-sync-reference.zh-CN.md)（套路与不变量）。**
>
> ## ✅ 2026-08-17：清单基本清空（A~G 全部处理完 + aionrs merge + triage）
>
> 本轮做完 **F(3条)、G(6条)、1oneCore CLI发现三条、C组前3条、B(4条)、E(2条)、
> A.SCM面板(4条)、D.内置浏览器(2条)、aionrs 整体 merge 至 0.2.11(12条)、
> triage 的 1oneUI 2条 + 1oneCore 3条**，均已跑过检查并合回各仓 `one-main` / `master`。
>
> **本轮反复出现且必须记住的坑**：多条提交在 cherry-pick 冲突视图里会"顺带"混进
> **完全不相关、尚未同步的功能**（office 文件监听子系统重写 `eb4bd7f7`、Search 面板、
> SCM 源代码管理面板、"用默认应用打开" `open-system`、**会话分叉的 `ForkBranchIcon`**、
> **turn-id 的 `markCompleted(id, turn_id)` 签名**），因为它们在上游代码里与本轮
> 目标提交相邻或共享同一段上下文。**diff 冲突标记里出现的内容不能默认全部采纳**——
> 每条都要用 `git show <commit> --stat` / `git show <commit> -- <file>` 核实是不是这个
> commit 自己引入的（**`+`/`-` 才是它的，前导空格是上下文**），不是就要剥离，否则会把
> 未同步功能的一半代码悄悄带进来（编译得过，但功能残缺——正是 §1.1 那个坑的变体）。
>
> ### ⛔ 已明确不采纳（**下轮别再重做**）
>
> | 提交                                                                 | 仓      | 不采纳的原因                                                                                                                                                                                                                            |
> | -------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `e187ac746` 移除 11 套社区主题                                       | UI      | **用户拍板永久保留主题。** 已核实它不碰 `BACKGROUND_BLOCK_START/END`、11 套全是上游作者的、上游也已处理回落（选中已删主题安全落回浅色）；但会让存量用户主题被静默重置，判为不可接受的用户可见功能损失。                                 |
> | `fe99ff60` 恢复 direct CLI 的 Team MCP                               | Core    | 它把 `route_for_backend` 的 claude/codex 重新指回 `DirectCli`，而 fork 刻意让二者走 `AcpManager` 以保住桥接注入（§1.4，`acp.rs:1549-1550` 有测试锁死）；它新增的两条契约测试在本仓必失败；其余改动全在 fork 未接线的 `aionui-session`。 |
> | `36d632de5` bump 2.1.56 / `48a8b9bf` release 0.1.67                  | UI/Core | 版本号按 fork 自己节奏，不照搬。                                                                                                                                                                                                        |
> | `eb4bd7f7` 预览 v2 后端半边（office 刷新 / 溢出标记 / 内容变更信号） | Core    | **2026-08-17 拍板不采纳，理由见下方 §2.C-1 专条。** 一句话：它删掉的五个端点 fork 前端全部在用，且它建在 fork 未采纳的 `6e77158c` 之上，代价远大于收益。                                                                                |
>
> ### 🕗 仍然挂着的
>
> - ~~**C组剩余 2 条**~~ —— **已于 2026-08-17 处置完毕**：Core `eb4bd7f7` 正式不采纳
>   （见上表与 §2.C-1）；UI `b678d839e` 判定与 `eb4bd7f7` **无任何依赖关系**（纯前端保存按钮），
>   已按 fork 现状**等价手写实现**（不是 cherry-pick，原因见 §2.C-1 末段）。
> - **claude CLI pin 从 2.1.215 升到 2.1.233**（Core `9645dc5b`/`77acec68`）——这两条**不是
>   例行 pick**：一半落在 `aionui-session/backend/cli_version.rs`，而该文件来自上游
>   `ae817e32`「改用用户自己的 claude/codex、不再内置」，fork 没采纳那套架构（仍内置，
>   pin 在 `aionui-runtime/managed_cli/mod.rs`）；另一半改的是 `claude_flags.rs` 里
>   **刻意绑在 fork 自己 pin 值上**的断言。所以它等价于「fork 要不要升内置 CLI」的
>   打包决策，需单独一轮并验证该版本二进制可获取。
> - **会话分叉（session fork）跨仓功能**——aionrs 侧已随整体 merge 进来（`df1cf85`+`5889110`），
>   但 **1oneUI 侧的 `ae2d2f53e` 未合**，所以前端没有分叉入口。要不要这个能力属产品决策；
>   注意它还牵着 `ForkBranchIcon` 与 turn-id 两处（本轮已从别的提交里剥离过）。
> - **TUI REPL 已合入但结构上不可能被触发**（无需额外处置）：`aion-cli/src/run.rs` 里
>   `--json-stream` 在 TUI 探测之前就 return，且 TUI 还要求 prompt 为空 + stdin/stdout
>   双双是 TTY；1oneCore 走 JSON 流且管道化 stdin/stdout。

---

## 0. 一句话现状

| 仓       | 我们停在                                    | 上游到      | 待处理（2026-08-17 收尾后）                                                                                                         |
| -------- | ------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1oneUI   | 2.1.54 + 本轮全部 cherry-pick（未打版本号） | **2.1.56**  | A~G 全部已合；C 组 `b678d839e` 已**等价手写实现**（§2.C-1）；剩会话分叉 `ae2d2f53e`（产品决策）；`e187ac746`/`36d632de5` 已定不采纳 |
| 1oneCore | v0.1.65 相当 + 本轮全部 cherry-pick         | **v0.1.67** | C 组 `eb4bd7f7` 已定**不采纳**（§2.C-1）；剩 claude pin 升级（打包决策）；`fe99ff60`/`48a8b9bf` 已定不采纳                          |
| aionrs   | **0.2.11（已整体 merge）**                  | 0.2.11      | ✅ 已对齐；1oneCore 的 `Cargo.lock` 已 `cargo update` 指向 `e4d1638`                                                                |

**原先那 34 条推迟不是"漏了"，是当时判断冲突集中且与发布无关而主动押后的。**
它们大多是**前后端成对**的，见 §2。**现在绝大多数已处理完，剩下的都在上面那张
"仍然挂着的"清单里，且每条都注明了为什么它不是简单 pick。**

---

## 1. ⚠️ 评估上游同步时必须避开的坑

这一节比清单本身重要。以下每条都是**真实踩过**的，不是预防性提醒。

### 1.1 前后端必须成对合 —— 已经踩过三次

上游经常把一个功能拆成 `AionUi`（前端）+ `AionCore`（后端）两个 PR。
**只合一半的表现是「功能看起来在，但永远空/永远 404」，而且不报错。**

已发生三例：`model_kind`（前端有字段后端 serde 静默丢弃）、`ChatFileRef`（前端发标签
对象后端只收字符串→带附件发消息一律 400）、**Explorer**（前端面板渲染了，
`/api/projects/*` 后端 0 处路由，树永远空）。

**做法**：拿到一个前端 PR，先去 1oneCore 搜同名功能的对应 PR；配不上对就整组押后。
本轮 §2 的分组就是按这个原则划的。

### 1.2 风险分级不能靠读 diff，必须"试合并 + 编译"

2026-08-13 我把 `7f8ed6c5` 判成"低风险 P1"，用户反馈"远远大于预期"。
它改 300+ 文件却**零显式冲突**，因为它是后面 30 多个"小修"的地基。

**判据**：改动面极大但零冲突的提交，风险最高，不是最低。

### 1.3 零冲突 ≠ 安全：3-way merge 会静默删掉 fork 独占模块

2026-07-29 自动合并把 fork 独占的 `acp_tool_runtime`（npm 按需下载）整个换成上游的
`managed_cli` 方案，**没有任何冲突标记**，靠编译报错才暴露。

**做法**：合并后必须全量 `cargo build --workspace` + `cargo test --workspace`，
"冲突解完"绝不等于完成。

### 1.4 fork 的架构分歧点 —— 这些**不能**被上游覆盖

| 分歧点              | fork 的做法                                          | 上游的做法                       | 后果                                                    |
| ------------------- | ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `route_for_backend` | claude/codex → `AcpManager`                          | → `DirectCli`/`SessionAgentTask` | 照搬会绕过桥接注入，模型静默退回 cc-switch              |
| Codex/Claude 桥接   | `CODEX_CONFIG`/`MODEL_PROVIDER` + `ANTHROPIC_*` 注入 | 无                               | 丢了就用不了公司网关模型                                |
| `providers` 作用域  | **部署级共享**（`user_id` 不参与查询）               | 按 user 隔离                     | 照搬会让成员看不到模型                                  |
| 迁移编号            | fork 占用了上游也在用的号                            | —                                | 撞号必须重排，且 `migrate_repair.rs` 的版本常量要跟着改 |
| `acp_tool_runtime`  | fork 独占                                            | 已删                             | 见 §1.3                                                 |
| 品牌                | One Work / 1ONE Code                                 | AionUi                           | 见 §1.6                                                 |

**`session_agent.rs` / `aionui-session` / antigravity 相关代码照常 pick 但不接线**——
这是 2026-08-14 拍板的：跟随用户本机装的 claude/codex，但桥接用我们自己的。
即使这些代码零效果也要跟上游同步，方便下次合并。

### 1.5 迁移撞号 + 校验和

- 上游新迁移的编号八成与 fork 已占用的冲突，**必须重排**并同步改
  `migrate_repair.rs` 的 `USER_SCOPE_MIGRATION_VERSION` 与 gate 常量、
  `upgrade_encryption_survives.rs` 的 `LAST_PRE_USER_SCOPE_MIGRATION`。
- sqlx 用**原始字节**做 sha384，行尾会影响校验和。**别给 `*.sql` 钉 `eol=lf`**——
  已发布版本写进用户库的是混合 CRLF/LF 的哈希，统一行尾会让所有存量用户升级后起不来。
  已有 `align_line_ending_only_checksums()` 处理，别动它。

### 1.6 品牌复检五类表面

i18n 文案 / **渲染层与主进程**硬编码 / 安装器脚本 / 任务栏与窗口标识 / 系统托盘 tooltip。
2026-08-14 因为把"渲染层"理解成只扫 `src/renderer/` 而漏掉主进程托盘，用户装完包截图打脸。
现已收口到 `BRAND_DISPLAY_NAME` 常量 + `trayBrand.test.ts` 锁死。
**改品牌时要连"谁在匹配这个字符串"一起 grep**，不能只改产生它的地方（发布流水线
就因此坏了三处，见 §1.8）。

### 1.7 i18n 冲突的处理方式

40 个冲突块用脚本处理：**上游侧作结构模板 + fork 值优先 + `JSON.parse` 当闸门**，
脚本按设计拒绝丢掉 fork 独有 key 的合并。别手工逐个解。

### 1.8 发布相关的三个坑（2026-08-16 全部修掉，但要知道）

1. **手动构建默认删掉 mac 的 zip 与 yml** → 打出的包收不到自动更新而构建报绿。
   打 mac 发布包必须 `-f installers_only=false`。
2. `prepare-release-assets.sh` 曾写死校验旧品牌名，而 mock 夹具用同一个过期名字，
   **测试自洽地绿着、真实路径是坏的**。
3. mac 构建曾无超时，挂死按 10 倍计费烧满 6 小时默认额度。现为 60 分钟。

详见 [`mac-packaging-preflight.zh-CN.md`](mac-packaging-preflight.zh-CN.md)。

### 1.9 ⚠️ 写更新说明要按**代码**核实，不能按 triage 清单

2026-08-16 我照 triage 清单写 2.1.54 更新说明，**没核对哪些最后被推迟了**，
于是把「文件树在文件夹中显示 / 复制路径」和「按文件名搜索」两个根本没合进来的
功能写进了**已发布的公开说明**，事后才发现并从三处删除。

**做法**：每条更新说明落笔前 grep 一次代码，确认功能真在。
清单上写着的 ≠ 代码里有的。

---

## 2. 本轮推迟的 34 条（按功能组，前后端已配对）

### A. SCM 变更面板 —— 🟢 收益高 / 🔴 难度高 / 非必须

| 仓   | 提交                  | 说明                                  |
| ---- | --------------------- | ------------------------------------- |
| UI   | `f98d9f719` (30 文件) | Changes 面板 + 多仓切换器 + repo 标签 |
| UI   | `1e49e704d` (27 文件) | 可折叠分区 + 树/列表视图              |
| Core | `3d0e2760`            | 工作区根的一层仓库发现                |
| Core | `81ef2589`            | 实时仓库集变化 + `pe_name`            |

**冲突面**：新增 `SourceControl/` 目录为主，与 fork 改动重叠少。
**收益**：面向开发者的核心能力，我们目前完全没有。
**难度**：57 个前端文件，但集中在新目录，真正的风险是 Core 侧两条要接进
`aionui-project` 的监听体系。
**建议**：整组一起做，单独一轮。

### B. Explorer 右键菜单 —— 🟡 收益中 / 🟡 难度中 / 非必须

| 仓   | 提交                  | 说明                                     |
| ---- | --------------------- | ---------------------------------------- |
| UI   | `4edea7c5d` (4 文件)  | 在文件夹中显示                           |
| UI   | `31ec26a90` (19 文件) | 复制相对/绝对路径                        |
| Core | `a621ed88`            | 服务端写剪贴板的 copy-absolute-path 端点 |
| Core | `6197117e`            | 列表隐藏 OS 垃圾与 VCS 内部文件          |

**冲突面**：**两条都改 `ExplorerContainer.tsx`——这正是本轮推迟的主因**，
fork 在这个文件上有改动。`31ec26a90` 还带 13 语言 i18n。
**收益**：小而实用，用户能立刻感知。
**⚠️ 注意**：这两条我曾误写进 2.1.54 更新说明（见 §1.9），做完记得补进下一版说明。

### C. 预览 v2 与文件引用 —— 🟢 收益高 / 🟡 难度中 / **偏必须**

| 仓   | 提交                  | 说明                                                                        |
| ---- | --------------------- | --------------------------------------------------------------------------- |
| UI   | `b678d839e` (17 文件) | 可编辑文件工具栏的保存按钮                                                  |
| Core | `eb4bd7f7`            | office 刷新、溢出标记、内容变更信号                                         |
| Core | `e8b6f4c8`            | ChatFileRef 内容端点                                                        |
| Core | `e4e991af`            | PDF 流端点 + office ChatFileRef 解析，**退役 `fs/resolve` 与 WS `fs/read`** |
| Core | `575feacd`            | 临时 `fs/resolve`（被 `e4e991af` 退役，顺序不能颠倒）                       |

**⚠️ 这组有顺序依赖**：`575feacd` 加临时端点、`e4e991af` 再把它退役。
乱序 pick 会产生无意义冲突。
**为什么偏必须**：`ChatFileRef` 正是 §1.1 里踩过的那个坑的所在地，
前端已经在发标签对象，后端这套端点补齐才算真正闭合。

**状态（2026-08-17）**：`e8b6f4c8` / `e4e991af` / `575feacd` 已合入；
`eb4bd7f7` **不采纳**（见 §C-1）；`b678d839e` **已等价手写实现**（见 §C-1 末段）。

#### C-1. ⛔ `eb4bd7f7` 不采纳的完整证据（2026-08-17 拍板，**下轮别再重做**）

> **本条最先要纠正的是一个错误前提。** 本文档此前（以及 `handoff-2026-08-17-remaining.zh-CN.md`
> 的 P1 表第 1 行）写着「`eb4bd7f7` 正面撞 fork 自己独立改过的
> `watch_service.rs`/`file_watching.rs`」——**这是错的**。实测用 blob 哈希逐字节比对，
> fork 的这几个文件与上游同一个 PR（`7f8ed6c5`，即 fork 的 `65455953`，PR #669）**完全相同**：
>
> | 文件                                                 | fork blob   | 上游 `7f8ed6c5` blob |
> | ---------------------------------------------------- | ----------- | -------------------- |
> | `crates/aionui-file/src/watch_service.rs`            | `c6f8850f…` | `c6f8850f…`          |
> | `crates/aionui-file/tests/file_watching.rs`          | `190e1891…` | `190e1891…`          |
> | `crates/aionui-office/src/snapshot.rs`               | `e74c6713…` | `e74c6713…`          |
> | `crates/aionui-office/tests/snapshot_integration.rs` | 同上一致    | —                    |
>
> `git log --oneline -- <file>` 对这几个文件也只有两条提交，全是上游的
> （`c0b50baf` 挤压基线 + `65455953`）。**fork 从未在这四个文件上写过一行自己的代码。**
> 复现命令：`git rev-parse HEAD:crates/aionui-file/src/watch_service.rs` 与
> `git rev-parse 7f8ed6c5:crates/aionui-file/src/watch_service.rs` 对比。

**真实不采纳理由（四条，均可复现）：**

**① 它删掉的五个端点，fork 前端全部在用。**
`git show eb4bd7f7 -- crates/aionui-file/src/routes.rs crates/aionui-office/src/routes.rs`
里这五行都是 `-`（被删），而 fork 的 `packages/desktop/src/common/adapter/ipcBridge.ts` 正在调：

| 被删端点                                                  | fork 调用点              |
| --------------------------------------------------------- | ------------------------ |
| `/api/fs/office-watch/start`、`/api/fs/office-watch/stop` | `ipcBridge.ts:981-982`   |
| `/api/preview-history/list`、`/save`、`/get-content`      | `ipcBridge.ts:1455-1473` |

后者对应 UI 上的 `PreviewHistoryDropdown.tsx` 与工具栏 `preview.saveSnapshot`
按钮，合进去等于**预览历史子系统整体报废**；前者会让 office 文件监听静默 404
——正是 §1.1 那个坑的**第四次**。

**② 它建在 fork 未采纳的 `6e77158c` 之上，而 `6e77158c` 删的东西 fork 前端有三处在用。**
`6e77158c`「remove dead preview file endpoints」上游删了 3018 行，含整个
`crates/aionui-file/src/browse.rs`（523 行）与 `tests/zip_packaging.rs`（398 行）。
上游认定「dead」的这批端点在 fork 里是活的：

| 上游认定 dead 的端点               | fork 调用方                                                           |
| ---------------------------------- | --------------------------------------------------------------------- |
| `/api/fs/browse`                   | `settings/DirectorySelectionModal.tsx`                                |
| `/api/fs/remove`、`/api/fs/rename` | `conversation/explorer/explorerModel.ts`、`explorer/monitorClient.ts` |
| `/api/fs/zip`                      | `common/adapter/ipcBridge.ts`                                         |

**③ 它夹带一个独立且未评估的功能。** 45 个文件里含
`crates/aionui-app/src/router/system_file_opener.rs`（新增）+ `/api/fs/open-system`
路由——就是本文档开头点名警告的「用默认应用打开 `open-system`」，与预览 v2 无关。

**④ fork 在受影响范围内真正要保住的资产不在被删文件里，而在会被大改的邻居里。**
最要紧的是 fork 原创提交 **`8c8cf349`**（`fix(file,shell): 两处路径分隔符/编码 bug，
Windows 上文件树层级会塌掉`）里的 **`to_relative_path_string()`**：`relative_path`
必须按 `components()` 拼 `/`，否则 Windows 上发出去的是 `folder\file.txt`，而前端
恒按 `/` 拆层级（`explorer/explorerModel.ts` 顶部注释写死了这个协议约定），
**整棵文件树会塌成一个名字里带反斜杠的顶层节点**。它落在
`crates/aionui-file/src/service.rs` + `crates/aionui-shell/src/shell.rs`，
而 `eb4bd7f7` 恰好大改 `service.rs`（+165）、`aionui-project/src/runtime/tree_model.rs`、
`chat_files.rs` —— 全是 `relative_path` 的产出路径。同类还有 `2b825571`
（让上游新 crate 的测试在 Windows 上真正跑起来）。

**试合并实测数据（只读，未落盘）**：45 文件里 `git apply --check` **13 个失败**；
按 `eb4bd7f7^` 作 base 的 `git merge-file` 三方合并 **8 个文件冲突**，其中
`aionui-file/src/routes.rs` 单文件 **8 段**、`aionui-app/src/router/state.rs` **5 段**。
根因是 fork 相对上游**一会儿超前一会儿落后**：fork 已 pick 了上游**晚于** `eb4bd7f7`
的 `a621ed88`（copy-absolute-path，fork 里是 `394d1be9`），却没 pick 早于它的
`6e77158c` 与 `bdb6d619`。

**⚠️ 若将来仍要做，正确路径不是 cherry-pick**：必须把
`6e77158c` → `eb4bd7f7` 连同 1oneUI 侧的 **explorer / preview-history / office-watch
三处调用**当成**一个跨仓迁移项目单独立项**（前端要先迁走 browse/zip/remove/rename
与预览历史的依赖，后端才谈得上换这套端点）。它带来的实际能力只有 office 三种预览的
refresh 端点 + `resolve-ref` + 溢出标记，收益/代价明显倒挂。

**关于配对的 `b678d839e`（UI）**：读全文后确认它**不是 `eb4bd7f7` 的前端半边**——
17 个文件里 13 个是 i18n，代码只接**已有前端状态**（`handleSaveActiveTab` /
`EDITABLE_CONTENT_TYPES` / `activeTab.isDirty`），**零后端调用**，本文档原先把两者
归成一组是分组错误。但它也不能直接 pick：fork 的 `PreviewPanel.tsx` 相对
`b678d839e^` 是 +104/−439、`PreviewToolbar.tsx` +115/−85，fork 缺上游整条
preview-v2 刷新链（`handleSaveActiveTab`/`refreshActionable`/`refreshState`/
`metadata.oversized` 在 fork 全部不存在），fork 自己有的是
`saveContent()`（`Preview/context/PreviewContext.tsx:588`，已挂在快捷键上）。
**已按 fork 现状等价手写**：`PreviewToolbar` 新增 `showSave`/`saveActionable`/`onSave`
三个 prop，复用 `saveContent()` 与 `activeTab.isDirty`，并把上游的
`metadata.oversized` 守卫映射成 fork 的 `metadata.truncated`（内容被截断时禁止保存，
否则会把截断后的内容写回真实文件）。

### D. 内置浏览器（agent 可控）—— 🟡 收益中 / 🔴🔴 难度极高 / 非必须

| 仓  | 提交                      | 说明                                     |
| --- | ------------------------- | ---------------------------------------- |
| UI  | `cb9d8f19b` (**86 文件**) | 单目标 CDP 桥接上的 agent 可控内置浏览器 |

**冲突面**：动 `electron-builder.yml`——**与 fork 的打包配置正面相撞**
（productName/artifactName/appId 全是 fork 改过的）。
**建议**：单独一轮，且合完必须重打包验证，别和别的混在一起。

### E. 渠道配置 UI —— 🟡 收益中 / 🟢 难度低 / 非必须

`93bac465f`（Discord）+ `12d86f646`（Slack），各 17 文件，同改
`ChannelModalContent.tsx`。**两条必须一起合**，否则第二条必冲突。

### F. Antigravity 完善 —— 🟢 收益高 / 🟢 难度低 / **必须**

| 仓   | 提交        | 说明                                    |
| ---- | ----------- | --------------------------------------- |
| Core | `240e7f45`  | 解析 `agy models` 的 TSV 输出           |
| Core | `18617b38`  | 发现为空时丢掉 `default` UI 占位模型    |
| UI   | `5440d66ef` | 团队成员用空模型而非 `default` 占位创建 |

**为什么必须**：我们**已经在 2.1.54 里对外宣布"新增：接入 Antigravity"**，
而模型发现和占位符处理这三条没合——用户配 Antigravity 大概率撞上占位模型问题。
**这是已发布功能的补完，优先级高于所有其他组。**

### G. 启动与运行时稳定性 —— 🟢 收益高 / 🟢 难度低 / **偏必须**

| 提交        | 说明                                               |
| ----------- | -------------------------------------------------- |
| `e272af8e2` | 别把 `listen_timeout` 误判成安装不完整             |
| `5bfff048d` | 自愈成功的安装完整性失败不再报警                   |
| `322ecfd20` | 静默 GPU 崩溃噪音 + 提示硬件加速被自动关闭         |
| `f09229c7b` | agent 进程注册表抗损坏与并发写                     |
| `d768ba550` | office 预览在 `FILE_WATCH_UNAVAILABLE` 时优雅降级  |
| `af3a352aa` | 数据库降级的专用弹窗（后端已合，只差这个前端弹窗） |

**都是纯修复、改动面小、与 fork 无架构冲突。性价比最高的一组，建议先做。**

### H. 其余零散

`cc57afcea`（内置浏览器 MCP 命令挂起 + Windows spawn EINVAL）、
`5de292e9f`（丢弃旧主题迁移）、`800a7ffdd`（WebUI 技能文件浏览）、
`29659c629`（复制按钮复制整轮而非最后一段）、`0c8712c3b`（团队省略 slot 处理）、
`e7b6bb314`（选中链接用内置/系统浏览器打开，23 文件）、
`24380952` / `8494a1f9` / `f0f4fbd1`（项目树与 agent 路径的三个修复）。

---

## 3. triage 之后上游新增的（本轮没评估过）

### aionrs 12 条 —— ⚠️ 需要专项评估

```
5889110 feat(agent): stamp per-run turn ids onto conversation messages
df1cf85 feat(session): add session forking with lineage and turn-anchored boundaries
504b870 chore(main): release 0.2.11
4ffa967 feat(tui): add interactive repl interface
6a91939 feat(tui): complete codex-style repl workflow
5bc0031 fix(cli): stabilize tool context and terminal rendering
5a4aa9e fix(tui): rebuild scrollback without duplicate rendering
（+ 4 条 merge/lock 提交）
```

**两件事值得单独判断**：

1. **会话分叉（session fork）是跨仓功能**：aionrs `df1cf85` + `5889110`，
   1oneUI 侧对应 `ae2d2f53e`（在 aionrs 会话里露出分叉入口）。
   **又是一个前后端配对**，要合就一起合。收益取决于产品上要不要这个能力。
2. **TUI REPL（`4ffa967` + `6a91939` + 两条修复）是 aionrs 的命令行界面**，
   我们的产品是 Electron 桌面端，**这部分对我们大概率零价值**，
   但 aionrs 是整体 merge 的，硬拆反而制造冲突。
   **建议**：整体 merge 进来但不接线（同 §1.4 对 session_agent 的处置方式）。

### 1oneUI 4 条

| 提交                                   | 评估                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `d84c3fb02` 会话标为未读               | 🟢 小功能，低难度                                                                                                                      |
| `4b0025897` 延迟模式切换显示为 pending | 与 Core `9700f883` 配对，**成对合**                                                                                                    |
| `e187ac746` 移除弃用的社区主题         | ⚠️ **危险**：我们的品牌/主题层有 fork 改动，且 `BACKGROUND_BLOCK_START/END` 是刻意保留的（改名会让存量用户背景失效）。**评估时重点看** |
| `36d632de5` bump 2.1.56                | 版本号，按 fork 自己的节奏，**不要照搬**                                                                                               |

### 1oneCore 10 条

| 提交                                                     | 评估                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `88819804` 找到 bun / vendor 安装的 agent CLI            | 🟢 **偏必须**，直接影响用户能不能用上自己装的 CLI                                                    |
| `f6131a4a` 首次 npx agent 留出安装时间再 initialize 超时 | 🟢 **偏必须**，本机 node 启动慢（Defender 逐进程扫），我们更容易撞                                   |
| `13b5dd42` omp 走本地 CLI 而非 npx 桥                    | 🟢 同上                                                                                              |
| `fe99ff60` 恢复 direct CLI 的 Team MCP 能力              | ⚠️ **必看**：direct CLI 路径正是 fork 不采纳的那条（§1.4），**先确认它是否触碰 `route_for_backend`** |
| `9700f883` 延迟模式切换报 pending                        | 与 UI `4b0025897` 配对                                                                               |
| `9c35aa6a` / `c12517d0` / `77acec68` / `9645dc5b`        | ACP/CLI 版本 pin 的例行 bump，🟢 低风险，但注意 fork 的 `acp_tool_runtime` 分歧                      |
| `48a8b9bf` release 0.1.67                                | 版本号，不照搬                                                                                       |

---

## 4. 建议顺序

按"收益 ÷ 难度"，且把已对外宣布的补完排最前：

1. ✅ **F. Antigravity 完善**（3 条）—— 已宣布的功能没补完，最该先做 **[已完成 2026-08-17]**
2. ✅ **G. 启动与运行时稳定性**（6 条）—— 纯修复，性价比最高 **[已完成 2026-08-17]**
3. ✅ **1oneCore 的 CLI 发现三条**（`88819804`/`f6131a4a`/`13b5dd42`）—— 同上 **[已完成 2026-08-17]**
4. 🟡 **C. 预览 v2 与文件引用**（5 条，注意顺序依赖）—— 闭合 ChatFileRef 那个老坑
   **[前 3 条已完成 2026-08-17；`eb4bd7f7`+`b678d839e` 跳过，见上方说明]**
5. ✅ **B. Explorer 右键菜单**（4 条）—— 顺手补回更新说明里那两条 **[已完成 2026-08-17]**
6. ✅ **E. 渠道 UI**（2 条，必须一起）**[已完成 2026-08-17]**
7. ✅ **A. SCM 面板**（4 条）—— 单独一轮 **[已完成 2026-08-17]**
8. ✅ **D. 内置浏览器**（`cb9d8f19b` + `cc57afcea`）**[已完成 2026-08-17]**
   ⚠️ **合完仍需重打包验证**（动了 `electron-builder.yml` 的 `asarUnpack`，
   新增 `builtin-mcp-browser.js` 必须真的被解包出来，否则外部 node 进程执行不到）。
   实际冲突面比本文档原预估小得多——`productName`/`artifactName`/`appId` 一处没碰。
9. ✅ **aionrs 整体 merge 至 0.2.11**（12 条，TUI 结构上已不可触发）**[已完成 2026-08-17]**
   唯一冲突在 `engine.rs` 的 `TurnOutcome::Truncated` 分派点：上游改成拿到截断就立刻
   `finalize(MaxTokens)`，而这正是 fork `9fa951e` 替换掉的放弃式行为。已核实
   `continue_truncated`/`recover_truncated_tool_call`/`MAX_TRUNCATION_CONTINUATIONS`
   在 `upstream/main` 里**各 0 处命中**（fork 独占命脉补丁），保留 fork 侧。
   会话分叉的前端半边 `ae2d2f53e` **仍未合**，见上方"仍然挂着的"。

**每一轮结束都要跑 [`mac-packaging-preflight.zh-CN.md`](mac-packaging-preflight.zh-CN.md) §1 的四条**，
否则会攒到打 Mac 包那一刻一次性爆掉。

---

## 5. 与本轮无关但仍挂着的

- **采纳上游多模态提示 `5a78a0b2`**——图片走原生块而非文件路径（本轮判定需独立一轮）
- **修 Windows 尾随空格工作区路径校验失效**（`tc6b`，`aionui-common`，地基层既有缺陷）
- **License 公私钥轮换**——当前内置的是开发占位公钥，私钥已泄露（在会话里打印过、
  且明文存在 `C:\Users\allenzhao\Desktop\feishu.txt`），**上线前必须 keygen 换掉**
