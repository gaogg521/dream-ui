# 2026-08-21 交接：1oneCore 149 提交上游合并 + 收尾修复

> **新会话接手时先读这份**，再按需翻 [`upstream-sync-reference.zh-CN.md`](upstream-sync-reference.zh-CN.md)（套路与不变量）和
> [`upstream-sync-backlog-2026-08-16.zh-CN.md`](upstream-sync-backlog-2026-08-16.zh-CN.md)（更早一批 1oneUI 待办的完整档案）。

## 0. 一句话现状

| 仓           | 本轮结果                                                                   | 状态          |
| ------------ | -------------------------------------------------------------------------- | ------------- |
| 1oneCore     | 149 提交上游合并（`2addb762`→`b584da01`）已完全解冲突+修复+合入 `one-main` | ✅ 已推送     |
| 1oneUI       | 135 提交上游同步                                                           | ❌ **未开始** |
| 两仓最终合并 | 1oneCore 已完成；1oneUI 完成后还要把两仓最终状态再核一遍                   | 部分完成      |

1oneCore 提交链：`sync-v0170` 分支（`74ada9f4`，已推）→ `one-main` fast-forward 合入 →
收尾第二轮修复（`8df6c094`，已推）。**`one-main` 现在是权威、干净的最新状态。**

---

## 1. 本次做完的事（1oneCore 149 提交合并）

### 1.1 合并本身

- worktree：`D:\aionui-m0\1oneCore-sync-full`，分支 `sync-v0170`，merge-base `2addb762`，
  上游到 `b584da01`。
- 253 个文件冲突，全部逐一 3-way 解决（`git merge-file` + Perl 状态机脚本批量应用 + 手工核对）。
- **最高杠杆的单点修复**：`Cargo.toml` 的 6 个 `aion-*` git 依赖被合并成指向上游裸
  `iOfficeAI/aionrs` tag，已改回 `gaogg521/aionrs` branch=master——否则会静默丢光 fork
  在 aionrs 上的全部专属补丁（视觉委托治理、textualize 工具历史等）。
- **`aionui-auth/src/routes.rs` 路由重复注册**曾导致 axum 启动 panic，级联拖垮几十个不
  相关的 e2e 测试——找到并删掉后，失败数从"几十个"直接掉到个位数。
- 详细的诊断方法论、diff3 误合并的具体案例、每个被恢复文件的取舍理由，见本次会话的完整
  transcript（已被压缩，如需细节可搜 `sync-v0170` 相关提交的 commit message，两条 commit
  message 本身已经写得相当详细）。

### 1.2 回归测试收尾（两轮，均已修复完毕）

**第一轮**（跟随 149-commit 合并一起发现）：

- `list_by_ids_any_keeps_disabled_rows_but_drops_deleted_ones` 内容截断
- `adoption_coverage.rs` 丢 3 个表分类声明
- `user_scope_migration.rs` 迁移编号沿用上游旧编号（28/30 应为 fork 重排后的 41/42）
- `team_skill_distribution_end_to_end`——`skill_service.rs` 的
  `list_available_skills_with_repo_for_user` 丢了与团队磁盘技能的聚合步骤，导致
  `GET /api/skills` 看不到刚下发的团队技能

**第二轮**（用户要求"全部要解决，代码要干净"后深挖）：

- `terminal.rs` 的 `default_cwd` 测试：Windows 下 `pwd` 经 MSYS 路径转换报
  `/tmp/...`，永远无法跟 `fs::canonicalize()` 的 `\\?\C:\...` 字符串匹配——改用
  marker 文件 + 目录列表验证，不再比较路径字符串本身
- **workspace 尾随空白路径校验，一次来回的教训**：一开始误判"Windows 前置拒绝守卫是
  错的"并删掉它，结果引入新失败（`create_rejects_unavailable_workspace_with_trailing_whitespace_in_request`）；
  用 Rust 实测证明 Windows 上 `"X"` 与 `"X "` 是**同一路径的两种写法**（Win32 在
  创建和查找时都做同样的别名化），"接受尾随空格路径"与"拒绝尾随空格路径的路径不
  匹配"这两种预期在 Windows 上**逻辑上不可能同时成立**——已恢复原有守卫，转而把
  依赖"接受"语义的测试（`cj3b`/`cj5b`/`tc6b` + 新发现的 `a_blank_basename_folder_...`）
  统一加 `#[cfg(not(windows))]`，跟代码库里已有的
  `create_accepts_existing_workspace_with_trailing_whitespace_in_name`（本来就是
  `#[cfg(not(windows))]`）配对一致。
- **CSRF 中间件与 4 个新测试的架构冲突**：`csrf.rs` 的 `has_bearer_auth` 豁免是
  fork 有意设计（桌面端连远程企业服务器没有 cookie jar，只能靠 Bearer token），
  4 个新测试（`extension_enablement_and_contributions_are_isolated_by_user` /
  `context_reset_requires_csrf` / `update_agent_model_requires_csrf` /
  `set_team_config_option_requires_csrf`）原本用 `Authorization: Bearer` 构造
  "缺 CSRF token"的请求，其实测的正是这条豁免本身——已改用真实的
  `Cookie: aionui-session=<token>`（不带 `Authorization` 头）来测试真正应该被
  拦截的防护边界，生产代码未改。
- **mid-turn 消息回执时序**：`aionui-conversation/src/service_test.rs` 里
  `midturn_send_delivers_into_the_active_turn` 明确注释锁定"即使是不发送原生
  echo 的 backend，reliable-fallback 也要立即把回执关闭成 finish"；而
  `aionui-app/tests/midturn_e2e.rs` 的 `midturn_send_returns_200_with_the_active_turn_id`
  却断言 GET 回来的状态是 `pending`——两者矛盾。已确认前者才是被文档化/测试锁定
  的正确契约（`deliver_midturn_message` 的 fallback 关闭本来就在响应返回前同步
  执行完，任何后续读取都只会看到 `finish`），修正了后者的错误断言，生产代码
  保持不变。
- `aionui-project` 的 `apply_synthesizes_rename_for_same_inode`：确认 Windows 无
  POSIX inode 是 `EntryFact::inode` 文档里写明的永久性设计降级（`inode_of()` 在
  `#[cfg(not(unix))]` 下恒返回 0），不是缺口，加 `#[cfg(unix)]`。
- `git_provider_test.rs` 6 个 CRLF 相关失败：本机全局 `git config core.autocrlf=true`
  影响了测试用 git2 建的临时仓库；已在 `init_repo()` 里显式
  `cfg.set_bool("core.autocrlf", false)`，测试不再依赖宿主机全局配置。
- `skill_batch_import` 测试：`alpha_row.path` 断言前先 `.replace('\\', "/")` 再匹配
  `/skills/users/`。
- **真回归，靠一条编译警告挖出来的**：`cmd_server.rs` 里 T6 目录同步调度器
  （`directory_sync_handle`）的优雅关闭 `.await` 被合并静默删掉了——`git show
HEAD~1:...` 对比确认合并前有、合并后丢，已按原样恢复（注释原文写着
  "must be joined before the pool closes, or a sync mid-write would find the
  database gone"，是真实风险不是学究式补全）。
- `cargo fmt --all` 清理了合并带来的 6 处格式漂移（import 列表换行方式）。

**结论**：目前已知的失败全部处理完毕，最后一次完整 `cargo test --workspace
--no-fail-fast` 跑到 34 个测试二进制、零失败时被我主动中断（用户要求停下收尾），
**建议下一次接手时先重跑一次确认到底**（预计总耗时 30–45 分钟）：

```bash
cd /d/aionui-m0/1oneCore
cargo test --workspace --no-fail-fast -- --test-threads=4
```

### 1.3 真机 CDP 核验（已做完）

编译 `cargo build -p aionui-app --release`，用
`AIONUI_BACKEND_LOCAL_PATH=<exe路径> node scripts/prepareAioncore.js` 内嵌进 1oneUI，
`AIONUI_DEVTOOLS_CDP_PORT=9230 bun run dev` 启动。验证过：品牌显示（"1ONE CLI"/
"One Work"）、已有团队会话（"股票讨论"）多列视图+文件树+历史消息正常渲染、MCP
服务列表正常、团队技能下发→`GET /api/skills` 全链路 API 往返、控制台/后端日志
无异常。方法论细节（原生 WebSocket 客户端脚本，绕开 chrome-devtools MCP 连不上
Electron 窗口的限制）已写进本机 memory。

**当前状态**：这一轮修复后重新编译+重启验证过一次，功能与第一次一致，桌面
dev 环境按用户要求**仍在运行、未关闭**（用户说要自己再测一次）。如果你接手时
它还开着：

- CDP：`http://127.0.0.1:9230/json`
- 后端端口：看 `/tmp/dev-user-test.stdout.log` 里的 `AIONCORE_LISTENING` 行
- 关闭方法：`tasklist | grep -i electron` 找 PID，`taskkill //PID <pid> //F`，
  再杀对应的 `aioncore.exe`

### 1.4 品牌复检

全仓扫描本次合并涉及文件，修复了 `AgentType::Aionrs` 显示名被合并回
`"Aion CLI"`（应为 `"1ONE CLI"`）这一处泄漏。另发现 1oneUI 的内置浏览器 MCP
显示名 `aionui-browser`，核实后**判定不是泄漏**（`aionui-image-generation` 用
同样的 `aionui-` 内部前缀，历次专门品牌复检都没碰过这两个，是命名不统一不是
品牌暴露）。

---

## 2. 待办事项（下一次接手做什么）

### 2.1 1oneUI 135 提交上游同步 —— 完全未开始，优先级最高

这是原计划的下一大项，本次会话完全没碰。规模与 1oneCore 这次相当（甚至可能更
大，1oneUI 是纯前端仓库文件数更多）。开始前建议：

1. 先跑一遍 [`upstream-sync-backlog-2026-08-16.zh-CN.md`](upstream-sync-backlog-2026-08-16.zh-CN.md)
   §1 的九个坑（尤其"前后端必须成对合""零冲突≠安全"两条，这次 1oneCore 合并
   又踩了一遍，教训是一致的）。
2. 用 `git fetch upstream && git log HEAD..upstream/main --oneline | wc -l` 先
   确认当前落后多少（8/21 检查时是 136，可能已经变化）。
3. 参照本次 1oneCore 的流程：`EnterWorktree` 建独立 worktree → 3-way merge 解
   冲突 → 全量 `bun run test` + `tsc` + `lint` → 真机验证 → 品牌复检 → 提交合
   `one-main`。

### 2.2 团队模式前端半边缺失（1oneUI #3893）—— 后端已合，前端没有入口

- **已确认**：1oneCore `#787`（"team mode reliability improvements, model
  switch persistence and runtime restart"）**已经在这次 149 提交合并里**，
  `e9b6f139` 已经是 `one-main` 的祖先。
- **已确认没做**：1oneUI `#937996978`（"runtime restart controls, model
  refresh button and team UX fixes"）**不在** 1oneUI 当前 `one-main`
  的历史里；`AcpRuntimeRestartButton.tsx` 这个组件全仓不存在。
- **影响**：后端具备的"运行时重启""模型切换持久化"能力，前端没有任何 UI
  能触发，属于典型的"后端合了但半成品"状态（`upstream-sync-backlog` 文档
  §1.1 反复强调的那类坑，这次是第 N 次实例）。
- **建议**：作为 1oneUI 135 提交同步的一部分专项处理，或单独拉一轮。冲突面
  未评估（触及 `TeamPage.tsx`/`TeamChatView.tsx`/`AcpModelSelector.tsx` 等
  多处，可能与 fork 团队相关的既有改动有重叠，需要先 trial-merge 看冲突量）。

### 2.3 媒体管线前端半边缺失（1oneUI #4103/#4105）—— 后端已合，前端没有

- **已确认**：1oneCore `#876`（"pair native media blocks with a link to the
  same file"）**已经在这次 149 提交合并里**，`da91f826` 已经是 `one-main`
  的祖先（`crates/aionui-ai-agent/src/media.rs` 是这次合并新增的文件之一）。
- **已确认没做**：1oneUI `#4103`（"render relative images in agent replies"）
  和 `#4105`（"read image root from ConversationContext"）都不在
  1oneUI 当前 `one-main` 里；`LocalImageView.tsx` 里没有对应的 image-root
  改动，`AcpChat.tsx` 没有 imageRoot 相关逻辑，对应的三个测试文件
  （`acpChatLocalImageRoot.dom.test.tsx` / `localImageViewContextRoot.dom.test.tsx` /
  `aionrsChatForkCapability.dom.test.tsx`）全仓不存在。
- **影响**：后端"给原生媒体块配上指向同一文件的链接"这个能力，前端渲染时
  拿不到正确的 image root，agent 回复里的相对路径图片大概率显示不出来或
  显示到根目录路径下——这正是本项目 memory 里已经反复出现过的
  `model-kind-inferred-vs-declared-media-gap` 同类"前后端不成对"问题的
  又一个新实例。
- **建议**：同样作为 1oneUI 同步的一部分，且因为涉及媒体管线这个 fork
  已经深度定制过的领域（媒体是独立设计的架构，见
  [`docs/specs/media-generation/`](../specs/media-generation/)），**语义
  是否一致需要人工核对**，不能盲目 cherry-pick——原文档已经标注过这点。

### 2.4 两条独立低风险小项，尚未做

- **反馈表单加选填邮箱字段（1oneUI #4096）**：`FeedbackReportModal.tsx` /
  `submitFeedbackReport.ts` 需要加一个可选邮箱字段。低冲突，可以直接
  cherry-pick 或手写，前提是核实 fork 的反馈表单目前长什么样（有没有跟
  上游同名文件产生结构性分歧）。
- **单色 logo 跟随主题色（1oneUI #3614）**：上游新增了 `ThemedLogo.tsx`
  组件并在 ~18 个文件里替换调用点。fork 目前用的是各处直接写死的
  `iconColors.primary` 之类写法（如 `AgentBadge.tsx`）。冲突面较大（18
  个文件），且这批文件很多是团队/助手相关页面，fork 可能有自己的改动，
  **需要先 trial-merge 看实际冲突量再决定是 cherry-pick 还是手写等价实现**
  （类似本次 §2.C-1 的 `b678d839e` 处理方式）。

### 2.5 已确认完成、不用重做的（避免重复劳动）

- HTML 渲染器路径穿越漏洞修复（#4097）——已在 `1ccea2430` 完成，19 条测试。
- PREBUILDS_ONLY 泄漏（#4078）——已在 `cf19549bf` 完成，44 条测试。
- Explorer 拖拽移动 + 新建文件/文件夹（#4090/#4102）——已在
  `b15afcf49`/`1b52a18da` 完成。
- KaTeX 多行公式渲染 + 重复渲染两个 bug（#4079/#4091）——已完成
  （`ff46719ca` 等），math 渲染管线本身也已存在（`rehype-katex` 等依赖已装）。
- 桌面渲染进程重载风暴修复（#4100）——已在 `aa5f33f2c` 完成，9 条测试。
- shutdown watchdog 加固 + 数据目录锁未及时释放（1oneCore #884/#886）——
  已确认是这次 149 提交合并的一部分（`1e20ab46`/`d94b5741`）。

以上均在今天会话前段（本文档撰写前，压缩边界之前）完成，2.5 节列出只是为了
避免下次接手时误判"没做过"而重复劳动。

### 2.6 与本次会话无关但仍然挂着的老债（摘自 upstream-sync-backlog 文档）

- License 公私钥轮换——当前内置的是开发占位公钥，**私钥已经泄露**（在某次
  会话里被打印过、且明文存在 `C:\Users\allenzhao\Desktop\feishu.txt`），
  **上线前必须 keygen 换掉**。纯人工操作，不需要代码改动。
- Claude CLI pin 从 2.1.215 升到 2.1.233——涉及 fork 自己 pin 值的断言，
  需要单独一轮打包决策，见 `upstream-sync-backlog` 文档"仍然挂着的"一节。
- 会话分叉（session fork）跨仓功能——aionrs 侧已经随这次 149 提交合并进来
  （`df1cf85`+`5889110`），但 1oneUI 侧的 `ae2d2f53e` 未合，前端没有分叉
  入口。是否要做是产品决策，不是技术缺口。

---

## 3. 关键技术教训（值得写进长期 memory 的部分已经写了，这里留一份索引）

1. **3-way merge 会把"为满足新校验而不再为空"的测试 mock 悄悄合并回真空
   实现**——报错内容跟生产代码的新校验逻辑完全对应时，先看 `git show
HEAD:<测试文件>` 里 mock 合并前的真实实现，别急着改生产代码。
2. **Cargo.toml 的跨仓依赖源会被 merge 静默改错**——每次上游同步收尾前，
   固定检查这六行 `aion-*` 依赖是否还指向 `gaogg521/aionrs` branch=master。
3. **Windows 路径别名化（trailing space/dot）没有办法靠 metadata 查询区分
   "特意创建"和"意外匹配"两种意图**——涉及这类路径的测试要么两边都用
   `fs::metadata` 走一遍验证后再下结论，要么干脆认命做 `#[cfg(unix)]`。
4. **一条看似无害的编译警告（unused variable）背后可能藏着真实的合并
   丢代码**——`cmd_server.rs` 那次是靠 `cargo check` 的警告顺藤摸瓜挖出来的，
   养成"合并后过一遍全部警告，不只看 test 失败"的习惯。

三份新增的 memory 文件：`sync-v0170-1onecore-merge-status.md`、
`merge-can-revert-fixture-back-to-empty.md`、
`cargo-git-dep-source-repoint-on-merge.md`，已挂进 `MEMORY.md` 索引最前面。
